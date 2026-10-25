//! Client MCP minimal, transport stdio : des messages JSON-RPC, un par ligne. Le serveur est lancé avec `npx` pour le
//! paquet approuvé, dans un job object (`sandbox.rs`) et avec un environnement réduit, puis arrêté dès que la lecture
//! ou l'appel est terminé. Un délai borne chaque session : au-delà, le processus et ses enfants sont arrêtés, même s'il
//! ne produit aucune ligne.
//!
//! Un appel d'outil suit cet ordre, dans la même session : liste des outils, contrôle du nom, des arguments (schéma) et du
//! périmètre (`scope.rs`), puis confirmation par le courtier, puis exécution. Rien n'est confirmé pour un appel refusé.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use super::sandbox;
use super::schema;
use super::scope::{self, ToolClass};
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
    /// Indications du serveur (`readOnlyHint`, `destructiveHint`). Non fiables : voir `scope.rs`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
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
    let mut session = Session::start(launch, SESSION_TIMEOUT)?;
    session.handshake()?;
    session.list_tools()
}

/// Appelle un outil et renvoie son texte, borné.
///
/// Le nom doit être un outil annoncé par le serveur, les arguments doivent respecter son schéma, et la classe de l'outil
/// doit être accordée (`granted`). Alors seulement, `confirm` demande l'accord de l'utilisateur, avec l'outil connu : un
/// refus ou une erreur arrête l'appel avant son exécution.
pub fn call_tool<C>(launch: &Launch, name: &str, arguments: &Value, granted: &[ToolClass], confirm: C) -> Result<String, AdapterError>
where
    C: FnOnce(&Tool) -> Result<(), AdapterError>,
{
    if !valid_tool_name(name) {
        return Err(AdapterError::InvalidTarget("nom d'outil invalide".into()));
    }
    if !arguments.is_object() {
        return Err(AdapterError::InvalidTarget("les arguments d'un outil doivent être un objet".into()));
    }
    let mut session = Session::start(launch, SESSION_TIMEOUT)?;
    session.handshake()?;
    run_call(&mut session, name, arguments, granted, confirm)
}

/// Le déroulement d'un appel dans une session déjà ouverte : contrôle, puis accord, puis exécution.
fn run_call<C>(session: &mut Session, name: &str, arguments: &Value, granted: &[ToolClass], confirm: C) -> Result<String, AdapterError>
where
    C: FnOnce(&Tool) -> Result<(), AdapterError>,
{
    let tools = session.list_tools()?;
    let tool = prepare_call(&tools, name, arguments, granted)?;
    confirm(tool)?;
    // La confirmation peut durer : le délai de la session repart de l'accord, pas du lancement.
    session.extend_deadline(SESSION_TIMEOUT);
    let result = session.request("tools/call", json!({ "name": name, "arguments": arguments }))?;
    tool_text(&result)
}

/// Décide un appel sans rien exécuter : outil annoncé, arguments conformes au schéma, classe accordée.
/// Fonction pure : aucun processus n'est lancé pour la décider.
fn prepare_call<'a>(tools: &'a [Tool], name: &str, arguments: &Value, granted: &[ToolClass]) -> Result<&'a Tool, AdapterError> {
    let tool = tools
        .iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| AdapterError::InvalidTarget(format!("outil inconnu pour ce connecteur : {name}")))?;
    schema::validate(&tool.input_schema, arguments).map_err(|reason| AdapterError::InvalidTarget(format!("arguments refusés pour {name} : {reason}")))?;
    let class = scope::classify(tool);
    if !scope::covers(granted, class) {
        return Err(AdapterError::PermissionRefused(format!("{name} : accès « {} » non accordé à ce connecteur", class.label())));
    }
    Ok(tool)
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
                annotations: tool.get("annotations").filter(|value| value.is_object()).cloned(),
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

/// Lit la sortie ligne à ligne. Un octet non UTF-8 ne coupe pas la session : la ligne est décodée avec remplacement.
fn read_lines(mut reader: impl BufRead, sender: &mpsc::Sender<std::io::Result<String>>) {
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer).trim_end_matches(['\r', '\n']).to_string();
                if sender.send(Ok(line)).is_err() {
                    break;
                }
            }
            Err(error) => {
                let _ = sender.send(Err(error));
                break;
            }
        }
    }
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
    /// Tous les processus du connecteur. Le fermer arrête l'arbre entier.
    #[cfg(windows)]
    job: Option<sandbox::Job>,
}

impl Session {
    fn start(launch: &Launch, timeout: Duration) -> Result<Session, AdapterError> {
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
        sandbox::isolate_environment(&mut command, &launch.env);
        Session::spawn(command, timeout)
    }

