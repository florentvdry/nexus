//! Connecteurs OSINT passifs et analyse locale de fichiers.
//!
//! Chaque exécution a lieu dans un processus `nexus-worker` séparé (voir `runner.rs`), avec un délai
//! et une taille de sortie bornés. Les résultats sont normalisés : entité, source, référence,
//! statut et confiance. Aucun résultat n'est inventé : une source injoignable devient un statut.

pub mod certificates;
pub mod dns;
pub mod document;
pub mod runner;
#[cfg(test)]
mod mock_source;
pub mod usernames;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AdapterError;

pub const MAX_FINDINGS: usize = 200;
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY_BYTES: u64 = 5 * 1024 * 1024;

/// Connecteurs disponibles. Toute autre valeur est refusée avant l'exécution.
pub const CONNECTORS: &[&str] = &["domain.dns", "domain.certificates", "username.profiles", "document.inspect"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FindingStatus {
    /// Constaté directement dans la source, à la date de collecte.
    Verified,
    /// Correspondance possible, sans preuve que c'est la même entité.
    PossibleMatch,
    Unverified,
    /// La source ne contient pas l'élément. Ceci ne prouve pas son absence.
    NotFound,
    SourceUnreachable,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Detail {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub entity_type: String,
    pub value: String,
    pub source: SourceRef,
    pub collected_at: u64,
    pub status: FindingStatus,
    pub confidence: Confidence,
    pub details: Vec<Detail>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRequest {
    pub connector: String,
    pub target: String,
    pub search_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorReport {
    pub search_id: String,
    pub connector: String,
    pub findings: Vec<Finding>,
    pub errors: Vec<String>,
    /// Vrai dès qu'une source n'a pas répondu ou qu'une limite a été atteinte.
    pub partial: bool,
}

pub fn timeout_for(connector: &str) -> Duration {
    match connector {
        "domain.dns" => Duration::from_secs(15),
        "domain.certificates" => Duration::from_secs(30),
        "username.profiles" => Duration::from_secs(90),
        _ => Duration::from_secs(30),
    }
}

pub struct Collector {
    search_id: String,
    connector: String,
    findings: Vec<Finding>,
    errors: Vec<String>,
    now: u64,
}

impl Collector {
    pub fn new(request: &ConnectorRequest) -> Self {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        Self {
            search_id: request.search_id.clone(),
            connector: request.connector.clone(),
            findings: Vec::new(),
            errors: Vec::new(),
            now,
        }
    }

    pub fn finding(&self, entity_type: &str, value: impl Into<String>, source: SourceRef, status: FindingStatus, confidence: Confidence) -> Finding {
        Finding {
            entity_type: entity_type.to_string(),
            value: value.into(),
            source,
            collected_at: self.now,
            status,
            confidence,
            details: Vec::new(),
            note: None,
        }
    }

    /// Ajoute un résultat. Au-delà de la limite, le résultat est écarté et la sortie est marquée partielle.
    pub fn push(&mut self, finding: Finding) -> bool {
        if self.findings.len() >= MAX_FINDINGS {
            if !self.errors.iter().any(|error| error.contains("limite")) {
                self.error(format!("limite de {MAX_FINDINGS} résultats atteinte, la liste est tronquée"));
            }
            return false;
        }
        self.findings.push(finding);
        true
    }

    pub fn error(&mut self, message: impl Into<String>) {
        self.errors.push(message.into());
    }

    pub fn finish(self) -> ConnectorReport {
        let partial = !self.errors.is_empty();
        ConnectorReport {
            search_id: self.search_id,
            connector: self.connector,
            findings: self.findings,
            errors: self.errors,
            partial,
        }
    }
}

pub fn http_agent() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(HTTP_TIMEOUT))
            .http_status_as_error(false)
            .user_agent("NEXUS-OSINT/0.1 (recherche passive)")
            .build(),
    )
}

/// Renvoie le code HTTP et le corps (borné). Les erreurs de transport deviennent un message.
pub fn fetch_text(agent: &ureq::Agent, url: &str) -> Result<(u16, String), String> {
    let mut response = agent.get(url).call().map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    if status != 200 {
        return Ok((status, String::new()));
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY_BYTES)
        .read_to_string()
        .map_err(|error| error.to_string())?;
    Ok((status, body))
}

pub fn validate_domain(raw: &str) -> Result<String, AdapterError> {
    let domain = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = domain.split('.').collect();
    let valid_label = |label: &&str| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    if labels.len() < 2 || domain.len() > 253 || !labels.iter().all(valid_label) {
        return Err(AdapterError::InvalidTarget(format!("domaine attendu, reçu « {raw} »")));
    }
    Ok(domain)
}

pub fn validate_username(raw: &str) -> Result<String, AdapterError> {
    let valid = !raw.is_empty() && raw.len() <= 39 && raw.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !valid {
        return Err(AdapterError::InvalidTarget(format!("pseudo attendu, reçu « {raw} »")));
    }
    Ok(raw.to_string())
}

/// Exécute un connecteur dans le processus courant. Appelé par le worker, jamais par l'interface.
pub fn run(request: &ConnectorRequest) -> Result<ConnectorReport, AdapterError> {
    let mut collector = Collector::new(request);
    match request.connector.as_str() {
        "domain.dns" => dns::lookup(&validate_domain(&request.target)?, &mut collector),
        "domain.certificates" => {
            let domain = validate_domain(&request.target)?;
            certificates::lookup(&http_agent(), certificates::CRT_SH_BASE, &domain, &mut collector);
        }
        "username.profiles" => {
            let username = validate_username(&request.target)?;
            usernames::check(&http_agent(), &usernames::default_sites(), &username, usernames::PAUSE, &mut collector);
        }
        "document.inspect" => document::inspect(&request.target, &mut collector),
        other => return Err(AdapterError::UnknownConnector(other.to_string())),
    }
    Ok(collector.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_domains_and_normalises_case_and_trailing_dot() {
        assert_eq!(validate_domain("Example.COM.").unwrap(), "example.com");
    }

    #[test]
    fn rejects_urls_single_labels_and_injection_attempts() {
        for raw in ["https://example.com", "localhost", "exa mple.com", "example.com;rm", "-bad.com"] {
            assert!(validate_domain(raw).is_err(), "{raw} devrait être refusé");
        }
    }

    #[test]
    fn username_rules_match_common_platform_handles() {
        assert!(validate_username("jean.dupont-42").is_ok());
        assert!(validate_username("a/b").is_err());
        assert!(validate_username(&"x".repeat(40)).is_err());
    }

    #[test]
    fn unknown_connectors_are_refused_by_the_runner() {
        let request = ConnectorRequest { connector: "shell.exec".into(), target: "x".into(), search_id: "s".into() };
        assert!(matches!(run(&request), Err(AdapterError::UnknownConnector(_))));
    }

    #[test]
    fn collector_marks_reports_partial_when_a_source_fails() {
        let request = ConnectorRequest { connector: "domain.dns".into(), target: "x".into(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        collector.error("source indisponible");
        assert!(collector.finish().partial);
    }
}
