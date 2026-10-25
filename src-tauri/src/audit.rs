//! Journal d'audit des actions sensibles sur les fichiers : une ligne JSON par action demandée, confirmée ou refusée.
//!
//! Aucun chemin ni contenu n'y est écrit en clair. Seule une empreinte SHA-256 de ce qui a été présenté à l'utilisateur
//! (les lignes de la carte de confirmation) est gardée, avec l'heure et le résultat : on peut vérifier plus tard qu'une
//! action correspond bien à ce qui avait été accordé, sans que le journal révèle les noms de fichiers.
//! Sans dossier de données (tests, configuration absente), rien n'est écrit. Une panne d'écriture ne bloque jamais l'action.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Emplacement du journal, relatif au dossier de données de l'application.
pub const FILE: &str = "audit/actions.jsonl";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line<'a> {
    at_ms: u64,
    action: &'a str,
    fingerprint: &'a str,
    outcome: &'a str,
}

/// Empreinte SHA-256 des lignes présentées : clé et valeur, séparées sans ambiguïté.
pub fn fingerprint<'a>(rows: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut hasher = Sha256::new();
    for (key, value) in rows {
        hasher.update(key.as_bytes());
        hasher.update([0]);
        hasher.update(value.as_bytes());
        hasher.update([0xff]);
    }
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Ajoute une ligne au journal. `outcome` : `confirmed`, `refused`, `done` ou `failed`.
pub fn record(data_dir: Option<&Path>, action: &str, fingerprint: &str, outcome: &str) {
    let Some(dir) = data_dir else { return };
    let path = dir.join(FILE);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0);
    let line = Line { at_ms, action, fingerprint, outcome };
    if let (Ok(json), Ok(mut file)) = (serde_json::to_string(&line), OpenOptions::new().create(true).append(true).open(&path)) {
        let _ = writeln!(file, "{json}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fingerprint_is_stable_and_separates_keys_from_values() {
        let first = fingerprint([("from", "ab"), ("to", "c")]);
        assert_eq!(first, fingerprint([("from", "ab"), ("to", "c")]));
        // « a » + « bc » ne doit pas donner la même empreinte que « ab » + « c ».
        assert_ne!(fingerprint([("from", "a"), ("to", "bc")]), fingerprint([("from", "ab"), ("to", "c")]));
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn the_fingerprint_hides_the_paths_it_covers() {
        let digest = fingerprint([("from", "C:\\Users\\Ana\\secret.txt")]);
        assert!(!digest.contains("secret"));
    }

    #[test]
    fn a_line_holds_the_action_and_the_outcome_but_no_path() {
        let dir = std::env::temp_dir().join(format!("nexus-audit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        record(Some(&dir), "files.operate", &fingerprint([("from", "C:\\Users\\Ana\\a.txt")]), "done");
        let text = fs::read_to_string(dir.join(FILE)).expect("journal écrit");
        assert!(text.contains("\"outcome\":\"done\""));
        assert!(text.contains("\"action\":\"files.operate\""));
        assert!(!text.contains("a.txt"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn without_a_data_folder_nothing_is_written() {
        record(None, "files.operate", "x", "done");
    }
}
