//! Connecteurs installés, dans le dossier de données de NEXUS. Les valeurs (jetons, identifiants) sont gardées en clair
//! dans ce fichier local : elles ne quittent jamais ce poste, et l'interface ne les relit pas. Un chiffrement du
//! fichier par Windows (DPAPI) reste à faire.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::catalog::{Candidate, EnvSpec};
use crate::error::AdapterError;

const MAX_VALUE_CHARS: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub title: String,
    pub package: String,
    pub version: String,
    pub env: Vec<EnvSpec>,
    #[serde(default)]
    pub values: BTreeMap<String, String>,
}

/// Vue pour l'interface : les noms des variables et s'ils sont renseignés, jamais leurs valeurs.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledView {
    pub id: String,
    pub title: String,
    pub package: String,
    pub version: String,
    pub variables: Vec<VariableView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VariableView {
    pub name: String,
    pub required: bool,
    pub secret: bool,
    pub description: String,
    pub is_set: bool,
}

impl Installed {
    pub fn view(&self) -> InstalledView {
        InstalledView {
            id: self.id.clone(),
            title: self.title.clone(),
            package: self.package.clone(),
            version: self.version.clone(),
            variables: self
                .env
                .iter()
                .map(|spec| VariableView {
                    name: spec.name.clone(),
                    required: spec.required,
                    secret: spec.secret,
                    description: spec.description.clone(),
                    is_set: self.values.contains_key(&spec.name),
                })
                .collect(),
        }
    }

    /// Variables requises qui n'ont pas encore de valeur.
    pub fn missing_required(&self) -> Vec<String> {
        self.env.iter().filter(|spec| spec.required && !self.values.contains_key(&spec.name)).map(|spec| spec.name.clone()).collect()
    }
}

/// Registre des connecteurs installés. Sans dossier de données (rare), il reste en mémoire pour la session.
pub struct Store {
    path: Option<PathBuf>,
    items: Mutex<Vec<Installed>>,
}

impl Store {
    pub fn open(path: Option<PathBuf>) -> Self {
        let items = path
            .as_ref()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|text| serde_json::from_str::<Vec<Installed>>(&text).ok())
            .unwrap_or_default();
        Store { path, items: Mutex::new(items) }
    }

    pub fn list(&self) -> Vec<Installed> {
        self.lock().clone()
    }

    pub fn get(&self, id: &str) -> Option<Installed> {
        self.lock().iter().find(|item| item.id == id).cloned()
    }

    /// Ajoute un connecteur trouvé par la recherche. Une réinstallation remplace la fiche et repart sans valeurs.
    pub fn install(&self, candidate: &Candidate) -> Result<Installed, AdapterError> {
        let installed = Installed {
            id: candidate.id.clone(),
            title: candidate.title.clone(),
            package: candidate.package.clone(),
            version: candidate.version.clone(),
            env: candidate.env.clone(),
            values: BTreeMap::new(),
        };
        let mut items = self.lock();
        items.retain(|item| item.id != installed.id);
        items.push(installed.clone());
        self.save(&items)?;
        Ok(installed)
    }

    /// Renseigne une variable déclarée par le connecteur. Un nom inconnu est refusé.
    pub fn set_value(&self, id: &str, name: &str, value: &str) -> Result<(), AdapterError> {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > MAX_VALUE_CHARS || value.contains(['\n', '\r']) {
            return Err(AdapterError::InvalidTarget("valeur vide, trop longue ou sur plusieurs lignes".into()));
        }
        let mut items = self.lock();
        let item = items.iter_mut().find(|item| item.id == id).ok_or_else(|| AdapterError::InvalidTarget("connecteur non installé".into()))?;
        if !item.env.iter().any(|spec| spec.name == name) {
            return Err(AdapterError::InvalidTarget(format!("variable inconnue pour ce connecteur : {name}")));
        }
        item.values.insert(name.to_string(), value.to_string());
        self.save(&items)
    }

    fn save(&self, items: &[Installed]) -> Result<(), AdapterError> {
        let Some(path) = &self.path else { return Ok(()) };
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|error| AdapterError::Operation(format!("dossier des connecteurs : {error}")))?;
        }
        let text = serde_json::to_string_pretty(items).map_err(|error| AdapterError::Operation(error.to_string()))?;
        std::fs::write(path, text).map_err(|error| AdapterError::Operation(format!("enregistrement des connecteurs : {error}")))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Installed>> {
        self.items.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate() -> Candidate {
        Candidate {
            id: "app.example/discord".into(),
            title: "discord".into(),
            description: "Discord".into(),
            repository: "https://github.com/acme/discord-mcp".into(),
            stars: 120,
            package: "@acme/discord-mcp".into(),
            version: "1.2.0".into(),
            env: vec![EnvSpec { name: "DISCORD_BOT_TOKEN".into(), required: true, secret: true, description: String::new() }],
        }
    }

    #[test]
    fn an_installed_connector_lists_its_missing_secret_and_never_shows_its_value() {
        let store = Store::open(None);
        store.install(&candidate()).unwrap();
        assert_eq!(store.get("app.example/discord").unwrap().missing_required(), vec!["DISCORD_BOT_TOKEN".to_string()]);
        store.set_value("app.example/discord", "DISCORD_BOT_TOKEN", "  secret-value  ").unwrap();
        let installed = store.get("app.example/discord").unwrap();
        assert!(installed.missing_required().is_empty());
        let view = serde_json::to_string(&installed.view()).unwrap();
        assert!(!view.contains("secret-value"), "{view}");
        assert!(view.contains("\"isSet\":true"));
    }

    #[test]
    fn a_variable_the_connector_does_not_declare_is_refused() {
        let store = Store::open(None);
        store.install(&candidate()).unwrap();
        assert!(store.set_value("app.example/discord", "PATH", "C:\\").is_err());
        assert!(store.set_value("app.example/discord", "DISCORD_BOT_TOKEN", "a\nb").is_err());
        assert!(store.set_value("app.example/discord", "DISCORD_BOT_TOKEN", "   ").is_err());
    }

    #[test]
    fn the_registry_survives_a_restart_on_disk() {
        let directory = std::env::temp_dir().join(format!("nexus-mcp-store-{}", std::process::id()));
        let file = directory.join("installed.json");
        let _ = std::fs::remove_dir_all(&directory);
        Store::open(Some(file.clone())).install(&candidate()).unwrap();
        let reopened = Store::open(Some(file));
        assert_eq!(reopened.list().len(), 1);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
