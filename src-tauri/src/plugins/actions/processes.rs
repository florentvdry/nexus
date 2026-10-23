//! Processus en cours (lecture seule). Sert à afficher les applications actives et à savoir si une
//! application est déjà ouverte.

use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessEntry {
    pub name: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

fn snapshot() -> Vec<ProcessEntry> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system
        .processes()
        .iter()
        .map(|(pid, process)| ProcessEntry {
            name: process.name().to_string_lossy().into_owned(),
            pid: pid.as_u32(),
            cpu_percent: process.cpu_usage(),
            memory_bytes: process.memory(),
        })
        .collect()
}

/// Les `limit` processus qui occupent le plus de mémoire.
pub fn top_by_memory(limit: usize) -> Vec<ProcessEntry> {
    let mut processes = snapshot();
    processes.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes).then(a.pid.cmp(&b.pid)));
    processes.truncate(limit);
    processes
}

/// Vrai si un processus dont le nom contient `name` (sans tenir compte de la casse) est en cours.
pub fn is_running(name: &str) -> bool {
    let wanted = name.to_lowercase();
    snapshot().iter().any(|process| process.name.to_lowercase().contains(&wanted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_processes_and_finds_the_test_process_itself() {
        let own = std::process::id();
        let all = snapshot();
        assert!(all.iter().any(|process| process.pid == own), "le processus de test doit apparaître");
        assert!(top_by_memory(5).len() <= 5);
    }

    #[test]
    fn top_list_is_sorted_by_memory() {
        let top = top_by_memory(10);
        assert!(top.windows(2).all(|pair| pair[0].memory_bytes >= pair[1].memory_bytes));
    }
}
