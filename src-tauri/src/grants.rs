//! Qui peut faire quoi côté natif. Une seule table, la même pour toutes les commandes.
//!
//! L'interface n'envoie plus son identité : aucune commande ne lit une chaîne `caller` fournie par le JavaScript. Chaque
//! commande a une politique décidée ici, par le natif :
//! - `MainWindow` : seule la fenêtre principale peut l'appeler. Tauri atteste le libellé de la fenêtre appelante ; une
//!   autre fenêtre (qui n'existe pas aujourd'hui) est refusée.
//! - `Capability(identité)` : la commande exerce une capacité d'un plugin, et l'identité est une constante du natif. Les
//!   permissions de cette identité sont celles de son manifeste (`plugin.json`, vérifié par un test).
//!
//! Limite : le JavaScript de la fenêtre principale est celui de NEXUS. Il peut appeler toute commande de cette fenêtre.
//! La protection repose donc sur la CSP (aucun script tiers ni évaluation de chaîne, testé), sur les confirmations du
//! courtier (réponse explicite, jamais mémorisée pour les actions sensibles) et sur l'absence de plugin à code exécuté
//! dans la fenêtre : les plugins WebAssembly tournent côté natif. Voir `docs/PERMISSIONS.md`.

use crate::error::AdapterError;
use crate::permissions::Permission;

/// Libellé de la seule fenêtre de l'interface principale (`tauri.conf.json`).
pub const MAIN_WINDOW: &str = "main";
/// Fenêtre dédiée aux confirmations : seule fenêtre qui peut répondre à une demande (`tauri.conf.json`).
pub const CONFIRMATION_WINDOW: &str = "confirm";

pub const PROCESS_LIST: &str = "actions.process-list";
pub const FILE_SEARCH: &str = "actions.file-search";
pub const FILE_VIEW: &str = "actions.file-view";
pub const FILE_OPERATIONS: &str = "actions.file-operations";
pub const CLAUDE_CODE: &str = "agents.claude-code";
pub const WINDOW_CONTROL: &str = "actions.window-control";
pub const UI_AUTOMATION: &str = "actions.ui-automation";
pub const PLUGIN_MANAGER: &str = "actions.plugin-manager";

/// Permissions accordées à chaque identité de capacité, d'après leurs manifestes.
const GRANTS: &[(&str, &[Permission])] = &[
    (PROCESS_LIST, &[Permission::SystemRead]),
    (FILE_SEARCH, &[Permission::FileRead]),
    (FILE_VIEW, &[Permission::FileRead]),
    (FILE_OPERATIONS, &[Permission::FileWrite, Permission::FileDelete]),
    (CLAUDE_CODE, &[Permission::AgentRun]),
    (WINDOW_CONTROL, &[Permission::WindowRead, Permission::WindowControl]),
    (UI_AUTOMATION, &[Permission::WindowRead, Permission::WindowControl]),
    (PLUGIN_MANAGER, &[Permission::PluginManage]),
];

/// Politique de chaque commande native. Toute commande exposée doit figurer ici : un test le vérifie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    MainWindow,
    ConfirmationWindow,
    Capability(&'static str),
}

