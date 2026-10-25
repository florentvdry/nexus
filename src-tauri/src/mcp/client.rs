//! Client MCP minimal, transport stdio : des messages JSON-RPC, un par ligne. Le serveur est lancé avec `npx` pour le
//! paquet approuvé, avec les seules variables de ce connecteur, et arrêté dès que la lecture ou l'appel est terminé.
//! Un délai global borne chaque session (premier téléchargement du paquet compris) : au-delà, le processus est arrêté,
//! même s'il ne produit aucune ligne.
//!
//! Un appel d'outil ne part qu'après vérification des arguments contre le schéma annoncé par le serveur (`schema.rs`).

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use super::schema;
use crate::error::AdapterError;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// Durée maximale d'une session (lancement, liste des outils, appel) : un serveur bloqué ne bloque pas NEXUS.
pub const SESSION_TIMEOUT: Duration = Duration::from_secs(120);
/// Nombre de lignes lues avant d'abandonner : un serveur qui ne répond pas à la requête ne bloque pas NEXUS.
const MAX_LINES: usize = 10_000;
/// Pages de la liste d'outils lues au plus (la pagination MCP est optionnelle).
const MAX_TOOL_PAGES: usize = 20;
const MAX_OUTPUT_CHARS: usize = 4_000;
const MAX_TOOL_NAME: usize = 100;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Ce qu'il faut pour lancer un connecteur : paquet approuvé, version, et ses variables.
#[derive(Debug, Clone, PartialEq)]
pub struct Launch {
    pub package: String,
    pub version: String,
    pub env: Vec<(String, String)>,
}

/// Outils proposés par le serveur, avec leur description et le schéma de leurs arguments.
pub fn list_tools(launch: &Launch) -> Result<Vec<Tool>, AdapterError> {
    let mut session = Session::start(launch)?;
    session.handshake()?;
    session.list_tools()
}

/// Appelle un outil et renvoie son texte, borné. Le nom doit être un outil annoncé par le serveur, et les arguments
/// doivent respecter son schéma. Tout se fait dans la même session : le serveur n'est lancé qu'une fois.
pub fn call_tool(launch: &Launch, name: &str, arguments: &Value) -> Result<String, AdapterError> {
    if !valid_tool_name(name) {
        return Err(AdapterError::InvalidTarget("nom d'outil invalide".into()));
    }
    if !arguments.is_object() {
        return Err(AdapterError::InvalidTarget("les arguments d'un outil doivent être un objet".into()));
    }
    let mut session = Session::start(launch)?;
    session.handshake()?;
    let tools = session.list_tools()?;
    check_call(&tools, name, arguments)?;
    let result = session.request("tools/call", json!({ "name": name, "arguments": arguments }))?;
    tool_text(&result)
}

/// Un appel n'est autorisé que vers un outil annoncé par le serveur, avec des arguments conformes à son schéma.
/// Fonction pure : aucun processus n'est lancé pour la décider.
fn check_call(tools: &[Tool], name: &str, arguments: &Value) -> Result<(), AdapterError> {
    let tool = tools
        .iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| AdapterError::InvalidTarget(format!("outil inconnu pour ce connecteur : {name}")))?;
    schema::validate(&tool.input_schema, arguments).map_err(|reason| AdapterError::InvalidTarget(format!("arguments refusés pour {name} : {reason}")))
}

pub fn valid_tool_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= MAX_TOOL_NAME && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn parse_tools(result: &Value) -> Vec<Tool> {
    let Some(tools) = result.get("tools").and_then(Value::as_array) else { return Vec::new() };
    tools
        .iter()
        .filter_map(|tool| {
            let name = tool.get("name").and_then(Value::as_str).filter(|name| valid_tool_name(name))?;
            Some(Tool {
                name: name.to_string(),
                description: tool.get("description").and_then(Value::as_str).unwrap_or_default().to_string(),
                input_schema: tool.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object" })),
            })
        })
        .collect()
}

/// Texte d'un résultat d'outil. Un outil en échec devient une erreur, avec son message.
fn tool_text(result: &Value) -> Result<String, AdapterError> {
    let text: String = result
        .get("content")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| item.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
        .chars()
        .take(MAX_OUTPUT_CHARS)
        .collect();
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(AdapterError::Operation(format!("l'outil a échoué : {text}")));
    }
    Ok(text)
}

