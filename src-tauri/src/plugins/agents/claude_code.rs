//! Lancement de Claude Code (CLI officiel) dans un projet, en mode non interactif.
//!
//! - Le prompt passe par l'entrée standard : il n'est jamais inséré dans la ligne de commande.
//! - Aucune permission n'est contournée : pas de `--dangerously-skip-permissions`. Les outils que le CLI refuse
//!   sont remontés dans le résultat (`permission_denials`).
//! - Un budget maximal est imposé à chaque run (`--max-budget-usd`).
//! - La sortie `stream-json` est lue ligne à ligne et convertie en événements de progression.
//! - L'authentification est celle du CLI, locale : NEXUS ne stocke aucun identifiant.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::error::AdapterError;

pub const AGENT_ID: &str = "claude-code";
pub const EVENT_CHANNEL: &str = "agents://event";
/// Variable pour indiquer un autre emplacement du CLI (installation personnalisée, tests).
pub const CLI_ENV: &str = "NEXUS_CLAUDE_CLI";
pub const DEFAULT_BUDGET_USD: f64 = 0.5;
pub const MAX_PROMPT_CHARS: usize = 8_000;
const RUN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Événements émis vers l'interface pendant un run. Le `run_id` est ajouté à l'enveloppe.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    Started { model: Option<String>, cwd: Option<String> },
    Tool { name: String, summary: String },
    Text { text: String },
    Result { is_error: bool, text: String, cost_usd: f64, turns: u64, duration_ms: u64, denials: Vec<String> },
    Error { message: String },
    Cancelled,
}

/// Enveloppe émise vers l'interface : l'identifiant du run puis l'événement, à plat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnvelope {
    pub run_id: String,
    #[serde(flatten)]
    pub event: AgentEvent,
}

fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"]
    } else {
        &["claude"]
    }
}

/// Cherche le CLI : variable d'environnement, puis PATH.
pub fn locate() -> Option<PathBuf> {
    if let Ok(path) = std::env::var(CLI_ENV) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    let path_var = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_var) {
        for name in executable_names() {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn command_for(binary: &Path) -> Command {
    let is_script = binary.extension().map(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat")).unwrap_or(false);
    if cfg!(windows) && is_script {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(binary);
        command
    } else {
        Command::new(binary)
    }
}

pub fn detect() -> Detection {
    let Some(path) = locate() else {
        return Detection { path: None, version: None };
    };
    let mut command = command_for(&path);
    command.arg("--version").stdout(Stdio::piped()).stderr(Stdio::null());
    let version = run_with_timeout(command, VERSION_TIMEOUT).map(|output| output.trim().to_string()).filter(|text| !text.is_empty());
    Detection { path: Some(path.display().to_string()), version }
}

fn run_with_timeout(mut command: Command, timeout: Duration) -> Option<String> {
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait().ok().flatten().is_some() {
            return reader.join().ok();
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(POLL);
    }
}

fn summarize_input(input: &Value) -> String {
    for key in ["description", "command", "file_path", "pattern", "path", "url"] {
        if let Some(text) = input.get(key).and_then(Value::as_str) {
            return truncate(text, 160);
        }
    }
    String::new()
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let head: String = text.chars().take(max).collect();
        format!("{head}…")
    }
}

/// Convertit une ligne `stream-json` en événements. Les lignes sans intérêt pour l'utilisateur sont ignorées.
pub fn parse_line(line: &str) -> Vec<AgentEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    match value.get("type").and_then(Value::as_str) {
        Some("system") if value.get("subtype").and_then(Value::as_str) == Some("init") => vec![AgentEvent::Started {
            model: value.get("model").and_then(Value::as_str).map(str::to_string),
            cwd: value.get("cwd").and_then(Value::as_str).map(str::to_string),
        }],
        Some("assistant") => value["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                Some("text") => block.get("text").and_then(Value::as_str).map(|text| AgentEvent::Text { text: text.to_string() }),
                Some("tool_use") => Some(AgentEvent::Tool {
                    name: block.get("name").and_then(Value::as_str).unwrap_or("outil").to_string(),
                    summary: summarize_input(&block["input"]),
                }),
                _ => None,
            })
            .collect(),
        Some("result") => {
            let subtype = value.get("subtype").and_then(Value::as_str).unwrap_or("");
            let denials = value["permission_denials"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|denial| {
                    denial
                        .get("tool_name")
                        .or_else(|| denial.get("toolName"))
                        .and_then(Value::as_str)
                        .unwrap_or("outil")
                        .to_string()
                })
                .collect();
            vec![AgentEvent::Result {
                is_error: value.get("is_error").and_then(Value::as_bool).unwrap_or(subtype != "success"),
                text: value.get("result").and_then(Value::as_str).unwrap_or("").to_string(),
                cost_usd: value.get("total_cost_usd").and_then(Value::as_f64).unwrap_or(0.0),
                turns: value.get("num_turns").and_then(Value::as_u64).unwrap_or(0),
                duration_ms: value.get("duration_ms").and_then(Value::as_u64).unwrap_or(0),
                denials,
            }]
        }
        _ => Vec::new(),
    }
}

