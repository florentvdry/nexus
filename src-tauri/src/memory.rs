//! Souvenirs de l'utilisateur : préférences et faits qu'il a demandé de retenir (« retiens que je préfère… »), ou que le
//! modèle a proposés et que l'utilisateur a acceptés. Ils restent sur ce poste, dans le dossier de données, et ne sont
//! envoyés au modèle local qu'au moment d'une demande. L'utilisateur les consulte, les supprime et peut tout effacer.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AdapterError;
use crate::grants::require_main;

/// Une information tient en une phrase : la borne protège seulement contre un texte démesuré. Pas de limite de nombre.
pub const MAX_TEXT_CHARS: usize = 1000;
const MIN_FORGET_CHARS: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: u64,
    pub text: String,
    /// Instant de l'enregistrement, en millisecondes depuis l'époque Unix.
    pub created_at: u64,
    /// `user` : demandé explicitement. `model` : proposé par le modèle, puis accepté.
    pub source: String,
}

/// Registre des souvenirs. Sans dossier de données, il reste en mémoire pour la session.
pub struct MemoryStore {
    path: Option<PathBuf>,
    items: Mutex<Vec<Memory>>,
}

/// Texte d'un souvenir : une seule ligne, non vide, borné. Le reste est refusé.
pub fn clean_text(text: &str) -> Result<String, AdapterError> {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return Err(AdapterError::InvalidTarget("souvenir vide".into()));
    }
    if collapsed.chars().count() > MAX_TEXT_CHARS {
        return Err(AdapterError::InvalidTarget(format!("souvenir trop long (plus de {MAX_TEXT_CHARS} caractères)")));
    }
    Ok(collapsed)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0)
}

