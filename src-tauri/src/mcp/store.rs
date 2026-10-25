//! Connecteurs installés, dans le dossier de données de NEXUS. Les valeurs (jetons, identifiants) sont chiffrées avec
//! DPAPI (`secrets.rs`) avant d'être écrites : le fichier ne contient jamais leur texte. Un fichier ancien, avec des
//! valeurs en clair, est migré à l'ouverture. L'interface ne relit jamais les valeurs.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::catalog::{Candidate, EnvSpec};
use super::scope::{default_scopes, ToolClass};
use crate::error::AdapterError;
use crate::secrets;

const MAX_VALUE_CHARS: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub title: String,
    pub package: String,
    pub version: String,
    pub env: Vec<EnvSpec>,
    /// Valeurs en mémoire. Ne sont écrites qu'en version chiffrée ; une valeur en clair ne vient que d'un ancien fichier.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, String>,
    /// Valeurs chiffrées (DPAPI, en hexadécimal) : le JSON de la table `values`, tel qu'écrit sur le disque.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected: Option<String>,
    /// Classes d'outils que le connecteur peut appeler. Lecture seule par défaut ; écriture et suppression s'accordent.
    #[serde(default = "default_scopes")]
    pub scopes: Vec<ToolClass>,
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
    pub scopes: Vec<ToolClass>,
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
            scopes: self.scopes.clone(),
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
    /// Ouvre le registre. Les valeurs chiffrées sont déchiffrées en mémoire ; une valeur en clair (ancien fichier)
    /// est reprise puis le fichier est réécrit chiffré. Une valeur illisible (autre compte Windows) reste sans effet.
    pub fn open(path: Option<PathBuf>) -> Self {
        let mut items = path
            .as_ref()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .and_then(|text| serde_json::from_str::<Vec<Installed>>(&text).ok())
            .unwrap_or_default();
        let mut has_clear_values = false;
        for item in &mut items {
            if let Some(map) = item.protected.as_deref().and_then(unseal_values) {
                item.values.extend(map);
            }
            has_clear_values |= !item.values.is_empty() && item.protected.is_none();
        }
        let store = Store { path, items: Mutex::new(items) };
        if has_clear_values {
            // Migration : une écriture chiffrée remplace le texte en clair. Un échec laisse le fichier tel quel.
            let items = store.lock().clone();
            let _ = store.save(&items);
        }
        store
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
            protected: None,
            scopes: default_scopes(),
        };
        let mut items = self.lock();
        items.retain(|item| item.id != installed.id);
        items.push(installed.clone());
        self.save(&items)?;
        Ok(installed)
    }

    /// Renseigne une variable déclarée par le connecteur. Un nom inconnu est refusé.
    /// Change le périmètre d'un connecteur installé. L'accord de l'utilisateur est pris avant, par le courtier.
    pub fn set_scopes(&self, id: &str, scopes: Vec<ToolClass>) -> Result<Installed, AdapterError> {
        let mut items = self.lock();
        let item = items.iter_mut().find(|item| item.id == id).ok_or_else(|| AdapterError::InvalidTarget("connecteur non installé".into()))?;
        let previous = std::mem::replace(&mut item.scopes, scopes);
        let updated = item.clone();
        if let Err(error) = self.save(&items) {
            if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                item.scopes = previous;
            }
            return Err(error);
        }
        Ok(updated)
    }

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
        let previous = item.values.insert(name.to_string(), value.to_string());
        let saved = self.save(&items);
        if saved.is_err() {
            // Rien ne doit rester en mémoire si la valeur n'a pas pu être protégée et écrite.
            if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                match previous {
                    Some(old) => item.values.insert(name.to_string(), old),
                    None => item.values.remove(name),
                };
            }
        }
        saved
    }

    /// Écrit le registre avec les valeurs chiffrées. Sans protection disponible, l'écriture échoue : rien n'est écrit en clair.
    fn save(&self, items: &[Installed]) -> Result<(), AdapterError> {
        let Some(path) = &self.path else { return Ok(()) };
        let sealed = items
            .iter()
            .map(|item| {
                let mut copy = item.clone();
                if !copy.values.is_empty() {
                    copy.protected = Some(seal_values(&copy.values)?);
                    copy.values.clear();
                }
                Ok(copy)
            })
            .collect::<Result<Vec<Installed>, AdapterError>>()?;
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|error| AdapterError::Operation(format!("dossier des connecteurs : {error}")))?;
        }
        let text = serde_json::to_string_pretty(&sealed).map_err(|error| AdapterError::Operation(error.to_string()))?;
        std::fs::write(path, text).map_err(|error| AdapterError::Operation(format!("enregistrement des connecteurs : {error}")))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Installed>> {
        self.items.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// Valeurs d'un connecteur, chiffrées pour le compte Windows courant (texte hexadécimal).
fn seal_values(values: &BTreeMap<String, String>) -> Result<String, AdapterError> {
    let json = serde_json::to_vec(values).map_err(|error| AdapterError::Operation(error.to_string()))?;
    Ok(secrets::to_hex(&secrets::protect(&json)?))
}

/// Valeurs déchiffrées, ou `None` si le blob est corrompu ou vient d'un autre compte Windows.
fn unseal_values(sealed: &str) -> Option<BTreeMap<String, String>> {
    let plain = secrets::unprotect(&secrets::from_hex(sealed)?).ok()?;
    serde_json::from_slice(&plain).ok()
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

    fn scratch_file(name: &str) -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!("nexus-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        (directory.clone(), directory.join("installed.json"))
    }

    #[cfg(windows)]
    #[test]
    fn a_saved_secret_is_encrypted_on_disk_and_comes_back_after_a_restart() {
        let (directory, file) = scratch_file("secret");
        let store = Store::open(Some(file.clone()));
        store.install(&candidate()).unwrap();
        store.set_value("app.example/discord", "DISCORD_BOT_TOKEN", "jeton-de-test-7731").unwrap();
        let on_disk = std::fs::read_to_string(&file).unwrap();
        assert!(!on_disk.contains("jeton-de-test-7731"), "le jeton ne doit pas être écrit en clair");
        assert!(!on_disk.contains("\"values\""), "aucune table de valeurs en clair dans le fichier");
        let reopened = Store::open(Some(file));
        assert!(reopened.get("app.example/discord").unwrap().missing_required().is_empty());
        assert_eq!(reopened.get("app.example/discord").unwrap().values["DISCORD_BOT_TOKEN"], "jeton-de-test-7731");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_with_clear_values_is_migrated_to_the_protected_form() {
        let (directory, file) = scratch_file("legacy");
        std::fs::create_dir_all(&directory).unwrap();
        let legacy = r#"[{"id":"app.example/discord","title":"discord","package":"@acme/discord-mcp","version":"1.2.0",
            "env":[{"name":"DISCORD_BOT_TOKEN","required":true,"secret":true,"description":""}],
            "values":{"DISCORD_BOT_TOKEN":"ancien-jeton-clair-42"}}]"#;
        std::fs::write(&file, legacy).unwrap();
        let store = Store::open(Some(file.clone()));
        assert_eq!(store.get("app.example/discord").unwrap().values["DISCORD_BOT_TOKEN"], "ancien-jeton-clair-42");
        let migrated = std::fs::read_to_string(&file).unwrap();
        assert!(!migrated.contains("ancien-jeton-clair-42"), "la migration doit retirer le texte en clair");
        assert!(migrated.contains("\"protected\""));
        let reopened = Store::open(Some(file));
        assert_eq!(reopened.get("app.example/discord").unwrap().values["DISCORD_BOT_TOKEN"], "ancien-jeton-clair-42");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_failed_save_leaves_no_value_in_memory() {
        let (directory, file) = scratch_file("unsaved");
        let store = Store::open(Some(file));
        store.install(&candidate()).unwrap();
        // Sans protection disponible (hors Windows), l'écriture échoue : la valeur ne doit pas rester en mémoire.
        if store.set_value("app.example/discord", "DISCORD_BOT_TOKEN", "valeur").is_err() {
            assert!(store.get("app.example/discord").unwrap().values.is_empty());
        }
        let _ = std::fs::remove_dir_all(&directory);
    }
}
