//! Qui peut utiliser quelle permission côté natif.
//!
//! Chaque commande native reçoit l'identifiant de son appelant : `core` pour l'interface, `type.dossier` pour un
//! plugin (p. ex. `actions.file-search`). Elle vérifie la permission correspondante avant toute action. La table
//! doit rester identique aux `plugin.json` : un test le vérifie.
//!
//! Limite : l'identifiant est fourni par la fenêtre. Il empêche un plugin de dépasser son manifeste lorsqu'il passe
//! par le pont de NEXUS, mais pas un script hostile qui appellerait directement Tauri. Voir `docs/PERMISSIONS.md`.

use crate::error::AdapterError;
use crate::permissions::Permission;

/// Appelant de l'interface principale. Il ne peut que répondre aux confirmations.
pub const CORE: &str = "core";

const GRANTS: &[(&str, &[Permission])] = &[
    ("actions.process-list", &[Permission::SystemRead]),
    ("actions.file-search", &[Permission::FileRead]),
    ("actions.file-operations", &[Permission::FileWrite, Permission::FileDelete]),
    ("agents.claude-code", &[Permission::AgentRun]),
    ("actions.window-control", &[Permission::WindowRead, Permission::WindowControl]),
];

/// Refuse l'action si l'appelant n'a pas reçu cette permission dans son manifeste.
pub fn require(caller: &str, permission: Permission) -> Result<(), AdapterError> {
    let granted = GRANTS.iter().find(|(id, _)| *id == caller).map(|(_, permissions)| *permissions).unwrap_or(&[]);
    if granted.contains(&permission) {
        Ok(())
    } else {
        Err(AdapterError::PermissionRefused(format!("{caller} → {}", permission.id())))
    }
}

/// Seule l'interface peut répondre à une demande de confirmation : un plugin ne peut pas s'approuver lui-même.
pub fn require_core(caller: &str) -> Result<(), AdapterError> {
    if caller == CORE {
        Ok(())
    } else {
        Err(AdapterError::PermissionRefused(format!("{caller} ne peut pas répondre à une confirmation")))
    }
}

#[cfg(test)]
pub(crate) fn grants_for(caller: &str) -> &'static [Permission] {
    GRANTS.iter().find(|(id, _)| *id == caller).map(|(_, permissions)| *permissions).unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plugin_cannot_use_a_permission_it_was_not_granted() {
        assert!(require("actions.process-list", Permission::SystemRead).is_ok());
        assert!(matches!(require("actions.process-list", Permission::FileDelete), Err(AdapterError::PermissionRefused(_))));
        assert!(matches!(require("actions.file-search", Permission::FileWrite), Err(AdapterError::PermissionRefused(_))));
    }

    #[test]
    fn an_unknown_caller_has_no_permission() {
        assert!(matches!(require("actions.inconnu", Permission::SystemRead), Err(AdapterError::PermissionRefused(_))));
        assert!(matches!(require(CORE, Permission::FileRead), Err(AdapterError::PermissionRefused(_))));
    }

    #[test]
    fn only_the_interface_can_answer_a_confirmation() {
        assert!(require_core(CORE).is_ok());
        assert!(matches!(require_core("agents.claude-code"), Err(AdapterError::PermissionRefused(_))));
    }

    /// La table doit refléter les `plugin.json` : une permission ajoutée à un plugin sans être accordée ici,
    /// ou l'inverse, est une erreur de configuration.
    #[test]
    fn the_table_matches_the_plugin_manifests() {
        let plugins = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("plugins");
        let mut declared: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
        for kind in std::fs::read_dir(&plugins).unwrap().flatten() {
            for folder in std::fs::read_dir(kind.path()).unwrap().flatten() {
                let manifest = folder.path().join("plugin.json");
                if !manifest.exists() {
                    continue;
                }
                let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
                let id = json["id"].as_str().unwrap().to_string();
                let permissions = json["permissions"].as_array().unwrap().iter().map(|p| p.as_str().unwrap().to_string()).collect();
                declared.insert(id, permissions);
            }
        }

        for (caller, granted) in GRANTS {
            let manifest = declared.get(*caller).unwrap_or_else(|| panic!("plugin absent du dépôt : {caller}"));
            let mut expected: Vec<&str> = granted.iter().map(|p| p.id()).collect();
            let mut actual: Vec<&str> = manifest.iter().map(String::as_str).collect();
            expected.sort_unstable();
            actual.sort_unstable();
            assert_eq!(actual, expected, "permissions de {caller}");
        }

        // Tout plugin qui demande une action sensible doit être connu du natif.
        for (id, permissions) in &declared {
            for permission in permissions.iter().filter_map(|p| Permission::from_id(p)) {
                if permission.tier() != crate::permissions::Tier::Automatic {
                    assert!(!grants_for(id).is_empty(), "{id} demande {} sans être accordé côté natif", permission.id());
                }
            }
        }
    }
}