impl MemoryStore {
    pub fn open(path: Option<PathBuf>) -> Self {
        let items = path
            .as_ref()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|text| serde_json::from_str::<Vec<Memory>>(&text).ok())
            .unwrap_or_default();
        MemoryStore { path, items: Mutex::new(items) }
    }

    pub fn list(&self) -> Vec<Memory> {
        self.lock().clone()
    }

    /// Ajoute un souvenir. Un texte déjà présent (à la casse près) n'est pas dupliqué.
    pub fn add(&self, text: &str, source: &str) -> Result<Memory, AdapterError> {
        if source != "user" && source != "model" {
            return Err(AdapterError::InvalidTarget("origine de souvenir inconnue".into()));
        }
        let text = clean_text(text)?;
        let mut items = self.lock();
        if let Some(existing) = items.iter().find(|item| item.text.to_lowercase() == text.to_lowercase()) {
            return Ok(existing.clone());
        }
        let next_id = items.iter().map(|item| item.id).max().unwrap_or(0) + 1;
        let memory = Memory { id: next_id, text, created_at: now_millis(), source: source.to_string() };
        items.push(memory.clone());
        self.save(&items)?;
        Ok(memory)
    }

    pub fn remove(&self, id: u64) -> Result<bool, AdapterError> {
        let mut items = self.lock();
        let before = items.len();
        let gone: Vec<String> = items.iter().filter(|item| item.id == id).map(|item| item.text.clone()).collect();
        items.retain(|item| item.id != id);
        let removed = items.len() != before;
        if removed {
            self.save_removing(&items, &gone)?;
        }
        Ok(removed)
    }

    /// Supprime les souvenirs qui contiennent `query` (sans tenir compte de la casse). Renvoie leur nombre.
    pub fn forget(&self, query: &str) -> Result<usize, AdapterError> {
        let needle = query.trim().to_lowercase();
        if needle.chars().count() < MIN_FORGET_CHARS {
            return Err(AdapterError::InvalidTarget("précise ce que tu veux oublier".into()));
        }
        let mut items = self.lock();
        let before = items.len();
        let gone: Vec<String> = items.iter().filter(|item| item.text.to_lowercase().contains(&needle)).map(|item| item.text.clone()).collect();
        items.retain(|item| !item.text.to_lowercase().contains(&needle));
        let removed = before - items.len();
        if removed > 0 {
            self.save_removing(&items, &gone)?;
        }
        Ok(removed)
    }

    pub fn clear(&self) -> Result<usize, AdapterError> {
        let mut items = self.lock();
        let count = items.len();
        let gone: Vec<String> = items.iter().map(|item| item.text.clone()).collect();
        items.clear();
        self.save_removing(&items, &gone)?;
        Ok(count)
    }

    /// Tous les souvenirs, au format du fichier : c'est ce que l'utilisateur emporte s'il exporte.
    pub fn export(&self) -> Result<String, AdapterError> {
        serde_json::to_string_pretty(&self.list()).map_err(|error| AdapterError::Operation(error.to_string()))
    }

    /// Écrit le registre puis relit le fichier : les textes supprimés doivent avoir disparu. Un échec est signalé,
    /// jamais passé sous silence. Les blocs du disque peuvent rester lisibles tant que le disque n'est pas chiffré.
    fn save_removing(&self, items: &[Memory], removed: &[String]) -> Result<(), AdapterError> {
        self.save(items)?;
        let Some(path) = &self.path else { return Ok(()) };
        let on_disk = std::fs::read_to_string(path).map_err(|error| AdapterError::Operation(format!("contrôle d'effacement : {error}")))?;
        for text in removed.iter().filter(|text| !text.is_empty()) {
            // Le texte est cherché tel qu'il est écrit dans le fichier JSON (guillemets et antislashs échappés).
            let escaped = serde_json::to_string(text).unwrap_or_default();
            let fragment = escaped.trim_matches('"');
            if on_disk.contains(fragment) {
                return Err(AdapterError::Operation("effacement non vérifié : le fichier contient encore le souvenir supprimé".into()));
            }
        }
        Ok(())
    }

    fn save(&self, items: &[Memory]) -> Result<(), AdapterError> {
        let Some(path) = &self.path else { return Ok(()) };
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|error| AdapterError::Operation(format!("dossier des souvenirs : {error}")))?;
        }
        let text = serde_json::to_string_pretty(items).map_err(|error| AdapterError::Operation(error.to_string()))?;
        std::fs::write(path, text).map_err(|error| AdapterError::Operation(format!("enregistrement des souvenirs : {error}")))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Memory>> {
        self.items.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// Ouvre le registre dans le dossier de données de NEXUS (`memory/memories.json`).
pub fn open_store(data_dir: Option<PathBuf>) -> MemoryStore {
    MemoryStore::open(data_dir.map(|directory| directory.join("memory").join("memories.json")))
}

#[tauri::command]
pub fn memory_list(store: State<'_, MemoryStore>, webview: tauri::Webview) -> Result<Vec<Memory>, AdapterError> {
    require_main(&webview)?;
    Ok(store.list())
}

#[tauri::command]
pub fn memory_add(store: State<'_, MemoryStore>, webview: tauri::Webview, text: String, source: String) -> Result<Memory, AdapterError> {
    require_main(&webview)?;
    store.add(&text, &source)
}

#[tauri::command]
pub fn memory_remove(store: State<'_, MemoryStore>, webview: tauri::Webview, id: u64) -> Result<bool, AdapterError> {
    require_main(&webview)?;
    store.remove(id)
}

#[tauri::command]
pub fn memory_forget(store: State<'_, MemoryStore>, webview: tauri::Webview, query: String) -> Result<usize, AdapterError> {
    require_main(&webview)?;
    store.forget(&query)
}

#[tauri::command]
pub fn memory_clear(store: State<'_, MemoryStore>, webview: tauri::Webview) -> Result<usize, AdapterError> {
    require_main(&webview)?;
    store.clear()
}

/// Export des souvenirs, en JSON, pour que l'utilisateur les garde ou les emporte.
#[tauri::command]
pub fn memory_export(store: State<'_, MemoryStore>, webview: tauri::Webview) -> Result<String, AdapterError> {
    require_main(&webview)?;
    store.export()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("nexus-memory-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        directory.join("memories.json")
    }

    #[test]
    fn a_memory_is_one_clean_line_and_never_empty_or_huge() {
        assert_eq!(clean_text("  je préfère\n  le   thé ").unwrap(), "je préfère le thé");
        assert!(clean_text("   ").is_err());
        assert!(clean_text(&"a".repeat(MAX_TEXT_CHARS + 1)).is_err());
    }

    #[test]
    fn the_same_memory_is_not_stored_twice_whatever_the_case() {
        let store = MemoryStore::open(None);
        let first = store.add("Je préfère Firefox", "user").unwrap();
        let again = store.add("je préfère firefox", "user").unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(store.list().len(), 1);
    }

    /// Après suppression, le texte n'est plus dans le fichier, ni après un nouvel ouverture du registre.
    #[test]
    fn a_forgotten_memory_is_gone_from_the_file_and_stays_gone() {
        let file = temp_file("erase");
        let store = MemoryStore::open(Some(file.clone()));
        store.add("Je préfère Firefox", "user").unwrap();
        store.add("Mon code secret est 4721", "user").unwrap();
        assert_eq!(store.forget("code secret").unwrap(), 1);
        let on_disk = std::fs::read_to_string(&file).unwrap();
        assert!(!on_disk.contains("4721"), "le texte effacé ne doit plus être dans le fichier");
        assert!(on_disk.contains("Firefox"), "les autres souvenirs restent");
        assert_eq!(MemoryStore::open(Some(file.clone())).list().len(), 1);
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
    }

    #[test]
    fn clearing_leaves_no_memory_text_on_disk() {
        let file = temp_file("clear");
        let store = MemoryStore::open(Some(file.clone()));
        store.add("Je m'appelle Florent", "user").unwrap();
        store.clear().unwrap();
        let on_disk = std::fs::read_to_string(&file).unwrap();
        assert!(!on_disk.contains("Florent"));
        assert!(MemoryStore::open(Some(file.clone())).list().is_empty());
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
    }

    #[test]
    fn the_export_holds_every_memory_in_the_stored_format() {
        let store = MemoryStore::open(None);
        store.add("Je préfère Firefox", "user").unwrap();
        store.add("J'habite à Lyon", "model").unwrap();
        let exported: Vec<Memory> = serde_json::from_str(&store.export().unwrap()).unwrap();
        assert_eq!(exported, store.list());
    }

    #[test]
    fn forgetting_removes_the_matching_memories_only() {
        let store = MemoryStore::open(None);
        store.add("Je préfère Firefox", "user").unwrap();
        store.add("Je m'appelle Florent", "user").unwrap();
        assert_eq!(store.forget("FIREFOX").unwrap(), 1);
        assert_eq!(store.list().len(), 1);
        assert!(store.forget("x").is_err(), "une requête trop courte est refusée");
    }

    #[test]
    fn no_memory_is_dropped_however_many_are_stored() {
        let store = MemoryStore::open(None);
        for index in 0..500 {
            store.add(&format!("souvenir {index}"), "user").unwrap();
        }
        let items = store.list();
        assert_eq!(items.len(), 500);
        assert_eq!(items[0].text, "souvenir 0");
    }

    #[test]
    fn an_unknown_source_is_refused() {
        assert!(MemoryStore::open(None).add("x y", "internet").is_err());
    }

    #[test]
    fn memories_survive_a_restart_and_clear_removes_them() {
        let file = temp_file("restart");
        let store = MemoryStore::open(Some(file.clone()));
        store.add("Je préfère le thé", "user").unwrap();
        let reopened = MemoryStore::open(Some(file.clone()));
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.clear().unwrap(), 1);
        assert!(MemoryStore::open(Some(file.clone())).list().is_empty());
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
    }
}
