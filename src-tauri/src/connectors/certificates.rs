//! Noms de domaine présents dans les journaux publics de transparence des certificats (crt.sh).
//! Un nom listé est vérifiable : il renvoie à un certificat public daté.

use std::collections::BTreeSet;

use super::{fetch_text, Collector, Confidence, Detail, FindingStatus, SourceRef};

pub const CRT_SH_BASE: &str = "https://crt.sh";
pub const SOURCE_NAME: &str = "crt.sh (transparence des certificats)";

pub fn lookup(agent: &ureq::Agent, base: &str, domain: &str, collector: &mut Collector) {
    let url = format!("{base}/?q=%25.{domain}&output=json");
    let body = match fetch_text(agent, &url) {
        Ok((200, body)) => body,
        Ok((status, _)) => {
            collector.error(format!("crt.sh a répondu HTTP {status}"));
            return;
        }
        Err(error) => {
            collector.error(format!("crt.sh injoignable : {error}"));
            return;
        }
    };

    let records: Vec<serde_json::Value> = match serde_json::from_str(&body) {
        Ok(records) => records,
        Err(error) => {
            collector.error(format!("réponse de crt.sh illisible : {error}"));
            return;
        }
    };

    let mut names = BTreeSet::new();
    for record in &records {
        let Some(value) = record.get("name_value").and_then(|value| value.as_str()) else { continue };
        for name in value.lines().map(|line| line.trim().to_ascii_lowercase()) {
            if !name.contains(' ') && (name == domain || name.ends_with(&format!(".{domain}"))) {
                names.insert(name);
            }
        }
    }

    let reference = format!("https://crt.sh/?q={domain}");
    if names.is_empty() {
        let mut finding = collector.finding(
            "domain",
            domain,
            SourceRef { name: SOURCE_NAME.into(), url: Some(reference) },
            FindingStatus::NotFound,
            Confidence::Medium,
        );
        finding.note = Some("Aucun certificat public listé. Cela ne prouve pas l'absence de certificat.".into());
        collector.push(finding);
        return;
    }

    for name in names {
        let entity = if name == domain { "domain" } else { "subdomain" };
        let wildcard = name.starts_with("*.");
        let mut finding = collector.finding(
            entity,
            name,
            SourceRef { name: SOURCE_NAME.into(), url: Some(reference.clone()) },
            FindingStatus::Verified,
            Confidence::High,
        );
        finding.details.push(Detail { key: "Joker".into(), value: wildcard.to_string() });
        finding.note = Some("Présent dans un journal public de transparence des certificats.".into());
        if !collector.push(finding) {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::mock_source::simulated_source;
    use crate::connectors::{ConnectorRequest, FindingStatus};

    fn collector() -> Collector {
        Collector::new(&ConnectorRequest { connector: "domain.certificates".into(), target: "example.com".into(), search_id: "s".into() })
    }

    #[test]
    fn lists_documented_names_under_the_domain_only() {
        // SIMULATION : réponse fixe de crt.sh, pas une donnée réelle.
        let base = simulated_source(vec![(
            "/?q=",
            200,
            r#"[{"name_value":"www.example.com\nmail.example.com"},{"name_value":"*.example.com"},{"name_value":"autre.org"}]"#,
        )]);
        let mut collector = collector();
        lookup(&http_agent_for_tests(), &base, "example.com", &mut collector);
        let report = collector.finish();

        let names: Vec<&str> = report.findings.iter().map(|f| f.value.as_str()).collect();
        assert_eq!(names, vec!["*.example.com", "mail.example.com", "www.example.com"]);
        assert!(report.findings.iter().all(|f| f.status == FindingStatus::Verified));
        assert!(report.findings[0].details.iter().any(|d| d.key == "Joker" && d.value == "true"));
        assert!(!report.partial);
    }

    #[test]
    fn an_empty_listing_is_not_found_not_absence() {
        let base = simulated_source(vec![("/?q=", 200, "[]")]);
        let mut collector = collector();
        lookup(&http_agent_for_tests(), &base, "example.com", &mut collector);
        let report = collector.finish();
        assert_eq!(report.findings[0].status, FindingStatus::NotFound);
        assert!(report.findings[0].note.as_deref().unwrap().contains("ne prouve pas"));
    }

    #[test]
    fn a_failing_source_makes_the_report_partial() {
        let base = simulated_source(vec![("/?q=", 503, "")]);
        let mut collector = collector();
        lookup(&http_agent_for_tests(), &base, "example.com", &mut collector);
        let report = collector.finish();
        assert!(report.findings.is_empty());
        assert!(report.partial);
        assert!(report.errors[0].contains("503"));
    }

    fn http_agent_for_tests() -> ureq::Agent {
        crate::connectors::http_agent()
    }
}