/// Lit les réponses jusqu'à celle qui porte `id`. Les notifications et les réponses à d'autres requêtes sont ignorées.
fn read_response<I>(lines: &mut I, id: u64) -> Result<Value, AdapterError>
where
    I: Iterator<Item = std::io::Result<String>>,
{
    for _ in 0..MAX_LINES {
        let line = match lines.next() {
            Some(Ok(line)) => line,
            Some(Err(error)) if error.kind() == std::io::ErrorKind::TimedOut => {
                return Err(AdapterError::ConnectorTimeout("le connecteur n'a pas répondu dans le délai".into()))
            }
            _ => return Err(AdapterError::Operation("le connecteur s'est arrêté avant de répondre".into())),
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        if message.get("id") != Some(&json!(id)) {
            continue;
        }
        if let Some(error) = message.get("error") {
            let text = error.get("message").and_then(Value::as_str).unwrap_or("erreur inconnue");
            return Err(AdapterError::Operation(format!("connecteur : {text}")));
        }
        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
    Err(AdapterError::Operation("le connecteur n'a pas répondu à la requête".into()))
}

/// Lignes de la sortie du connecteur, lues dans un fil dédié. Une ligne qui n'arrive pas avant l'échéance est une erreur
/// de délai ; le processus est alors arrêté par `Session::drop`, ce qui termine aussi le fil de lecture.
struct TimedLines {
    receiver: Receiver<std::io::Result<String>>,
    deadline: Instant,
}

impl Iterator for TimedLines {
    type Item = std::io::Result<String>;

    fn next(&mut self) -> Option<Self::Item> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        match self.receiver.recv_timeout(remaining) {
            Ok(line) => Some(line),
            Err(RecvTimeoutError::Timeout) => Some(Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "délai dépassé"))),
            Err(RecvTimeoutError::Disconnected) => None,
        }
    }
}

/// Processus d'un connecteur, arrêté à la fin de la session (y compris en cas d'erreur ou de délai).
struct Session {
    child: Child,
    stdin: ChildStdin,
    lines: TimedLines,
    next_id: u64,
}

