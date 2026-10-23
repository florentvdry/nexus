//! Journal local des commandes (phase 5). Désactivé par défaut : aucune commande n'est conservée tant que
//! l'utilisateur ne l'active pas. Seul le texte de la commande et son type sont gardés : jamais les résultats,
//! ni le contenu des fichiers. Le journal reste sur cet ordinateur et peut être vidé à tout moment.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::AdapterError;

/// Nombre maximal de commandes conservées : les plus anciennes sont supprimées au-delà.
pub const RETENTION: usize = 500;
/// Au-delà, le texte est tronqué : une phrase de commande n'a pas besoin de davantage.
const MAX_TEXT_CHARS: usize = 300;
const MAX_KIND_CHARS: usize = 40;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: i64,
    /// Date d'enregistrement, en millisecondes depuis l'époque Unix.
    pub at: i64,
    /// Type de commande reconnu, p. ex. `OPEN_APPLICATION`.
    pub kind: String,
    pub text: String,
}

pub struct Journal {
    connection: Mutex<Connection>,
}

fn storage(error: rusqlite::Error) -> AdapterError {
    AdapterError::Operation(format!("journal : {error}"))
}

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or(0)
}

impl Journal {
    pub fn open(path: &Path) -> Result<Journal, AdapterError> {
        Self::from_connection(Connection::open(path).map_err(storage)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Journal, AdapterError> {
        Self::from_connection(Connection::open_in_memory().map_err(storage)?)
    }

    fn from_connection(connection: Connection) -> Result<Journal, AdapterError> {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);",
            )
            .map_err(storage)?;
        Ok(Journal { connection: Mutex::new(connection) })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, AdapterError> {
        self.connection.lock().map_err(|_| AdapterError::TaskFailed("verrou du journal".into()))
    }

    pub fn enabled(&self) -> Result<bool, AdapterError> {
        let connection = self.lock()?;
        let value: Option<String> = connection
            .query_row("SELECT value FROM settings WHERE key = 'enabled'", [], |row| row.get(0))
            .optional()
            .map_err(storage)?;
        Ok(value.as_deref() == Some("1"))
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), AdapterError> {
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('enabled', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![if enabled { "1" } else { "0" }],
            )
            .map_err(storage)?;
        Ok(())
    }

    /// Enregistre une commande si le journal est activé. Renvoie `false` quand rien n'a été écrit.
    pub fn record(&self, kind: &str, text: &str) -> Result<bool, AdapterError> {
        if kind.is_empty() || kind.chars().count() > MAX_KIND_CHARS || !kind.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
            return Err(AdapterError::InvalidTarget(kind.to_string()));
        }
        if !self.enabled()? {
            return Ok(false);
        }
        let text: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
        if text.is_empty() {
            return Ok(false);
        }
        let connection = self.lock()?;
        connection
            .execute("INSERT INTO journal (at, kind, text) VALUES (?1, ?2, ?3)", params![now_millis(), kind, text])
            .map_err(storage)?;
        connection
            .execute("DELETE FROM journal WHERE id NOT IN (SELECT id FROM journal ORDER BY id DESC LIMIT ?1)", params![RETENTION as i64])
            .map_err(storage)?;
        Ok(true)
    }

    /// Les commandes les plus récentes d'abord.
    pub fn list(&self, limit: usize) -> Result<Vec<JournalEntry>, AdapterError> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT id, at, kind, text FROM journal ORDER BY id DESC LIMIT ?1").map_err(storage)?;
        let rows = statement
            .query_map(params![limit.clamp(1, RETENTION) as i64], |row| {
                Ok(JournalEntry { id: row.get(0)?, at: row.get(1)?, kind: row.get(2)?, text: row.get(3)? })
            })
            .map_err(storage)?;
        let entries = rows.collect::<Result<Vec<_>, _>>().map_err(storage)?;
        Ok(entries)
    }

    pub fn clear(&self) -> Result<(), AdapterError> {
        self.lock()?.execute("DELETE FROM journal", []).map_err(storage)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_recorded_until_the_user_enables_the_journal() {
        let journal = Journal::in_memory().unwrap();
        assert!(!journal.enabled().unwrap());
        assert!(!journal.record("OPEN_APPLICATION", "lance Discord").unwrap());
        assert!(journal.list(10).unwrap().is_empty());
    }

    #[test]
    fn enabled_journal_keeps_the_newest_commands_first_and_can_be_cleared() {
        let journal = Journal::in_memory().unwrap();
        journal.set_enabled(true).unwrap();
        journal.record("OPEN_APPLICATION", "lance Discord").unwrap();
        journal.record("SYSTEM_INFO", "affiche l'utilisation CPU").unwrap();
        let entries = journal.list(10).unwrap();
        assert_eq!(entries.iter().map(|entry| entry.text.as_str()).collect::<Vec<_>>(), ["affiche l'utilisation CPU", "lance Discord"]);
        assert_eq!(entries[0].kind, "SYSTEM_INFO");
        journal.clear().unwrap();
        assert!(journal.list(10).unwrap().is_empty());
    }

    #[test]
    fn retention_drops_the_oldest_commands() {
        let journal = Journal::in_memory().unwrap();
        journal.set_enabled(true).unwrap();
        for index in 0..RETENTION + 5 {
            journal.record("HELP", &format!("commande {index}")).unwrap();
        }
        let entries = journal.list(RETENTION + 100).unwrap();
        assert_eq!(entries.len(), RETENTION);
        assert_eq!(entries[0].text, format!("commande {}", RETENTION + 4));
        assert_eq!(entries[RETENTION - 1].text, "commande 5");
    }

    #[test]
    fn long_text_is_truncated_and_odd_kinds_are_refused() {
        let journal = Journal::in_memory().unwrap();
        journal.set_enabled(true).unwrap();
        journal.record("HELP", &"é".repeat(1000)).unwrap();
        assert_eq!(journal.list(1).unwrap()[0].text.chars().count(), MAX_TEXT_CHARS);
        assert!(matches!(journal.record("drop table", "x"), Err(AdapterError::InvalidTarget(_))));
        assert!(matches!(journal.record("", "x"), Err(AdapterError::InvalidTarget(_))));
    }

    #[test]
    fn the_setting_survives_reopening_the_file() {
        let path = std::env::temp_dir().join(format!("nexus-journal-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let journal = Journal::open(&path).unwrap();
            journal.set_enabled(true).unwrap();
            journal.record("HELP", "aide").unwrap();
        }
        let reopened = Journal::open(&path).unwrap();
        assert!(reopened.enabled().unwrap());
        assert_eq!(reopened.list(5).unwrap()[0].text, "aide");
        drop(reopened);
        let _ = std::fs::remove_file(&path);
    }
}
