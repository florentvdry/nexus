//! Résolution A/AAAA par le résolveur du système. Passif : aucune requête vers le domaine lui-même.

use std::collections::BTreeSet;
use std::net::{IpAddr, ToSocketAddrs};

use super::{Collector, Confidence, Detail, FindingStatus, SourceRef};

pub const SOURCE_NAME: &str = "Résolution DNS du système";

pub fn lookup(domain: &str, collector: &mut Collector) {
    match (domain, 443).to_socket_addrs() {
        Ok(addresses) => {
            let ips: BTreeSet<IpAddr> = addresses.map(|address| address.ip()).collect();
            if ips.is_empty() {
                collector.error(format!("aucune adresse renvoyée pour {domain}"));
                return;
            }
            for ip in ips {
                let family = if ip.is_ipv4() { "IPv4" } else { "IPv6" };
                let mut finding = collector.finding(
                    "ip",
                    ip.to_string(),
                    SourceRef { name: SOURCE_NAME.into(), url: None },
                    FindingStatus::Verified,
                    Confidence::High,
                );
                finding.details.push(Detail { key: "Famille".into(), value: family.into() });
                finding.details.push(Detail { key: "Domaine".into(), value: domain.into() });
                finding.note = Some("Adresse obtenue à la date de collecte ; elle peut changer.".into());
                collector.push(finding);
            }
        }
        Err(error) => collector.error(format!("résolution de {domain} impossible : {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{ConnectorRequest, FindingStatus};

    #[test]
    fn resolves_localhost_through_the_system_resolver() {
        // Résolution réelle, sans réseau : `localhost` est défini par le système.
        let request = ConnectorRequest { connector: "domain.dns".into(), target: "localhost".into(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        lookup("localhost", &mut collector);
        let report = collector.finish();
        assert!(!report.findings.is_empty());
        assert!(report.findings.iter().all(|f| f.status == FindingStatus::Verified && f.entity_type == "ip"));
    }
}