impl Session {
    fn start(launch: &Launch) -> Result<Session, AdapterError> {
        let spec = format!("{}@{}", launch.package, launch.version);
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", "npx", "-y", &spec]);
            command
        } else {
            let mut command = Command::new("npx");
            command.args(["-y", &spec]);
            command
        };
        command.envs(launch.env.iter().map(|(name, value)| (name.as_str(), value.as_str())));
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| AdapterError::Operation(format!("npx introuvable, Node.js est requis ({error})")))?;
        let stdin = child.stdin.take().ok_or_else(|| AdapterError::Operation("entrée du connecteur indisponible".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| AdapterError::Operation("sortie du connecteur indisponible".into()))?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let lines = TimedLines { receiver, deadline: Instant::now() + SESSION_TIMEOUT };
        Ok(Session { child, stdin, lines, next_id: 0 })
    }

    /// Toutes les pages de la liste d'outils, bornées en nombre.
    fn list_tools(&mut self) -> Result<Vec<Tool>, AdapterError> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_TOOL_PAGES {
            let params = cursor.as_ref().map_or_else(|| json!({}), |next| json!({ "cursor": next }));
            let result = self.request("tools/list", params)?;
            tools.extend(parse_tools(&result));
            cursor = result.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
        Err(AdapterError::Operation("trop de pages d'outils annoncées par le connecteur".into()))
    }

    fn send(&mut self, message: &Value) -> Result<(), AdapterError> {
        writeln!(self.stdin, "{message}")
            .and_then(|()| self.stdin.flush())
            .map_err(|error| AdapterError::Operation(format!("envoi au connecteur impossible ({error})")))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, AdapterError> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        read_response(&mut self.lines, id)
    }

    fn handshake(&mut self) -> Result<(), AdapterError> {
        self.request(
            "initialize",
            json!({ "protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": { "name": "NEXUS", "version": "0.1.0" } }),
        )?;
        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // Sous Windows, le processus lancé est `cmd`, qui lance `node` : on arrête tout l'arbre, sinon `node` survit.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = Command::new("taskkill")
                .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> std::vec::IntoIter<std::io::Result<String>> {
        items.iter().map(|item| Ok(item.to_string())).collect::<Vec<_>>().into_iter()
    }

    #[test]
    fn the_answer_with_the_right_id_is_taken_and_notifications_are_skipped() {
        let mut stream = lines(&[r#"{"jsonrpc":"2.0","method":"notifications/message"}"#, "pas du json", r#"{"jsonrpc":"2.0","id":4,"result":{"ok":true}}"#]);
        assert_eq!(read_response(&mut stream, 4).unwrap(), json!({ "ok": true }));
    }

    #[test]
    fn a_protocol_error_is_reported_with_its_message() {
        let mut stream = lines(&[r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"méthode inconnue"}}"#]);
        let error = read_response(&mut stream, 1).unwrap_err();
        assert!(error.to_string().contains("méthode inconnue"), "{error}");
    }

    #[test]
    fn a_server_that_closes_its_output_is_an_error_not_a_hang() {
        let mut stream = lines(&[r#"{"jsonrpc":"2.0","method":"ping"}"#]);
        assert!(read_response(&mut stream, 2).is_err());
    }

    #[test]
    fn the_tool_list_keeps_valid_names_and_defaults_the_schema() {
        let tools = parse_tools(&json!({ "tools": [
            { "name": "send_message", "description": "Envoie", "inputSchema": { "type": "object", "properties": { "channel": { "type": "string" } } } },
            { "name": "bad name!" },
            { "name": "list" }
        ] }));
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "send_message");
        assert_eq!(tools[1].input_schema, json!({ "type": "object" }));
    }

    #[test]
    fn a_tool_error_is_an_error_and_the_text_is_bounded() {
        let long = "a".repeat(MAX_OUTPUT_CHARS + 50);
        let ok = tool_text(&json!({ "content": [{ "type": "text", "text": long }] })).unwrap();
        assert_eq!(ok.chars().count(), MAX_OUTPUT_CHARS);
        assert!(tool_text(&json!({ "isError": true, "content": [{ "type": "text", "text": "refusé" }] })).is_err());
    }

    #[test]
    fn invalid_tool_names_and_arguments_never_start_a_server() {
        let launch = Launch { package: "pkg".into(), version: "1.0.0".into(), env: vec![] };
        assert!(call_tool(&launch, "../rm", &json!({})).is_err());
        assert!(call_tool(&launch, "send_message", &json!("texte")).is_err());
    }

    fn server_tools() -> Vec<Tool> {
        parse_tools(&json!({ "tools": [
            { "name": "send_message", "description": "Envoie", "inputSchema": {
                "type": "object",
                "properties": { "channel": { "type": "string" } },
                "required": ["channel"],
                "additionalProperties": false } }
        ] }))
    }

    #[test]
    fn a_call_is_checked_against_the_tools_the_server_announced() {
        let tools = server_tools();
        assert!(check_call(&tools, "send_message", &json!({ "channel": "general" })).is_ok());
        // Outil absent de la liste annoncée : refusé, même si le nom est bien formé.
        assert!(matches!(check_call(&tools, "delete_everything", &json!({})), Err(AdapterError::InvalidTarget(_))));
        // Champ non prévu par le schéma : refusé avant tout appel.
        let error = check_call(&tools, "send_message", &json!({ "channel": "a", "to_all": true })).unwrap_err();
        assert!(error.to_string().contains("to_all"), "{error}");
    }

    /// Un serveur qui ne produit aucune ligne ne doit pas bloquer NEXUS au-delà de l'échéance.
    #[test]
    fn a_server_that_never_answers_is_stopped_by_the_deadline() {
        let (sender, receiver) = mpsc::channel::<std::io::Result<String>>();
        let mut lines = TimedLines { receiver, deadline: Instant::now() + Duration::from_millis(50) };
        let started = Instant::now();
        let error = read_response(&mut lines, 1).unwrap_err();
        assert!(matches!(error, AdapterError::ConnectorTimeout(_)), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5));
        drop(sender);
    }
}