pub const POLICIES: &[(&str, Policy)] = &[
    // Commandes de l'interface : identité de la fenêtre principale.
    ("system_info", Policy::MainWindow),
    ("hardware_profile", Policy::MainWindow),
    ("model_classify", Policy::MainWindow),
    ("model_json", Policy::MainWindow),
    ("vision_ask", Policy::MainWindow),
    ("ollama_status", Policy::MainWindow),
    ("ollama_pull", Policy::MainWindow),
    ("ollama_install", Policy::MainWindow),
    ("mcp_search", Policy::MainWindow),
    ("mcp_installed", Policy::MainWindow),
    ("mcp_install", Policy::MainWindow),
    ("mcp_set_value", Policy::MainWindow),
    ("mcp_tools", Policy::MainWindow),
    ("mcp_call", Policy::MainWindow),
    ("mcp_set_scopes", Policy::MainWindow),
    ("memory_list", Policy::MainWindow),
    ("memory_add", Policy::MainWindow),
    ("memory_remove", Policy::MainWindow),
    ("memory_forget", Policy::MainWindow),
    ("memory_clear", Policy::MainWindow),
    ("memory_export", Policy::MainWindow),
    ("schedule_list", Policy::MainWindow),
    ("schedule_save", Policy::MainWindow),
    ("web_summary", Policy::MainWindow),
    ("web_photo", Policy::MainWindow),
    ("web_news", Policy::MainWindow),
    ("web_headlines", Policy::MainWindow),
    ("web_news_search", Policy::MainWindow),
    ("web_search", Policy::MainWindow),
    ("web_read", Policy::MainWindow),
    ("speech_neural_available", Policy::MainWindow),
    ("speech_neural_install", Policy::MainWindow),
    ("speech_neural_speak", Policy::MainWindow),
    ("voice_status", Policy::MainWindow),
    ("voice_start", Policy::MainWindow),
    ("voice_stop", Policy::MainWindow),
    ("startup_status", Policy::MainWindow),
    ("startup_set", Policy::MainWindow),
    ("battery_status", Policy::MainWindow),
    ("agenda_read", Policy::MainWindow),
    ("screen_capture", Policy::MainWindow),
    ("nim_classify", Policy::MainWindow),
    ("nim_key_status", Policy::MainWindow),
    ("nim_key_save", Policy::MainWindow),
    ("nim_key_clear", Policy::MainWindow),
    ("app_open", Policy::MainWindow),
    ("budgets_get", Policy::MainWindow),
    ("budgets_set", Policy::MainWindow),
    ("resources_status", Policy::MainWindow),
    ("ollama_pull_cancel", Policy::MainWindow),
    ("app_find", Policy::MainWindow),
    ("osint_run", Policy::MainWindow),
    ("journal_status", Policy::MainWindow),
    ("journal_set_enabled", Policy::MainWindow),
    ("journal_record", Policy::MainWindow),
    ("journal_list", Policy::MainWindow),
    ("journal_clear", Policy::MainWindow),
    ("plugin_packs", Policy::MainWindow),
    ("permission_answer", Policy::ConfirmationWindow),
    ("confirmation_pending", Policy::ConfirmationWindow),
    ("permission_rules", Policy::MainWindow),
    ("permission_revoke", Policy::MainWindow),
    ("permission_audit", Policy::MainWindow),
    ("permissions_status", Policy::MainWindow),
    // Commandes qui exercent une capacité de plugin : identité native.
    ("processes_list", Policy::Capability(PROCESS_LIST)),
    ("files_search", Policy::Capability(FILE_SEARCH)),
    ("files_read", Policy::Capability(FILE_VIEW)),
    ("files_operate", Policy::Capability(FILE_OPERATIONS)),
    ("agent_detect", Policy::Capability(CLAUDE_CODE)),
    ("agent_run", Policy::Capability(CLAUDE_CODE)),
    ("agent_cancel", Policy::Capability(CLAUDE_CODE)),
    ("window_list", Policy::Capability(WINDOW_CONTROL)),
    ("window_focus", Policy::Capability(WINDOW_CONTROL)),
    ("window_close", Policy::Capability(WINDOW_CONTROL)),
    ("ui_inspect", Policy::Capability(UI_AUTOMATION)),
    ("clipboard_read", Policy::MainWindow),
    ("ui_invoke", Policy::Capability(UI_AUTOMATION)),
    ("plugin_prepare", Policy::Capability(PLUGIN_MANAGER)),
    ("plugin_install", Policy::Capability(PLUGIN_MANAGER)),
    ("plugin_remove", Policy::Capability(PLUGIN_MANAGER)),
    ("plugin_run", Policy::Capability(PLUGIN_MANAGER)),
    ("plugin_list", Policy::Capability(PLUGIN_MANAGER)),
    ("plugin_index", Policy::Capability(PLUGIN_MANAGER)),
];

