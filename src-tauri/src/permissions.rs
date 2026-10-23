//! Courtier des permissions : le seul endroit où une action sensible est autorisée.
//!
//! Les commandes natives appellent `confirm` avant toute action de niveau « confirmation ». L'interface ne peut
//! pas court-circuiter ce contrôle : elle ne fait que répondre à une demande émise par le natif.
//! Une demande sans réponse dans le délai est refusée.

use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::AdapterError;

pub const REQUEST_EVENT: &str = "permissions://request";
pub const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Automatic,
    Confirmation,
    Restricted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    SystemRead,
    FileRead,
    FileWrite,
    FileDelete,
    AgentRun,
}

impl Permission {
    pub fn id(self) -> &'static str {
        match self {
            Permission::SystemRead => "system.read",
            Permission::FileRead => "file.read",
            Permission::FileWrite => "file.write",
            Permission::FileDelete => "file.delete",
            Permission::AgentRun => "agent.run",
        }
    }

    pub fn tier(self) -> Tier {
        match self {
            Permission::SystemRead | Permission::FileRead => Tier::Automatic,
            Permission::FileWrite | Permission::FileDelete | Permission::AgentRun => Tier::Confirmation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Row {
    /// Clé de libellé, traduite par l'interface (`confirm.row.<clé>`).
    pub key: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestPayload<'a> {
    id: &'a str,
    permission: &'static str,
    rows: &'a [Row],
    expires_in_secs: u64,
}

/// Courtier partagé : les demandes en attente sont dans un `Arc`, la séquence est unique par courtier.
#[derive(Default, Clone)]
pub struct Broker {
    pending: Arc<Mutex<HashMap<String, Sender<bool>>>>,
    sequence: Arc<Mutex<u64>>,
}

impl Broker {
    /// Poignée vers le même courtier, à passer à un thread de travail.
    pub fn clone_handle(&self) -> Broker {
        self.clone()
    }

    fn next_id(&self) -> String {
        let mut sequence = self.sequence.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *sequence += 1;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        format!("perm-{now}-{}", *sequence)
    }

    /// Réponse de l'utilisateur. Une demande déjà réglée, expirée ou inconnue est refusée.
    pub fn answer(&self, id: &str, approved: bool) -> Result<(), AdapterError> {
        let sender = self
            .pending
            .lock()
            .map_err(|_| AdapterError::TaskFailed("verrou des permissions".into()))?
            .remove(id)
            .ok_or(AdapterError::ConfirmationExpired)?;
        sender.send(approved).map_err(|_| AdapterError::ConfirmationExpired)
    }

    /// Demandes en attente. Utile pour l'affichage et les tests.
    pub fn pending_count(&self) -> usize {
        self.pending.lock().map(|pending| pending.len()).unwrap_or(0)
    }
}

/// Demande l'accord de l'utilisateur pour une action de niveau « confirmation ».
///
/// Bloque le thread appelant jusqu'à la réponse ou l'expiration : à appeler depuis `spawn_blocking`.
/// `emit` transmet la demande à l'interface ; il est injecté pour pouvoir tester sans fenêtre.
pub fn confirm_with(
    emit: impl FnOnce(&str, Permission, &[Row], u64) -> Result<(), AdapterError>,
    broker: &Broker,
    permission: Permission,
    rows: &[Row],
    timeout: Duration,
) -> Result<(), AdapterError> {
    match permission.tier() {
        Tier::Automatic => return Ok(()),
        Tier::Restricted => return Err(AdapterError::PermissionRefused(permission.id().into())),
        Tier::Confirmation => {}
    }

    let id = broker.next_id();
    let (sender, receiver) = mpsc::channel::<bool>();
    broker
        .pending
        .lock()
        .map_err(|_| AdapterError::TaskFailed("verrou des permissions".into()))?
        .insert(id.clone(), sender);

    let outcome = match emit(&id, permission, rows, timeout.as_secs()) {
        Err(error) => Err(error),
        Ok(()) => match receiver.recv_timeout(timeout) {
            Ok(true) => Ok(()),
            Ok(false) => Err(AdapterError::ConfirmationRefused),
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => Err(AdapterError::ConfirmationExpired),
        },
    };
    if let Ok(mut pending) = broker.pending.lock() {
        pending.remove(&id);
    }
    outcome
}

/// Version Tauri : émet la demande vers la fenêtre principale.
pub fn confirm(app: &AppHandle, broker: &Broker, permission: Permission, rows: &[Row]) -> Result<(), AdapterError> {
    confirm_with(
        |id, permission, rows, expires_in_secs| {
            app.emit(
                REQUEST_EVENT,
                RequestPayload { id, permission: permission.id(), rows, expires_in_secs },
            )
            .map_err(|error| AdapterError::TaskFailed(error.to_string()))
        },
        broker,
        permission,
        rows,
        CONFIRMATION_TIMEOUT,
    )
}

/// Chaque permission et son niveau, pour l'affichage des réglages.
pub fn status() -> Vec<(&'static str, Tier)> {
    [Permission::SystemRead, Permission::FileRead, Permission::FileWrite, Permission::FileDelete, Permission::AgentRun]
        .into_iter()
        .map(|permission| (permission.id(), permission.tier()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn row(key: &str, value: &str) -> Row {
        Row { key: key.into(), value: value.into() }
    }

    #[test]
    fn automatic_permissions_never_prompt() {
        let broker = Broker::default();
        let result = confirm_with(|_, _, _, _| panic!("aucune demande attendue"), &broker, Permission::FileRead, &[], Duration::from_secs(1));
        assert!(result.is_ok());
    }

    #[test]
    fn confirmation_proceeds_only_when_the_user_approves() {
        let broker = std::sync::Arc::new(Broker::default());
        let answering = std::sync::Arc::clone(&broker);
        let rows = [row("from", "C:\\Users\\Ana\\a.txt")];
        let result = confirm_with(
            |id, permission, shown, expires| {
                assert_eq!(permission, Permission::FileDelete);
                assert_eq!(shown, &rows);
                assert_eq!(expires, 5);
                let id = id.to_string();
                thread::spawn(move || answering.answer(&id, true).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileDelete,
            &rows,
            Duration::from_secs(5),
        );
        assert!(result.is_ok());
        assert_eq!(broker.pending_count(), 0);
    }

    #[test]
    fn refusal_is_reported_and_never_turns_into_approval() {
        let broker = std::sync::Arc::new(Broker::default());
        let answering = std::sync::Arc::clone(&broker);
        let result = confirm_with(
            |id, _, _, _| {
                let id = id.to_string();
                thread::spawn(move || answering.answer(&id, false).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileWrite,
            &[],
            Duration::from_secs(5),
        );
        assert!(matches!(result, Err(AdapterError::ConfirmationRefused)));
    }

    #[test]
    fn a_request_without_answer_expires_and_is_refused() {
        let broker = Broker::default();
        let started = std::time::Instant::now();
        let result = confirm_with(|_, _, _, _| Ok(()), &broker, Permission::AgentRun, &[], Duration::from_millis(100));
        assert!(matches!(result, Err(AdapterError::ConfirmationExpired)));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(broker.pending_count(), 0);
    }

    #[test]
    fn answering_an_unknown_or_settled_request_is_refused() {
        let broker = Broker::default();
        assert!(matches!(broker.answer("perm-absent", true), Err(AdapterError::ConfirmationExpired)));
    }

    #[test]
    fn tiers_match_the_documented_policy() {
        assert_eq!(Permission::FileRead.tier(), Tier::Automatic);
        assert_eq!(Permission::FileDelete.tier(), Tier::Confirmation);
        assert_eq!(Permission::AgentRun.tier(), Tier::Confirmation);
    }
}
