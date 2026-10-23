//! Exécution isolée : chaque connecteur tourne dans un processus `nexus-worker` séparé.
//! Le processus reçoit la requête sur l'entrée standard et renvoie le rapport sur la sortie standard.
//! Un délai dépassé ou une sortie trop grande ne peuvent ni bloquer ni faire planter l'application.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::plugins::report::{ConnectorReport, ConnectorRequest};
use crate::error::AdapterError;

pub const MAX_REPORT_BYTES: u64 = 4 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Le worker est livré à côté de l'application (même dossier que l'exécutable).
pub fn worker_path() -> Result<PathBuf, AdapterError> {
    let exe = std::env::current_exe().map_err(|error| AdapterError::ConnectorFailed(error.to_string()))?;
    let directory = exe
        .parent()
        .ok_or_else(|| AdapterError::ConnectorFailed("dossier de l'application introuvable".into()))?;
    Ok(directory.join(format!("nexus-worker{}", std::env::consts::EXE_SUFFIX)))
}

pub fn run_isolated(worker: &Path, request: &ConnectorRequest, timeout: Duration) -> Result<ConnectorReport, AdapterError> {
    let payload = serde_json::to_vec(request).map_err(|error| AdapterError::ConnectorFailed(error.to_string()))?;
    let mut child = Command::new(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AdapterError::ConnectorFailed(format!("worker indisponible : {error}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        // Le worker peut terminer sans lire : une rupture de tube n'est pas une erreur en soi.
        let _ = stdin.write_all(&payload);
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AdapterError::ConnectorFailed("sortie du worker absente".into()))?;
    let reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        stdout.take(MAX_REPORT_BYTES).read_to_end(&mut buffer).map(|_| buffer)
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| AdapterError::ConnectorFailed(error.to_string()))? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AdapterError::ConnectorTimeout(request.connector.clone()));
        }
        thread::sleep(POLL_INTERVAL);
    };

    let output = reader
        .join()
        .map_err(|_| AdapterError::ConnectorFailed("lecture de la sortie interrompue".into()))?
        .map_err(|error| AdapterError::ConnectorFailed(error.to_string()))?;
    if !status.success() {
        return Err(AdapterError::ConnectorFailed(format!("le worker a quitté avec le statut {status}")));
    }
    serde_json::from_slice(&output).map_err(|error| AdapterError::ConnectorFailed(format!("rapport illisible : {error}")))
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;

    use super::*;

    // Écrire un script puis l'exécuter pendant qu'un autre test fork provoque « Text file busy » (ETXTBSY).
    static SERIAL: Mutex<()> = Mutex::new(());

    fn script(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("nexus-test-{}-{name}", std::process::id()));
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn request() -> ConnectorRequest {
        ConnectorRequest { connector: "domain.dns".into(), target: "example.com".into(), search_id: "s1".into() }
    }

    #[test]
    fn kills_a_worker_that_exceeds_its_deadline() {
        let _guard = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let worker = script("sleep", "cat > /dev/null; sleep 10");
        let started = Instant::now();
        let error = run_isolated(&worker, &request(), Duration::from_millis(300)).unwrap_err();
        assert!(matches!(error, AdapterError::ConnectorTimeout(_)));
        assert!(started.elapsed() < Duration::from_secs(5), "le worker doit être arrêté rapidement");
    }

    #[test]
    fn reads_a_well_formed_report_from_the_worker() {
        let _guard = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let report = r#"{"searchId":"s1","connector":"domain.dns","findings":[],"errors":[],"partial":false}"#;
        let worker = script("ok", &format!("cat > /dev/null; echo '{report}'"));
        let parsed = run_isolated(&worker, &request(), Duration::from_secs(5)).unwrap();
        assert_eq!(parsed.search_id, "s1");
        assert!(!parsed.partial);
    }

    #[test]
    fn reports_a_failing_worker_without_trusting_its_output() {
        let _guard = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let worker = script("fail", "cat > /dev/null; echo 'pas du json'; exit 3");
        let error = run_isolated(&worker, &request(), Duration::from_secs(5)).unwrap_err();
        assert!(matches!(error, AdapterError::ConnectorFailed(_)));
    }
}