/// Vrai seulement pour la fenêtre de l'interface principale.
pub fn is_main_window(label: &str) -> bool {
    label == MAIN_WINDOW
}

/// Vrai seulement pour la fenêtre dédiée aux confirmations.
pub fn is_confirmation_window(label: &str) -> bool {
    label == CONFIRMATION_WINDOW
}

/// Refuse l'appel si la fenêtre qui l'envoie n'est pas la fenêtre de confirmation. L'interface principale ne peut donc
/// pas approuver une action : même un script injecté dans cette fenêtre n'y parvient pas.
pub fn require_confirmation(webview: &tauri::Webview) -> Result<(), AdapterError> {
    if is_confirmation_window(webview.label()) {
        Ok(())
    } else {
        Err(AdapterError::PermissionRefused(format!("{} : seule la fenêtre de confirmation répond", webview.label())))
    }
}

/// Refuse l'appel si la fenêtre qui l'envoie n'est pas l'interface principale.
pub fn require_main(webview: &tauri::Webview) -> Result<(), AdapterError> {
    if is_main_window(webview.label()) {
        Ok(())
    } else {
        Err(AdapterError::PermissionRefused(format!("{} : réservé à l'interface principale", webview.label())))
    }
}

/// Refuse l'action si l'identité n'a pas cette permission dans son manifeste.
pub fn require(identity: &str, permission: Permission) -> Result<(), AdapterError> {
    if grants_for(identity).contains(&permission) {
        Ok(())
    } else {
        Err(AdapterError::PermissionRefused(format!("{identity} → {}", permission.id())))
    }
}

