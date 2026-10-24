//! Tâches programmées : la liste est gardée dans le dossier de données de NEXUS, et relue au démarrage. C'est l'interface
//! qui décide quand une tâche tourne (elle dispose du moteur) ; ce module ne fait que stocker et valider.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AdapterError;
use crate::grants::require_core;

pub const MAX_TASKS: usize = 100;
const MAX_REQUEST_CHARS: usize = 500;

/// Quand une tâche s'exécute. Forme identique à `Recurrence` côté interface (`src/core/schedule/recurrence.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Recurrence {
    Once { at: u64 },
    Daily { time: String },
    Weekly { weekday: u8, time: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: u64,
    pub request: String,
    pub recurrence: Recurrence,
    pub next_run_at: u64,
    pub created_at: u64,
}

/// Heure « HH:MM » valide, sur 24 heures.
pub fn valid_time(time: &str) -> bool {
    let bytes = time.as_bytes();
    bytes.len() == 5
        && bytes[2] == b':'
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && time[..2].parse::<u8>().is_ok_and(|hours| hours < 24)
        && time[3..].parse::<u8>().is_ok_and(|minutes| minutes < 60)
}

/// Liste complète : bornée, chaque tâche valide. Une liste refusée n'est jamais écrite.
pub fn validate(tasks: &[ScheduledTask]) -> Result<(), AdapterError> {
    if tasks.len() > MAX_TASKS {
        return Err(AdapterError::InvalidTarget(format!("plus de {MAX_TASKS} tâches programmées")));
    }
    for task in tasks {
        let request = task.request.trim();
        if request.is_empty() || request.chars().count() > MAX_REQUEST_CHARS {
            return Err(AdapterError::InvalidTarget("demande programmée vide ou trop longue".into()));
        }
        let recurrence_ok = match &task.recurrence {
            Recurrence::Once { .. } => true,
            Recurrence::Daily { time } => valid_time(time),
            Recurrence::Weekly { weekday, time } => *weekday <= 6 && valid_time(time),
        };
        if !recurrence_ok {
            return Err(AdapterError::InvalidTarget("récurrence invalide".into()));
        }
    }
    Ok(())
}

/// Registre des tâches. Sans dossier de données, il reste en mémoire pour la session.
pub struct ScheduleStore {
    path: Option<PathBuf>,
    tasks: Mutex<Vec<ScheduledTask>>,
}

impl ScheduleStore {
    pub fn open(path: Option<PathBuf>) -> Self {
        let tasks = path
            .as_ref()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|text| serde_json::from_str::<Vec<ScheduledTask>>(&text).ok())
            .filter(|tasks| validate(tasks).is_ok())
            .unwrap_or_default();
        ScheduleStore { path, tasks: Mutex::new(tasks) }
    }

    pub fn list(&self) -> Vec<ScheduledTask> {
        self.lock().clone()
    }

    /// Remplace la liste par celle de l'interface, après validation. L'écriture est atomique : un fichier à moitié
    /// écrit ne peut pas remplacer une liste valide.
    pub fn save(&self, tasks: Vec<ScheduledTask>) -> Result<(), AdapterError> {
        validate(&tasks)?;
        let mut current = self.lock();
        self.write(&tasks)?;
        *current = tasks;
        Ok(())
    }

    fn write(&self, tasks: &[ScheduledTask]) -> Result<(), AdapterError> {
        let Some(path) = &self.path else { return Ok(()) };
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|error| AdapterError::Operation(format!("dossier des tâches : {error}")))?;
        }
        let text = serde_json::to_string_pretty(tasks).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, text).map_err(|error| AdapterError::Operation(format!("enregistrement des tâches : {error}")))?;
        std::fs::rename(&temporary, path).map_err(|error| AdapterError::Operation(format!("enregistrement des tâches : {error}")))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<ScheduledTask>> {
        self.tasks.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// Ouvre le registre dans le dossier de données de NEXUS (`schedule/tasks.json`).
pub fn open_store(data_dir: Option<PathBuf>) -> ScheduleStore {
    ScheduleStore::open(data_dir.map(|directory| directory.join("schedule").join("tasks.json")))
}

#[tauri::command]
pub fn schedule_list(store: State<'_, ScheduleStore>, caller: String) -> Result<Vec<ScheduledTask>, AdapterError> {
    require_core(&caller)?;
    Ok(store.list())
}

#[tauri::command]
pub fn schedule_save(store: State<'_, ScheduleStore>, caller: String, tasks: Vec<ScheduledTask>) -> Result<(), AdapterError> {
    require_core(&caller)?;
    store.save(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: u64, request: &str, recurrence: Recurrence) -> ScheduledTask {
        ScheduledTask { id, request: request.into(), recurrence, next_run_at: 1, created_at: 0 }
    }

    #[test]
    fn hours_and_minutes_are_checked_strictly() {
        assert!(valid_time("00:00"));
        assert!(valid_time("23:59"));
        assert!(!valid_time("24:00"));
        assert!(!valid_time("9:30"));
        assert!(!valid_time("09:60"));
        assert!(!valid_time("09-30"));
    }

    #[test]
    fn a_bad_weekday_or_an_empty_request_refuses_the_whole_list() {
        assert!(validate(&[task(1, "actus", Recurrence::Weekly { weekday: 1, time: "09:00".into() })]).is_ok());
        assert!(validate(&[task(1, "actus", Recurrence::Weekly { weekday: 7, time: "09:00".into() })]).is_err());
        assert!(validate(&[task(1, "   ", Recurrence::Daily { time: "09:00".into() })]).is_err());
        assert!(validate(&[task(1, "x", Recurrence::Daily { time: "99:00".into() })]).is_err());
    }

    #[test]
    fn the_list_is_bounded() {
        let many: Vec<ScheduledTask> = (0..=MAX_TASKS as u64).map(|id| task(id, "x", Recurrence::Daily { time: "09:00".into() })).collect();
        assert!(validate(&many).is_err());
    }

    #[test]
    fn tasks_survive_a_restart_and_a_refused_list_changes_nothing() {
        let directory = std::env::temp_dir().join(format!("nexus-schedule-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let file = directory.join("schedule").join("tasks.json");
        let store = ScheduleStore::open(Some(file.clone()));
        store.save(vec![task(1, "résume mes actus", Recurrence::Daily { time: "08:00".into() })]).unwrap();
        assert!(store.save(vec![task(2, "", Recurrence::Daily { time: "08:00".into() })]).is_err());
        let reopened = ScheduleStore::open(Some(file));
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.list()[0].request, "résume mes actus");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn the_interface_format_round_trips_through_json() {
        let text = r#"[{"id":1,"request":"x","recurrence":{"kind":"weekly","weekday":1,"time":"09:00"},"nextRunAt":5,"createdAt":0}]"#;
        let tasks: Vec<ScheduledTask> = serde_json::from_str(text).unwrap();
        assert_eq!(tasks[0].recurrence, Recurrence::Weekly { weekday: 1, time: "09:00".into() });
        assert!(validate(&tasks).is_ok());
    }
}
