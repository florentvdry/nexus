//! Analyse locale d'un fichier désigné explicitement par l'utilisateur : empreinte, taille, type, statistiques.
//! Le contenu n'est jamais renvoyé ni copié : seules les métadonnées et l'empreinte sortent du connecteur.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

use crate::plugins::report::{Collector, Confidence, Detail, FindingStatus, SourceRef};

pub const SOURCE_NAME: &str = "Analyse locale du fichier";
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;

fn detect_type(bytes: &[u8]) -> &'static str {
    match bytes {
        [b'%', b'P', b'D', b'F', ..] => "PDF",
        [0x89, b'P', b'N', b'G', ..] => "PNG",
        [0xFF, 0xD8, 0xFF, ..] => "JPEG",
        [b'G', b'I', b'F', b'8', ..] => "GIF",
        [b'P', b'K', 0x03, 0x04, ..] => "Archive ZIP (ou format Office)",
        _ if bytes.contains(&0) => "Binaire",
        _ if std::str::from_utf8(bytes).is_ok() => "Texte (UTF-8)",
        _ => "Binaire",
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn inspect(raw_path: &str, collector: &mut Collector) {
    let path = Path::new(raw_path.trim().trim_matches('"'));
    if !path.is_absolute() {
        collector.error("chemin absolu attendu : indiquez le fichier complet".to_string());
        return;
    }

    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            collector.error(format!("fichier inaccessible : {error}"));
            return;
        }
    };
    if !metadata.is_file() {
        collector.error("le chemin ne désigne pas un fichier régulier".to_string());
        return;
    }
    if metadata.len() > MAX_FILE_BYTES {
        collector.error(format!("fichier trop volumineux (limite {} Mo)", MAX_FILE_BYTES / 1024 / 1024));
        return;
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => {
            collector.error(format!("lecture impossible : {error}"));
            return;
        }
    };

    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let kind = detect_type(&bytes);
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|| "inconnue".into());

    let mut finding = collector.finding(
        "file",
        name,
        SourceRef { name: SOURCE_NAME.into(), url: None },
        FindingStatus::Verified,
        Confidence::High,
    );
    finding.details = vec![
        Detail { key: "Chemin".into(), value: path.display().to_string() },
        Detail { key: "Taille".into(), value: format!("{} octets", bytes.len()) },
        Detail { key: "Type détecté".into(), value: kind.into() },
        Detail { key: "SHA-256".into(), value: hex(&Sha256::digest(&bytes)) },
        Detail { key: "Modifié (epoch s)".into(), value: modified },
    ];
    if kind.starts_with("Texte") {
        let text = String::from_utf8_lossy(&bytes);
        finding.details.push(Detail { key: "Lignes".into(), value: text.lines().count().to_string() });
        finding.details.push(Detail { key: "Mots".into(), value: text.split_whitespace().count().to_string() });
    }
    finding.note = Some("Analyse faite localement. Le contenu n'est ni transmis ni affiché.".into());
    collector.push(finding);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_common_signatures() {
        assert_eq!(detect_type(b"%PDF-1.7 ..."), "PDF");
        assert_eq!(detect_type(&[0x89, b'P', b'N', b'G', 0]), "PNG");
        assert_eq!(detect_type(b"bonjour le monde"), "Texte (UTF-8)");
        assert_eq!(detect_type(&[0, 1, 2]), "Binaire");
    }

    #[test]
    fn computes_the_sha256_of_a_known_string() {
        assert_eq!(hex(&Sha256::digest(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn refuses_relative_paths() {
        let request = crate::plugins::report::ConnectorRequest { connector: "document.inspect".into(), target: "x".into(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        inspect("relatif/fichier.txt", &mut collector);
        assert!(collector.finish().partial);
    }

    #[test]
    fn inspects_a_real_text_file_without_echoing_its_content() {
        let path = std::env::temp_dir().join(format!("nexus-doc-{}.txt", std::process::id()));
        std::fs::write(&path, "bonjour le monde\nseconde ligne").unwrap();
        let request = crate::plugins::report::ConnectorRequest { connector: "document.inspect".into(), target: String::new(), search_id: "s".into() };
        let mut collector = Collector::new(&request);
        inspect(path.to_str().unwrap(), &mut collector);
        let report = collector.finish();
        let _ = std::fs::remove_file(&path);

        let finding = &report.findings[0];
        assert_eq!(finding.status, FindingStatus::Verified);
        assert!(finding.details.iter().any(|d| d.key == "Type détecté" && d.value == "Texte (UTF-8)"));
        assert!(finding.details.iter().any(|d| d.key == "Lignes" && d.value == "2"));
        assert!(finding.details.iter().all(|d| !d.value.contains("bonjour")), "le contenu ne doit pas sortir");
    }
}
