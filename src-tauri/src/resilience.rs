//! Délais des opérations qui attendent un service (Ollama, le web, les connecteurs) et mesures des ressources de NEXUS.
//!
//! Aucune opération ne doit attendre sans fin : chacune a un délai, réglable dans les réglages entre 5 s et 10 min. Le
//! délai est pris au moment de l'appel. Les réglages sont dans `budgets.json`, dans le dossier de données, et ne
//! contiennent que des nombres.
//!
//! Le délai d'une classification ou d'une vision est un délai de réponse complète : un modèle trop lent est interrompu
//! et l'interface affiche l'échec. Le téléchargement d'un modèle n'a pas de délai total (il dure longtemps), mais il est
//! interrompu si Ollama ne produit plus rien pendant `STALL_TIMEOUT`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State;

use crate::error::AdapterError;
use crate::grants::require_main;

pub const MIN_SECS: u64 = 5;
pub const MAX_SECS: u64 = 600;
/// Silence maximal d'un téléchargement de modèle avant qu'il soit considéré comme bloqué.
pub const STALL_TIMEOUT: Duration = Duration::from_secs(120);

/// Opérations dont le délai est réglable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Budget {
    /// Classification d'une demande par le modèle local.
    Classify,
    /// Lecture d'une capture d'écran par le modèle de vision.
    Vision,
    /// Chaque requête vers une source web (Wikipédia, Commons, recherche, pages lues).
    Web,
    /// Plafond d'un connecteur d'observation : son délai propre ne peut pas dépasser ce plafond.
    Plugins,
}

impl Budget {
    pub const ALL: [Budget; 4] = [Budget::Classify, Budget::Vision, Budget::Web, Budget::Plugins];

    pub fn key(self) -> &'static str {
        match self {
            Budget::Classify => "classify",
            Budget::Vision => "vision",
            Budget::Web => "web",
            Budget::Plugins => "plugins",
        }
    }

    pub fn default_secs(self) -> u64 {
        match self {
            Budget::Classify => 60,
            Budget::Vision => 120,
            Budget::Web => 15,
            Budget::Plugins => 120,
        }
    }

    pub fn from_key(key: &str) -> Option<Budget> {
        Budget::ALL.into_iter().find(|budget| budget.key() == key)
    }
}

/// Réglages courants, lus à chaque appel. Vide : chaque opération prend son délai par défaut.
static OVERRIDES: RwLock<BTreeMap<&'static str, u64>> = RwLock::new(BTreeMap::new());
/// Fichier des réglages, fixé au démarrage. Sans fichier, les réglages restent en mémoire.
static FILE: OnceLock<PathBuf> = OnceLock::new();

/// Délai à appliquer à une opération.
pub fn delay_for(budget: Budget) -> Duration {
    let overrides = OVERRIDES.read().unwrap_or_else(|error| error.into_inner());
    Duration::from_secs(overrides.get(budget.key()).copied().unwrap_or(budget.default_secs()))
}

/// Délai valide : un nombre de secondes entre 5 s et 10 min. Hors de cet intervalle, le réglage est refusé.
pub fn validate_secs(seconds: u64) -> Result<u64, AdapterError> {
    if (MIN_SECS..=MAX_SECS).contains(&seconds) {
        Ok(seconds)
    } else {
        Err(AdapterError::InvalidTarget(format!("délai entre {MIN_SECS} s et {MAX_SECS} s")))
    }
}

/// Lit le fichier des réglages. Une valeur illisible ou hors bornes est ignorée : le défaut s'applique.
pub fn parse_overrides(text: &str) -> BTreeMap<&'static str, u64> {
    // Lu valeur par valeur : une entrée abîmée ne fait pas perdre les autres.
    let stored: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
    Budget::ALL
        .into_iter()
        .filter_map(|budget| {
            let seconds = stored.get(budget.key()).and_then(serde_json::Value::as_u64)?;
            validate_secs(seconds).ok().map(|seconds| (budget.key(), seconds))
        })
        .collect()
}

pub fn render_overrides(overrides: &BTreeMap<&'static str, u64>) -> String {
    serde_json::to_string_pretty(overrides).unwrap_or_else(|_| "{}".into())
}

/// Charge les réglages enregistrés, une fois, au démarrage.
pub fn configure(directory: Option<PathBuf>) {
    let Some(directory) = directory else { return };
    let file = directory.join("budgets.json");
    if let Ok(text) = std::fs::read_to_string(&file) {
        let loaded = parse_overrides(&text);
        *OVERRIDES.write().unwrap_or_else(|error| error.into_inner()) = loaded;
    }
    let _ = FILE.set(file);
}

