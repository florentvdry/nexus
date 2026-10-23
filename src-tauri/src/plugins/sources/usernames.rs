//! Présence d'un pseudo sur quelques plateformes publiques, par la seule URL publique du profil.
//!
//! Règles appliquées :
//! - aucune connexion, aucune contournement de protection, une requête par plateforme, espacées ;
//! - un profil trouvé n'est jamais attribué à une personne : le statut reste « correspondance possible » ;
//! - un 404 n'est pas une preuve d'absence.

use std::thread;
use std::time::Duration;

use crate::plugins::report::{fetch_text, Collector, Confidence, FindingStatus, SourceRef};

pub const PAUSE: Duration = Duration::from_secs(1);

pub struct Site {
    pub name: String,
    /// Modèle d'URL publique ; `{}` est remplacé par le pseudo.
    pub template: String,
}

pub fn default_sites() -> Vec<Site> {
    [("GitHub", "https://github.com/{}"), ("GitLab", "https://gitlab.com/{}"), ("Codeberg", "https://codeberg.org/{}")]
        .into_iter()
        .map(|(name, template)| Site { name: name.into(), template: template.into() })
        .collect()
}

pub fn check(agent: &ureq::Agent, sites: &[Site], username: &str, pause: Duration, collector: &mut Collector) {
    for (index, site) in sites.iter().enumerate() {
        if index > 0 && !pause.is_zero() {
            thread::sleep(pause);
        }
        let url = site.template.replacen("{}", username, 1);
        let source = SourceRef { name: site.name.clone(), url: Some(url.clone()) };

        let (status, confidence, note) = match fetch_text(agent, &url) {
            Ok((200, _)) => (
                FindingStatus::PossibleMatch,
                Confidence::Low,
                "Même pseudo : cela ne prouve pas que les comptes appartiennent à la même personne.".to_string(),
            ),
            Ok((404, _)) => (
                FindingStatus::NotFound,
                Confidence::Low,
                "Introuvable à cette adresse. Le compte peut exister sans être public.".to_string(),
            ),
            Ok((code, _)) => (FindingStatus::SourceUnreachable, Confidence::Low, format!("HTTP {code}")),
            Err(error) => (FindingStatus::SourceUnreachable, Confidence::Low, error),
        };

        let mut finding = collector.finding("profile", url, source, status, confidence);
        finding.note = Some(note);
        if !collector.push(finding) {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::report::{ConnectorRequest, FindingStatus};
    use crate::plugins::sources::mock::simulated_source;

    #[test]
    fn a_profile_found_is_only_a_possible_match_and_a_miss_is_not_absence() {
        // SIMULATION : trois plateformes locales. Seule la première « possède » le pseudo.
        let base = simulated_source(vec![("/a/", 200, "profil"), ("/b/", 404, ""), ("/c/", 500, "")]);
        let sites = vec![
            Site { name: "Site A".into(), template: format!("{base}/a/{{}}") },
            Site { name: "Site B".into(), template: format!("{base}/b/{{}}") },
            Site { name: "Site C".into(), template: format!("{base}/c/{{}}") },
        ];
        let request = ConnectorRequest { connector: "username.profiles".into(), target: "alice".into(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        check(&crate::plugins::report::http_agent(), &sites, "alice", Duration::ZERO, &mut collector);
        let report = collector.finish();

        assert_eq!(report.findings[0].status, FindingStatus::PossibleMatch);
        assert!(report.findings[0].note.as_deref().unwrap().contains("ne prouve pas"));
        assert_eq!(report.findings[1].status, FindingStatus::NotFound);
        assert_eq!(report.findings[2].status, FindingStatus::SourceUnreachable);
        assert_eq!(report.findings[2].source.name, "Site C");
    }

    #[test]
    fn default_sites_are_public_profile_pages_only() {
        for site in default_sites() {
            assert!(site.template.starts_with("https://"));
            assert_eq!(site.template.matches("{}").count(), 1);
        }
    }
}
