//! Catalogue de plugins : un fichier `index.json` qui référence des dépôts. Le catalogue ne contient ni code
//! ni binaires : il indique seulement où trouver un plugin, et son identifiant. L'installation reste soumise
//! à la validation et à la confirmation de l'utilisateur.

use serde::{Deserialize, Serialize};

use super::manifest::{self, KINDS};
use crate::error::AdapterError;

/// Variable d'environnement qui indique l'adresse HTTPS du catalogue. Sans elle, aucun catalogue n'est proposé.
pub const INDEX_ENV: &str = "NEXUS_PLUGIN_INDEX";
const MAX_ENTRIES: usize = 500;
const MAX_INDEX_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexFile {
    pub schema_version: u32,
    pub plugins: Vec<IndexEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    /// Adresse HTTPS du dépôt Git du plugin.
    pub source: String,
    pub kinds: Vec<String>,
}

/// Une adresse Git acceptée : HTTPS, sans identifiants dans l'adresse, sans espace.
pub fn valid_git_url(url: &str) -> bool {
    let rest = match url.strip_prefix("https://") {
        Some(rest) => rest,
        None => return false,
    };
    let host = rest.split('/').next().unwrap_or("");
    url.len() <= 300 && !url.contains(char::is_whitespace) && !host.is_empty() && !host.contains('@') && rest.contains('/')
}

pub fn parse_index(text: &str) -> Result<Vec<IndexEntry>, Vec<String>> {
    let file: IndexFile = serde_json::from_str(text).map_err(|error| vec![format!("index.json illisible : {error}")])?;
    let mut problems = Vec::new();
    if file.schema_version != manifest::SCHEMA_VERSION {
        problems.push(format!("schemaVersion {} non supportée", file.schema_version));
    }
    if file.plugins.len() > MAX_ENTRIES {
        problems.push(format!("{MAX_ENTRIES} plugins au maximum dans un catalogue"));
    }
    let mut seen = std::collections::BTreeSet::new();
    for entry in &file.plugins {
        if !manifest::valid_id(&entry.id) {
            problems.push(format!("identifiant « {} » invalide", entry.id));
        }
        if !seen.insert(entry.id.as_str()) {
            problems.push(format!("« {} » listé deux fois", entry.id));
        }
        if !valid_git_url(&entry.source) {
            problems.push(format!("source de « {} » refusée : HTTPS attendu, sans identifiants", entry.id));
        }
        if manifest::parse_version(&entry.version).is_none() {
            problems.push(format!("version de « {} » invalide", entry.id));
        }
        if entry.kinds.iter().any(|kind| !KINDS.contains(&kind.as_str())) {
            problems.push(format!("types de « {} » non disponibles dans cette version", entry.id));
        }
    }
    if problems.is_empty() { Ok(file.plugins) } else { Err(problems) }
}

/// Adresse du catalogue configurée par l'utilisateur, si elle est en HTTPS.
pub fn configured_url() -> Option<String> {
    std::env::var(INDEX_ENV).ok().map(|value| value.trim().to_string()).filter(|url| url.starts_with("https://"))
}

/// Récupère le catalogue en HTTPS, taille bornée. Les erreurs deviennent des messages lisibles.
pub fn fetch(url: &str) -> Result<Vec<IndexEntry>, AdapterError> {
    if !url.starts_with("https://") {
        return Err(AdapterError::InvalidTarget(url.to_string()));
    }
    let agent = crate::plugins::report::http_agent();
    let mut response = agent.get(url).call().map_err(|error| AdapterError::Operation(format!("catalogue injoignable : {error}")))?;
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_INDEX_BYTES)
        .read_to_string()
        .map_err(|error| AdapterError::Operation(format!("catalogue illisible : {error}")))?;
    parse_index(&text).map_err(|problems| AdapterError::PluginInvalid(problems.join(" ; ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"schemaVersion":1,"plugins":[{"id":"community.ana.verbes","name":"Verbes","version":"1.0.0",
        "description":"Vocabulaire","source":"https://example.org/ana/verbes.git","kinds":["language"]}]}"#;

    #[test]
    fn a_catalogue_lists_https_sources_only() {
        assert_eq!(parse_index(GOOD).unwrap().len(), 1);
        assert!(valid_git_url("https://example.org/a/b.git"));
        assert!(!valid_git_url("http://example.org/a/b.git"));
        assert!(!valid_git_url("https://user:secret@example.org/a/b.git"));
        assert!(!valid_git_url("file:///etc"));
        assert!(!valid_git_url("https://example.org"));
    }

    #[test]
    fn code_types_and_duplicates_are_refused_in_the_catalogue() {
        let code = GOOD.replace(r#""kinds":["language"]"#, r#""kinds":["agent"]"#);
        assert!(parse_index(&code).unwrap_err().iter().any(|p| p.contains("non disponibles")));
        let entry = r#"{"id":"community.ana.verbes","name":"Verbes","version":"1.0.0","description":"d","source":"https://example.org/x.git","kinds":["language"]}"#;
        let twice = format!(r#"{{"schemaVersion":1,"plugins":[{entry},{entry}]}}"#);
        assert!(parse_index(&twice).unwrap_err().iter().any(|p| p.contains("deux fois")));
    }

    #[test]
    fn no_catalogue_is_configured_without_the_environment_variable() {
        // Sans variable, aucun catalogue n'est proposé : l'application ne choisit jamais une adresse à la place de l'utilisateur.
        if std::env::var(INDEX_ENV).is_err() {
            assert!(configured_url().is_none());
        }
    }
}