/// Enregistre un délai. Le réglage est appliqué tout de suite, et écrit dans le fichier s'il existe.
pub fn set_budget(budget: Budget, seconds: u64) -> Result<(), AdapterError> {
    let seconds = validate_secs(seconds)?;
    let snapshot = {
        let mut overrides = OVERRIDES.write().unwrap_or_else(|error| error.into_inner());
        overrides.insert(budget.key(), seconds);
        overrides.clone()
    };
    if let Some(file) = FILE.get() {
        std::fs::write(file, render_overrides(&snapshot)).map_err(|error| AdapterError::Operation(format!("enregistrement des délais : {error}")))?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetView {
    pub key: &'static str,
    pub seconds: u64,
    pub default_seconds: u64,
}

pub fn budget_views() -> Vec<BudgetView> {
    Budget::ALL
        .into_iter()
        .map(|item| BudgetView { key: item.key(), seconds: delay_for(item).as_secs(), default_seconds: item.default_secs() })
        .collect()
}

#[tauri::command]
pub fn budgets_get(webview: tauri::Webview) -> Result<Vec<BudgetView>, AdapterError> {
    require_main(&webview)?;
    Ok(budget_views())
}

#[tauri::command]
pub fn budgets_set(webview: tauri::Webview, key: String, seconds: u64) -> Result<Vec<BudgetView>, AdapterError> {
    require_main(&webview)?;
    let budget = Budget::from_key(&key).ok_or_else(|| AdapterError::InvalidTarget(format!("délai inconnu : {key}")))?;
    set_budget(budget, seconds)?;
    Ok(budget_views())
}

/// Mémoire vive utilisée par NEXUS (processus courant), en Mo. Mesure locale, jamais envoyée.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceStatus {
    pub process_memory_mb: Option<f64>,
}

pub fn process_memory_mb() -> Option<f64> {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    system.process(pid).map(|process| process.memory() as f64 / (1024.0 * 1024.0))
}

#[tauri::command]
pub async fn resources_status(webview: tauri::Webview) -> Result<ResourceStatus, AdapterError> {
    require_main(&webview)?;
    let memory = tauri::async_runtime::spawn_blocking(process_memory_mb).await.map_err(|error| AdapterError::TaskFailed(error.to_string()))?;
    Ok(ResourceStatus { process_memory_mb: memory })
}

/// Annulation d'un téléchargement de modèle en cours. Le signal est lu entre deux étapes.
#[derive(Default)]
pub struct PullControl(pub std::sync::Arc<std::sync::atomic::AtomicBool>);

#[tauri::command]
pub fn ollama_pull_cancel(webview: tauri::Webview, control: State<'_, PullControl>) -> Result<(), AdapterError> {
    require_main(&webview)?;
    control.0.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_delay_has_a_default_inside_the_allowed_bounds() {
        for budget in Budget::ALL {
            assert!((MIN_SECS..=MAX_SECS).contains(&budget.default_secs()), "{}", budget.key());
            assert_eq!(Budget::from_key(budget.key()), Some(budget));
        }
        assert_eq!(Budget::from_key("inconnu"), None);
    }

    #[test]
    fn a_delay_outside_five_seconds_to_ten_minutes_is_refused() {
        assert!(validate_secs(MIN_SECS).is_ok());
        assert!(validate_secs(MAX_SECS).is_ok());
        assert!(validate_secs(MIN_SECS - 1).is_err());
        assert!(validate_secs(MAX_SECS + 1).is_err());
        assert!(validate_secs(0).is_err());
    }

    /// Un fichier de réglages abîmé ne doit ni planter NEXUS, ni laisser passer une valeur absurde.
    #[test]
    fn the_saved_delays_keep_only_valid_known_values() {
        let overrides = parse_overrides(r#"{"classify": 90, "vision": 99999, "web": 1, "inconnu": 30, "plugins": "x"}"#);
        assert_eq!(overrides.get("classify"), Some(&90));
        assert!(!overrides.contains_key("vision"), "hors bornes");
        assert!(!overrides.contains_key("web"), "sous le minimum");
        assert!(!overrides.contains_key("inconnu"));
        assert!(!overrides.contains_key("plugins"));
        assert!(parse_overrides("pas du json").is_empty());
    }

    #[test]
    fn the_saved_delays_round_trip_through_the_file_format() {
        let mut overrides = BTreeMap::new();
        overrides.insert("vision", 240);
        assert_eq!(parse_overrides(&render_overrides(&overrides)), overrides);
    }

    #[test]
    fn this_process_reports_a_memory_figure() {
        let memory = process_memory_mb().expect("le processus courant doit être visible");
        assert!(memory > 0.0);
    }
}