fn grants_for(identity: &str) -> &'static [Permission] {
    GRANTS.iter().find(|(id, _)| *id == identity).map(|(_, permissions)| *permissions).unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plugin_cannot_use_a_permission_it_was_not_granted() {
        assert!(require(PROCESS_LIST, Permission::SystemRead).is_ok());
        assert!(matches!(require(PROCESS_LIST, Permission::FileDelete), Err(AdapterError::PermissionRefused(_))));
        assert!(matches!(require(FILE_SEARCH, Permission::FileWrite), Err(AdapterError::PermissionRefused(_))));
    }

    #[test]
    fn an_unknown_identity_has_no_permission() {
        assert!(matches!(require("actions.inconnu", Permission::SystemRead), Err(AdapterError::PermissionRefused(_))));
        assert!(matches!(require("core", Permission::FileRead), Err(AdapterError::PermissionRefused(_))));
    }

    /// Seule la fenêtre principale est l'interface. Un autre libellé, ou une identité écrite comme « core », ne l'est pas.
    #[test]
    fn only_the_confirmation_window_answers_a_confirmation() {
        assert!(is_confirmation_window("confirm"));
        for label in ["", "main", "Confirm", "confirm-evil"] {
            assert!(!is_confirmation_window(label), "{label} ne doit pas répondre aux confirmations");
        }
        let answers = POLICIES.iter().find(|(name, _)| *name == "permission_answer").map(|(_, policy)| *policy);
        assert_eq!(answers, Some(Policy::ConfirmationWindow));
    }

    /// Une seule fenêtre doit pouvoir approuver : l'interface principale n'a jamais la politique de confirmation.
    #[test]
    fn the_main_window_never_answers_a_confirmation() {
        for (command, policy) in POLICIES {
            if command.starts_with("permission_answer") || command.starts_with("confirmation_") {
                assert_eq!(*policy, Policy::ConfirmationWindow, "{command} doit être réservée à la fenêtre de confirmation");
            }
        }
    }

    #[test]
    fn only_the_main_window_is_the_interface() {
        assert!(is_main_window("main"));
        for label in ["", "Main", "main-evil", "plugin", "core", "actions.process-list"] {
            assert!(!is_main_window(label), "{label} ne doit pas être l'interface");
        }
    }

    #[test]
    fn every_identity_used_by_a_policy_has_grants() {
        for (command, policy) in POLICIES {
            if let Policy::Capability(identity) = policy {
                assert!(!grants_for(identity).is_empty(), "{command} : identité sans permission {identity}");
            }
        }
    }

    /// Chaque commande exposée au JavaScript doit avoir une politique, et aucune politique ne vise une commande absente.
    #[test]
    fn every_exposed_command_has_a_policy_and_no_policy_is_stale() {
        let source = include_str!("lib.rs");
        let start = source.find("generate_handler![").expect("liste des commandes");
        let block = &source[start..];
        let block = &block[..block.find("])").expect("fin de la liste")];
        let exposed: std::collections::BTreeSet<&str> = block
            .lines()
            .map(|line| line.trim().trim_end_matches(',').rsplit("::").next().unwrap_or_default())
            .filter(|name| !name.is_empty() && !name.starts_with("generate_handler"))
            .collect();
        let declared: std::collections::BTreeSet<&str> = POLICIES.iter().map(|(name, _)| *name).collect();
        assert_eq!(declared.len(), POLICIES.len(), "une commande a deux politiques");
        let missing: Vec<&&str> = exposed.difference(&declared).collect();
        let stale: Vec<&&str> = declared.difference(&exposed).collect();
        assert!(missing.is_empty(), "commandes sans politique : {missing:?}");
        assert!(stale.is_empty(), "politiques sans commande : {stale:?}");
    }

    /// Une politique qui n'accorde pas de permission, ou une permission ajoutée sans politique, est une erreur de configuration.
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

        for (identity, granted) in GRANTS {
            let manifest = declared.get(*identity).unwrap_or_else(|| panic!("plugin absent du dépôt : {identity}"));
            let mut expected: Vec<&str> = granted.iter().map(|p| p.id()).collect();
            let mut actual: Vec<&str> = manifest.iter().map(String::as_str).collect();
            expected.sort_unstable();
            actual.sort_unstable();
            assert_eq!(actual, expected, "permissions de {identity}");
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

    /// Le JavaScript de l'interface ne doit pas pouvoir exécuter de code arbitraire : pas d'évaluation de chaîne ni de
    /// script en ligne, et aucune source de script autre que NEXUS lui-même.
    #[test]
    fn the_content_security_policy_blocks_injected_scripts() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().expect("CSP définie");
        assert!(csp.contains("default-src 'self'"), "{csp}");
        assert!(!csp.contains("unsafe-eval"), "{csp}");
        for directive in csp.split(';').map(str::trim).filter(|d| d.starts_with("script-src")) {
            assert!(!directive.contains("unsafe-inline") && !directive.contains("unsafe-eval") && !directive.contains("http"), "{directive}");
        }
    }

    /// Une seule fenêtre, sans capacité distante : la permission native ne s'étend pas à d'autres fenêtres.
    #[test]
    fn each_capability_belongs_to_one_local_window() {
        let main: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let confirmation: serde_json::Value = serde_json::from_str(include_str!("../capabilities/confirmation.json")).unwrap();
        assert_eq!(main["windows"], serde_json::json!(["main"]));
        assert_eq!(confirmation["windows"], serde_json::json!(["confirm"]));
        for capability in [&main, &confirmation] {
            assert!(capability.get("remote").is_none(), "aucune fenêtre distante");
        }
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let labels: Vec<&str> = config["app"]["windows"].as_array().unwrap().iter().filter_map(|window| window["label"].as_str()).collect();
        assert_eq!(labels, vec![MAIN_WINDOW, CONFIRMATION_WINDOW]);
    }
}