    /// Lance une commande comme connecteur : entrée et sortie en tuyaux, isolation, délai de la session.
    fn spawn(mut command: Command, timeout: Duration) -> Result<Session, AdapterError> {
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| AdapterError::Operation(format!("connecteur impossible à lancer ({error})")))?;
        #[cfg(windows)]
        let job = {
            let job = sandbox::Job::new()?;
            // Dès le lancement, avant que le connecteur n'ait pu créer un enfant hors du job.
            if let Err(error) = job.assign(&child) {
                let _ = child.kill();
                return Err(error);
            }
            job
        };
        let stdin = child.stdin.take().ok_or_else(|| AdapterError::Operation("entrée du connecteur indisponible".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| AdapterError::Operation("sortie du connecteur indisponible".into()))?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || read_lines(BufReader::new(stdout), &sender));
        let lines = TimedLines { receiver, deadline: Instant::now() + timeout };
        Ok(Session {
            child,
            stdin,
            lines,
            next_id: 0,
            #[cfg(windows)]
            job: Some(job),
        })
    }

    fn extend_deadline(&mut self, timeout: Duration) {
        self.lines.deadline = Instant::now() + timeout;
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
        // Le job arrête tout l'arbre des processus à sa fermeture ; sans lui, on arrête au moins le processus lancé.
        #[cfg(windows)]
        drop(self.job.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
    fn the_tool_list_keeps_valid_names_annotations_and_defaults_the_schema() {
        let tools = parse_tools(&json!({ "tools": [
            { "name": "send_message", "description": "Envoie", "inputSchema": { "type": "object", "properties": { "channel": { "type": "string" } } }, "annotations": { "readOnlyHint": false } },
            { "name": "bad name!" },
            { "name": "list" }
        ] }));
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "send_message");
        assert_eq!(tools[0].annotations, Some(json!({ "readOnlyHint": false })));
        assert_eq!(tools[1].input_schema, json!({ "type": "object" }));
        assert_eq!(tools[1].annotations, None);
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
        let never = |_: &Tool| -> Result<(), AdapterError> { panic!("confirmation demandée pour un appel invalide") };
        assert!(call_tool(&launch, "../rm", &json!({}), &scope::default_scopes(), never).is_err());
        assert!(call_tool(&launch, "send_message", &json!("texte"), &scope::default_scopes(), never).is_err());
    }

    fn server_tools() -> Vec<Tool> {
        parse_tools(&json!({ "tools": [
            { "name": "read_channel", "description": "Lit", "inputSchema": {
                "type": "object",
                "properties": { "channel": { "type": "string" } },
                "required": ["channel"],
                "additionalProperties": false }, "annotations": { "readOnlyHint": true } },
            { "name": "delete_channel", "description": "Supprime", "inputSchema": { "type": "object" }, "annotations": { "readOnlyHint": false } }
        ] }))
    }

    #[test]
    fn a_call_is_checked_against_the_tools_the_server_announced() {
        let tools = server_tools();
        let read = json!({ "channel": "general" });
        assert!(prepare_call(&tools, "read_channel", &read, &scope::default_scopes()).is_ok());
        // Outil absent de la liste annoncée : refusé, même si le nom est bien formé.
        assert!(matches!(prepare_call(&tools, "shutdown_all", &json!({}), &scope::default_scopes()), Err(AdapterError::InvalidTarget(_))));
        // Champ non prévu par le schéma : refusé avant toute confirmation.
        let error = prepare_call(&tools, "read_channel", &json!({ "channel": "a", "to_all": true }), &scope::default_scopes()).unwrap_err();
        assert!(error.to_string().contains("to_all"), "{error}");
    }

    /// Le périmètre refuse un outil dont la classe n'est pas accordée, avant toute confirmation.
    #[test]
    fn a_tool_outside_the_granted_scope_is_refused_before_confirmation() {
        let tools = server_tools();
        let error = prepare_call(&tools, "delete_channel", &json!({}), &scope::default_scopes()).unwrap_err();
        assert!(matches!(error, AdapterError::PermissionRefused(_)), "{error}");
        assert!(error.to_string().contains("suppression"), "{error}");
        assert!(prepare_call(&tools, "delete_channel", &json!({}), &[ToolClass::Read, ToolClass::Delete]).is_ok());
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

    // ---------- serveur MCP simulé (PowerShell), de bout en bout : Windows seulement ----------
    #[cfg(windows)]
    mod connector_e2e {
        use super::*;


        fn fake_server(mode: &str) -> Command {
            let script: PathBuf = [env!("CARGO_MANIFEST_DIR"), "tests", "fixtures", "fake-mcp.ps1"].iter().collect();
            let mut command = Command::new("powershell.exe");
            command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(script).args(["-Mode", mode]);
            command
        }

        /// Démarre le serveur simulé, avec le même isolement qu'un vrai connecteur, et son délai.
        fn fake_session(mode: &str, timeout: Duration, env: &[(String, String)]) -> Session {
            let mut command = fake_server(mode);
            sandbox::isolate_environment(&mut command, env);
            let mut session = Session::spawn(command, timeout).unwrap();
            session.handshake().unwrap();
            session
        }

        /// Un refus de l'utilisateur arrête l'appel : l'outil n'est pas exécuté.
    #[test]
    fn a_refused_confirmation_stops_the_call() {
        let mut session = fake_session("normal", Duration::from_secs(60), &[]);
        let refused = run_call(&mut session, "read_note", &json!({ "id": "1" }), &scope::default_scopes(), |_| Err(AdapterError::ConfirmationRefused));
        assert!(matches!(refused, Err(AdapterError::ConfirmationRefused)), "{refused:?}");
    }

    /// Un outil hors périmètre n'est même pas présenté à l'utilisateur : la confirmation n'est jamais demandée.
    #[test]
    fn an_out_of_scope_tool_is_never_offered_for_confirmation() {
        let mut session = fake_session("normal", Duration::from_secs(60), &[]);
        let outcome = run_call(&mut session, "delete_note", &json!({ "id": "1" }), &scope::default_scopes(), |_| panic!("confirmation demandée"));
        assert!(matches!(outcome, Err(AdapterError::PermissionRefused(_))), "{outcome:?}");
    }

    /// Un serveur qui annonce « lecture seule » pour un outil qui supprime ne passe pas le périmètre lecture.
    #[test]
    fn a_lying_annotation_does_not_pass_the_read_scope() {
        let mut session = fake_session("normal", Duration::from_secs(60), &[]);
        let outcome = run_call(&mut session, "purge_all", &json!({}), &scope::default_scopes(), |_| panic!("confirmation demandée"));
        assert!(matches!(outcome, Err(AdapterError::PermissionRefused(_))), "{outcome:?}");
    }

    /// La description d'un outil ne change pas la classe présentée : l'accord montre « lecture », sans ses consignes.
    #[test]
    fn the_confirmation_shows_the_class_not_the_injected_instructions() {
        let mut session = fake_session("normal", Duration::from_secs(60), &[]);
        let mut shown = None;
        let outcome = run_call(&mut session, "summarize", &json!({ "text": "bonjour" }), &scope::default_scopes(), |tool| {
            shown = Some(scope::classify(tool));
            Ok(())
        });
        assert_eq!(shown, Some(ToolClass::Read));
        assert_eq!(outcome.unwrap(), "execute : summarize");
    }

    fn call(session: &mut Session, name: &str, arguments: Value) -> Result<String, AdapterError> {
            let tools = session.list_tools()?;
            prepare_call(&tools, name, &arguments, &scope::default_scopes())?;
            let result = session.request("tools/call", json!({ "name": name, "arguments": arguments }))?;
            tool_text(&result)
        }

        #[test]
            fn the_fake_server_lists_tools_and_answers_a_read() {
            let mut session = fake_session("normal", Duration::from_secs(60), &[]);
            let tools = session.list_tools().unwrap();
            assert!(tools.iter().any(|tool| tool.name == "read_note"));
            assert_eq!(call(&mut session, "read_note", json!({ "id": "1" })).unwrap(), "execute : read_note");
        }

        /// Le connecteur ne voit pas les variables de NEXUS ni de l'utilisateur : seulement les siennes.
        #[test]
            fn the_connector_never_inherits_the_host_secrets() {
            std::env::set_var("NEXUS_HOST_SECRET_TEST", "valeur-hote");
            let mut session = fake_session("normal", Duration::from_secs(60), &[("NEXUS_CANARY".into(), "valeur-connecteur".into())]);
            // La variable propre au connecteur est bien transmise ; celle de l'hôte n'arrive pas.
            assert_eq!(call(&mut session, "echo_env", json!({ "name": "NEXUS_CANARY" })).unwrap(), "valeur-connecteur");
            assert_eq!(call(&mut session, "echo_env", json!({ "name": "NEXUS_HOST_SECRET_TEST" })).unwrap(), "");
            std::env::remove_var("NEXUS_HOST_SECRET_TEST");
        }

        /// Fermer la session arrête le serveur et le processus qu'il a lancé.
        #[cfg(windows)]
        #[test]
            fn closing_the_session_stops_the_connector_and_its_children() {
            let mut session = fake_session("normal", Duration::from_secs(60), &[]);
            let child_pid: u32 = call(&mut session, "spawn_child", json!({})).unwrap().trim().parse().unwrap();
            assert!(process_alive(child_pid), "le processus enfant doit exister pendant la session");
            drop(session);
            let started = Instant::now();
            while process_alive(child_pid) && started.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(!process_alive(child_pid), "le processus enfant survit à la session");
        }

        #[cfg(windows)]
        fn process_alive(pid: u32) -> bool {
            let output = Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]).output().unwrap();
            String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
        }

        #[test]
            fn a_hanging_connector_is_stopped_by_the_session_deadline() {
            let started = Instant::now();
            let mut session = fake_session("hang", Duration::from_secs(3), &[]);
            let error = session.list_tools().unwrap_err();
            assert!(matches!(error, AdapterError::ConnectorTimeout(_)), "{error}");
            assert!(started.elapsed() < Duration::from_secs(30));
        }
    }
}
