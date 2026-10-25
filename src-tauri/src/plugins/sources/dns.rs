//! Résolution A/AAAA par le résolveur du système. Passif : aucune requête vers le domaine lui-même.

use std::collections::BTreeSet;
use std::net::{IpAddr, ToSocketAddrs};

use crate::plugins::report::{Collector, Confidence, Detail, FindingStatus, SourceRef};

pub const RECORDS_SOURCE_NAME: &str = "Enregistrements DNS (MX, TXT, NS)";

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

/// Enregistrements MX, TXT et NS, par requêtes DNS directes au résolveur configuré dans Windows. Une erreur n'arrête
/// pas les autres types : chacune est notée avec sa cause. Aucune requête n'est envoyée au domaine lui-même.
pub fn lookup_records(domain: &str, collector: &mut Collector) {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => return collector.error(format!("enregistrements DNS indisponibles : {error}")),
    };
    let resolver = match hickory_resolver::TokioResolver::builder_tokio() {
        Ok(builder) => builder.build(),
        Err(error) => return collector.error(format!("résolveur DNS du système illisible : {error}")),
    };
    runtime.block_on(async {
        match resolver.mx_lookup(domain).await {
            Ok(answer) => {
                for mx in answer.iter() {
                    let exchange = mx.exchange().to_utf8();
                    let mut finding = collector.finding("mx", exchange.clone(), records_source(), FindingStatus::Verified, Confidence::High);
                    finding.details.push(Detail { key: "Préférence".into(), value: mx.preference().to_string() });
                    finding.details.push(Detail { key: "Domaine".into(), value: domain.into() });
                    finding.note = Some("Serveur de messagerie annoncé dans le DNS à la date de collecte.".into());
                    collector.push(finding);
                }
            }
            Err(error) => collector.error(format!("MX de {domain} : {error}")),
        }
        match resolver.ns_lookup(domain).await {
            Ok(answer) => {
                for ns in answer.iter() {
                    let server = ns.0.to_utf8();
                    let mut finding = collector.finding("ns", server, records_source(), FindingStatus::Verified, Confidence::High);
                    finding.details.push(Detail { key: "Domaine".into(), value: domain.into() });
                    collector.push(finding);
                }
            }
            Err(error) => collector.error(format!("NS de {domain} : {error}")),
        }
        match resolver.txt_lookup(domain).await {
            Ok(answer) => {
                for txt in answer.iter() {
                    let text: String = txt.txt_data().iter().map(|part| String::from_utf8_lossy(part).into_owned()).collect();
                    let mut finding = collector.finding("txt", text, records_source(), FindingStatus::Verified, Confidence::High);
                    finding.details.push(Detail { key: "Domaine".into(), value: domain.into() });
                    collector.push(finding);
                }
            }
            Err(error) => collector.error(format!("TXT de {domain} : {error}")),
        }
    });
}

fn records_source() -> SourceRef {
    SourceRef { name: RECORDS_SOURCE_NAME.into(), url: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::report::{ConnectorRequest, FindingStatus};

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

    /// Test réseau : `cargo test -- --ignored live_records`. Les serveurs de noms d'un domaine public doivent répondre.
    #[test]
    #[ignore]
    fn live_records_list_the_name_servers_of_a_public_domain() {
        let request = ConnectorRequest { connector: "domain.dns".into(), target: "example.com".into(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        lookup_records("example.com", &mut collector);
        let report = collector.finish();
        assert!(report.findings.iter().any(|f| f.entity_type == "ns"), "aucun serveur de noms : {:?}", report.errors);
    }
}
