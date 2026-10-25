//! Plugins natifs, un dossier par type : `actions`, `sources`, `documents`, `speech`.
//!
//! Le code d'un plugin Rust vit dans `src-tauri/src/plugins/<type>/` ; son manifeste et son point d'entrée
//! TypeScript vivent dans `plugins/<type>/<nom>/` à la racine du dépôt. Voir `docs/PLUGINS.md`.

pub mod actions;
pub mod agents;
pub mod documents;
pub mod report;
pub mod sources;
pub mod speech;

use std::time::Duration;

use crate::error::AdapterError;
use report::{http_agent, Collector, ConnectorReport, ConnectorRequest};

/// Connecteurs exécutables dans le worker. Doit correspondre aux plugins `sources` et `documents`
/// (test de cohérence dans `tests` ci-dessous).
pub const CONNECTORS: &[&str] = &["domain.dns", "domain.certificates", "username.profiles", "document.inspect"];

pub fn timeout_for(connector: &str) -> Duration {
    match connector {
        "domain.dns" => Duration::from_secs(15),
        "domain.certificates" => Duration::from_secs(30),
        "username.profiles" => Duration::from_secs(90),
        _ => Duration::from_secs(30),
    }
}

/// Exécute un connecteur dans le processus courant. Appelé par le worker, jamais directement par l'interface.
pub fn run_connector(request: &ConnectorRequest) -> Result<ConnectorReport, AdapterError> {
    let mut collector = Collector::new(request);
    match request.connector.as_str() {
        "domain.dns" => {
            let domain = report::validate_domain(&request.target)?;
            sources::dns::lookup(&domain, &mut collector);
            sources::dns::lookup_records(&domain, &mut collector);
        }
        "domain.certificates" => {
            let domain = report::validate_domain(&request.target)?;
            sources::certificates::lookup(&http_agent(), sources::certificates::CRT_SH_BASE, &domain, &mut collector);
        }
        "username.profiles" => {
            let username = report::validate_username(&request.target)?;
            sources::usernames::check(&http_agent(), &sources::usernames::default_sites(), &username, sources::usernames::PAUSE, &mut collector);
        }
        "document.inspect" => documents::inspect::inspect(&request.target, &mut collector),
        other => return Err(AdapterError::UnknownConnector(other.to_string())),
    }
    Ok(collector.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_connectors_are_refused() {
        let request = ConnectorRequest { connector: "shell.exec".into(), target: "x".into(), search_id: "s".into() };
        assert!(matches!(run_connector(&request), Err(AdapterError::UnknownConnector(_))));
    }

    #[test]
    fn every_connector_id_has_a_plugin_manifest_and_every_manifest_is_listed() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins");
        let mut declared: Vec<String> = Vec::new();
        for plugin_type in ["sources", "documents"] {
            for entry in std::fs::read_dir(root.join(plugin_type)).expect("dossier de plugins") {
                let manifest = entry.unwrap().path().join("plugin.json");
                let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
                for connector in json["connectors"].as_array().cloned().unwrap_or_default() {
                    declared.push(connector.as_str().unwrap().to_string());
                }
            }
        }
        declared.sort();
        let mut listed: Vec<String> = CONNECTORS.iter().map(|c| c.to_string()).collect();
        listed.sort();
        assert_eq!(declared, listed);
    }
}