/// Contrôle d'un run en cours : le processus est partagé pour pouvoir être arrêté depuis une autre commande.
#[derive(Default)]
pub struct RunControl {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

#[derive(Default, Clone)]
pub struct Runs {
    active: Arc<Mutex<HashMap<String, Arc<RunControl>>>>,
}

impl Runs {
    pub fn clone_handle(&self) -> Runs {
        self.clone()
    }

    pub fn register(&self, run_id: &str) -> Arc<RunControl> {
        let control = Arc::new(RunControl::default());
        if let Ok(mut active) = self.active.lock() {
            active.insert(run_id.to_string(), Arc::clone(&control));
        }
        control
    }

    pub fn finish(&self, run_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(run_id);
        }
    }

    /// Demande l'arrêt d'un run. Renvoie `false` si le run n'existe pas ou est déjà terminé.
    pub fn cancel(&self, run_id: &str) -> bool {
        let control = self.active.lock().ok().and_then(|active| active.get(run_id).cloned());
        let Some(control) = control else { return false };
        control.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut child) = control.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
        true
    }
}

/// Exécute un run jusqu'à son terme. `sink` reçoit chaque événement, dans l'ordre.
pub fn run(
    binary: &Path,
    project: &Path,
    prompt: &str,
    budget_usd: f64,
    control: &RunControl,
    sink: &mut dyn FnMut(AgentEvent),
) {
    let mut command = command_for(binary);
    command
        .args(["-p", "--output-format", "stream-json", "--verbose", "--max-budget-usd"])
        .arg(format!("{budget_usd:.2}"))
        .current_dir(project)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            sink(AgentEvent::Error { message: format!("lancement impossible : {error}") });
            return;
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut slot) = control.child.lock() {
        *slot = Some(child);
    }

    let stderr_tail = Arc::new(Mutex::new(String::new()));
    let stderr_sink = Arc::clone(&stderr_tail);
    let stderr_reader = thread::spawn(move || {
        if let Some(mut stderr) = stderr {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            if let Ok(mut tail) = stderr_sink.lock() {
                *tail = truncate(text.trim(), 600);
            }
        }
    });

    let (events, receiver) = std::sync::mpsc::channel::<AgentEvent>();
    let reader = thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                for event in parse_line(&line) {
                    if events.send(event).is_err() {
                        return;
                    }
                }
            }
        }
    });

    let started = Instant::now();
    let mut result_seen = false;
    let mut timed_out = false;
    let exit_status = loop {
        for event in receiver.try_iter() {
            result_seen |= matches!(event, AgentEvent::Result { .. });
            sink(event);
        }
        let finished = match control.child.lock() {
            Ok(mut slot) => match slot.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => Some(Some(status)),
                    Ok(None) => None,
                    Err(_) => Some(None),
                },
                None => Some(None),
            },
            Err(_) => Some(None),
        };
        if let Some(status) = finished {
            break status;
        }
        if started.elapsed() >= RUN_TIMEOUT {
            timed_out = true;
            if let Ok(mut slot) = control.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let _ = child.kill();
                }
            }
        }
        thread::sleep(POLL);
    };
    // Un processus fils peut garder le tube ouvert après la mort du CLI : on n'attend le lecteur que quelques
    // secondes, puis on le détache. Les événements déjà lus sont toujours transmis dans l'ordre.
    let drain_deadline = Instant::now() + Duration::from_secs(3);
    while !reader.is_finished() && Instant::now() < drain_deadline {
        for event in receiver.try_iter() {
            result_seen |= matches!(event, AgentEvent::Result { .. });
            sink(event);
        }
        thread::sleep(POLL);
    }
    for event in receiver.try_iter() {
        result_seen |= matches!(event, AgentEvent::Result { .. });
        sink(event);
    }
    if reader.is_finished() {
        let _ = reader.join();
    }
    let stderr_deadline = Instant::now() + Duration::from_secs(1);
    while !stderr_reader.is_finished() && Instant::now() < stderr_deadline {
        thread::sleep(POLL);
    }
    if let Ok(mut slot) = control.child.lock() {
        *slot = None;
    }

    if control.cancelled.load(Ordering::SeqCst) {
        sink(AgentEvent::Cancelled);
    } else if timed_out {
        sink(AgentEvent::Error { message: "délai dépassé, le run a été arrêté".into() });
    } else if !result_seen {
        let detail = stderr_tail.lock().map(|tail| tail.clone()).unwrap_or_default();
        let code = exit_status.and_then(|status| status.code()).map(|code| code.to_string()).unwrap_or_else(|| "inconnu".into());
        let message = if detail.is_empty() { format!("fin sans résultat (code {code})") } else { detail };
        sink(AgentEvent::Error { message });
    }
}

pub fn validate_prompt(prompt: &str) -> Result<String, AdapterError> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(AdapterError::InvalidPath("prompt vide".into()));
    }
    if trimmed.chars().count() > MAX_PROMPT_CHARS {
        return Err(AdapterError::Operation(format!("prompt trop long (maximum {MAX_PROMPT_CHARS} caractères)")));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_STREAM: &str = include_str!("../../../tests/fixtures/agents/claude-stream-real.jsonl");

    #[test]
    fn parses_a_real_recorded_stream_into_progress_and_result() {
        let events: Vec<AgentEvent> = REAL_STREAM.lines().flat_map(parse_line).collect();
        assert!(matches!(events.first(), Some(AgentEvent::Started { model: Some(_), .. })));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::Tool { name, .. } if name == "Bash")));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::Text { text } if text.contains("fichier"))));
        match events.last() {
            Some(AgentEvent::Result { is_error, cost_usd, turns, denials, .. }) => {
                assert!(!is_error);
                assert!(*cost_usd > 0.0);
                assert_eq!(*turns, 2);
                assert!(denials.is_empty());
            }
            other => panic!("résultat attendu en dernier, reçu {other:?}"),
        }
    }

    #[test]
    fn ignores_noise_and_malformed_lines() {
        assert!(parse_line("pas du json").is_empty());
        assert!(parse_line(r#"{"type":"rate_limit_event"}"#).is_empty());
    }

    #[test]
    fn denials_are_reported_not_hidden() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"ok","permission_denials":[{"tool_name":"Bash"}]}"#;
        match parse_line(line).first() {
            Some(AgentEvent::Result { denials, .. }) => assert_eq!(denials, &vec!["Bash".to_string()]),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn prompt_is_trimmed_and_bounded() {
        assert_eq!(validate_prompt("  corrige le bug  ").unwrap(), "corrige le bug");
        assert!(validate_prompt("   ").is_err());
        assert!(validate_prompt(&"x".repeat(MAX_PROMPT_CHARS + 1)).is_err());
    }

    fn fake_cli(name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("nexus-fake-claude-{}-{name}", std::process::id()));
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn replays_recorded_output_through_the_process_boundary() {
        // Rejeu de la sortie réelle du CLI : le binaire est remplacé par un script qui recrache l'enregistrement.
        let fixture = format!("{}/tests/fixtures/agents/claude-stream-real.jsonl", env!("CARGO_MANIFEST_DIR"));
        let binary = fake_cli("replay", &format!("cat > /dev/null; cat '{fixture}'"));
        let control = RunControl::default();
        let mut events = Vec::new();
        run(&binary, &std::env::temp_dir(), "liste les fichiers", DEFAULT_BUDGET_USD, &control, &mut |event| events.push(event));
        let _ = std::fs::remove_file(&binary);
        assert!(matches!(events.last(), Some(AgentEvent::Result { is_error: false, .. })));
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_stops_the_process_and_reports_it() {
        let binary = fake_cli("sleep", "cat > /dev/null; sleep 30");
        let runs = Arc::new(Runs::default());
        let control = runs.register("run-annule");
        let canceller = Arc::clone(&runs);
        let started = Instant::now();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            assert!(canceller.cancel("run-annule"));
        });
        let mut events = Vec::new();
        run(&binary, &std::env::temp_dir(), "longue tâche", DEFAULT_BUDGET_USD, &control, &mut |event| events.push(event));
        runs.finish("run-annule");
        let _ = std::fs::remove_file(&binary);
        assert!(started.elapsed() < Duration::from_secs(10), "le processus doit être arrêté rapidement");
        assert_eq!(events.last(), Some(&AgentEvent::Cancelled));
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_cli_without_result_reports_an_error_with_its_stderr() {
        let binary = fake_cli("fail", "cat > /dev/null; echo 'Not logged in' >&2; exit 1");
        let control = RunControl::default();
        let mut events = Vec::new();
        run(&binary, &std::env::temp_dir(), "x", DEFAULT_BUDGET_USD, &control, &mut |event| events.push(event));
        let _ = std::fs::remove_file(&binary);
        assert_eq!(events, vec![AgentEvent::Error { message: "Not logged in".into() }]);
    }

    #[test]
    fn the_envelope_carries_the_run_id_next_to_the_event() {
        let envelope = AgentEnvelope { run_id: "run-1".into(), event: AgentEvent::Text { text: "bonjour".into() } };
        let json = serde_json::to_string(&envelope).unwrap();
        assert!(json.contains(r#""runId":"run-1""#) && json.contains(r#""kind":"text""#));
    }

    #[test]
    fn the_result_event_uses_the_camel_case_names_the_interface_reads() {
        let event = AgentEvent::Result {
            is_error: false,
            text: "ok".into(),
            cost_usd: 0.04,
            turns: 2,
            duration_ms: 11_497,
            denials: vec![],
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""costUsd":0.04"#) && json.contains(r#""durationMs":11497"#), "{json}");
        assert!(json.contains(r#""isError":false"#), "{json}");
    }

    /// Lance le vrai CLI (coût : quelques centimes). `cargo test -- --ignored real_cli` avec le CLI installé et connecté.
    #[test]
    #[ignore]
    fn real_cli_run_answers_a_trivial_prompt() {
        let binary = locate().expect("claude introuvable : définis NEXUS_CLAUDE_CLI ou ajoute-le au PATH");
        let project = std::env::temp_dir();
        let control = RunControl::default();
        let mut events = Vec::new();
        run(&binary, &project, "Réponds uniquement par le mot OK.", 0.2, &control, &mut |event| events.push(event));
        assert!(matches!(events.last(), Some(AgentEvent::Result { is_error: false, .. })), "reçu : {events:?}");
    }
}
