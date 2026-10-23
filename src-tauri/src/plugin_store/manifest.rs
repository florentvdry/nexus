//! Manifeste `nexus.json`, schéma 1 : lecture et validation. Le même code sert à l'application, à la commande
//! `nexus-plugin validate` et à la CI, pour qu'un plugin validé en local soit accepté à l'installation.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
/// Version de Nexus contre laquelle les plugins sont vérifiés.
pub const NEXUS_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Types livrés dans cette version : uniquement des données, jamais de code.
pub const PACK_KINDS: &[&str] = &["language", "aliases"];
/// Types réservés aux plugins avec code, qui attendent le bac à sable.
pub const CODE_KINDS: &[&str] = &["action", "source", "document", "agent", "speech"];
pub const MANIFEST_FILE: &str = "nexus.json";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub license: Option<String>,
    pub description: String,
    pub engines: Engines,
    pub kinds: Vec<String>,
    pub entry_points: BTreeMap<String, String>,
    #[serde(default)]
    pub permissions: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Engines {
    pub nexus: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u64, pub u64, pub u64);

/// Accepte exactement `x.y.z`, en chiffres.
pub fn parse_version(text: &str) -> Option<Version> {
    let mut parts = text.split('.');
    let mut next = || {
        parts
            .next()
            .filter(|part| !part.is_empty() && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|part| part.parse::<u64>().ok())
    };
    let version = Version(next()?, next()?, next()?);
    if parts.next().is_some() {
        return None;
    }
    Some(version)
}

/// Plage du type `>=0.3.0 <1.0.0`. `None` si la plage est mal écrite, `Some(vrai/faux)` sinon.
pub fn satisfies(range: &str, version: Version) -> Option<bool> {
    const OPERATORS: [&str; 5] = [">=", "<=", ">", "<", "="];
    let mut count = 0;
    let mut all = true;
    for token in range.split_whitespace() {
        let (operator, rest) = OPERATORS.iter().find_map(|op| token.strip_prefix(op).map(|rest| (*op, rest)))?;
        let bound = parse_version(rest)?;
        all &= match operator {
            ">=" => version >= bound,
            "<=" => version <= bound,
            ">" => version > bound,
            "<" => version < bound,
            _ => version == bound,
        };
        count += 1;
    }
    (count > 0).then_some(all)
}

fn valid_segment(segment: &str) -> bool {
    (1..=40).contains(&segment.len())
        && segment.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !segment.starts_with('-')
        && !segment.ends_with('-')
}

/// `community.<auteur>.<nom>` : trois segments en minuscules. Le préfixe `nexus` est réservé.
pub fn valid_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() == 3 && parts[0] == "community" && parts[1..].iter().all(|part| valid_segment(part))
}

/// Chemin relatif et sûr : pas de racine, pas de `..`, pas de séparateur Windows ni de lecteur.
pub fn is_safe_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 128
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

pub fn parse(text: &str) -> Result<Manifest, String> {
    serde_json::from_str(text).map_err(|error| format!("nexus.json illisible : {error}"))
}

/// Problèmes du manifeste seul, sans lire les fichiers. Liste vide : manifeste valide.
pub fn problems(manifest: &Manifest, nexus_version: &str) -> Vec<String> {
    let mut problems = Vec::new();
    if manifest.schema_version != SCHEMA_VERSION {
        problems.push(format!("schemaVersion {} non supportée (attendue : {SCHEMA_VERSION})", manifest.schema_version));
    }
    if !valid_id(&manifest.id) {
        problems.push(format!("identifiant « {} » invalide : attendu community.<auteur>.<nom>, en minuscules", manifest.id));
    }
    for (label, value, max) in [("name", &manifest.name, 80), ("author", &manifest.author, 80), ("description", &manifest.description, 300)] {
        let length = value.trim().chars().count();
        if length == 0 || length > max {
            problems.push(format!("« {label} » doit faire entre 1 et {max} caractères"));
        }
    }
    if parse_version(&manifest.version).is_none() {
        problems.push(format!("version « {} » invalide : attendu x.y.z", manifest.version));
    }
    let current = parse_version(nexus_version).unwrap_or(Version(0, 0, 0));
    match satisfies(&manifest.engines.nexus, current) {
        None => problems.push(format!("plage de version Nexus invalide : « {} »", manifest.engines.nexus)),
        Some(false) => problems.push(format!("nécessite Nexus {}, version installée : {nexus_version}", manifest.engines.nexus)),
        Some(true) => {}
    }

    if manifest.kinds.is_empty() {
        problems.push("au moins un type (kinds) est requis".into());
    }
    let mut seen = BTreeSet::new();
    for kind in &manifest.kinds {
        if !seen.insert(kind.as_str()) {
            problems.push(format!("type « {kind} » déclaré deux fois"));
        }
        if CODE_KINDS.contains(&kind.as_str()) {
            problems.push(format!("type « {kind} » indisponible : les plugins avec code attendent le bac à sable"));
        } else if !PACK_KINDS.contains(&kind.as_str()) {
            problems.push(format!("type « {kind} » inconnu"));
        }
    }

    let declared: BTreeSet<&str> = manifest.kinds.iter().map(String::as_str).collect();
    let entries: BTreeSet<&str> = manifest.entry_points.keys().map(String::as_str).collect();
    if declared != entries {
        problems.push("entryPoints doit contenir exactement un fichier par type (kinds)".into());
    }
    for (kind, file) in &manifest.entry_points {
        if !is_safe_relative(file) {
            problems.push(format!("chemin « {file} » refusé pour le type « {kind} »"));
        } else if !file.ends_with(".json") {
            problems.push(format!("le fichier « {file} » doit être un JSON (type « {kind} »)"));
        }
    }

    if !manifest.permissions.is_empty() {
        problems.push("les permissions ne sont pas encore accordables aux plugins de données : laisser « permissions » vide".into());
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Manifest {
        Manifest {
            schema_version: 1,
            id: "community.ana.verbes".into(),
            name: "Verbes".into(),
            version: "1.0.0".into(),
            author: "Ana".into(),
            license: Some("MIT".into()),
            description: "Vocabulaire supplémentaire.".into(),
            engines: Engines { nexus: ">=0.1.0 <1.0.0".into() },
            kinds: vec!["language".into()],
            entry_points: BTreeMap::from([("language".to_string(), "language.json".to_string())]),
            permissions: vec![],
        }
    }

    #[test]
    fn versions_and_ranges_follow_semver_order() {
        assert_eq!(parse_version("1.2.3"), Some(Version(1, 2, 3)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("1.a.3"), None);
        assert_eq!(satisfies(">=0.3.0 <1.0.0", Version(0, 1, 0)), Some(false));
        assert_eq!(satisfies(">=0.1.0 <1.0.0", Version(0, 1, 0)), Some(true));
        assert_eq!(satisfies(">= 0.1.0", Version(0, 1, 0)), None);
        assert_eq!(satisfies("", Version(0, 1, 0)), None);
    }

    #[test]
    fn ids_are_namespaced_and_nexus_is_reserved_to_the_core() {
        assert!(valid_id("community.ana.verbes-fr"));
        assert!(!valid_id("nexus.verbes"));
        assert!(!valid_id("community.Ana.verbes"));
        assert!(!valid_id("community.ana.-verbes"));
        assert!(!valid_id("community.ana"));
    }

    #[test]
    fn paths_must_stay_inside_the_plugin_folder() {
        assert!(is_safe_relative("language.json"));
        assert!(is_safe_relative("data/language.json"));
        for bad in ["/etc/passwd", "../x.json", "a/../b.json", "C:x.json", "a\\b.json", "", "./a.json"] {
            assert!(!is_safe_relative(bad), "{bad} doit être refusé");
        }
    }

    #[test]
    fn a_valid_pack_has_no_problem() {
        assert!(problems(&sample(), "0.1.0").is_empty());
    }

    #[test]
    fn code_kinds_and_permissions_are_refused_in_this_version() {
        let mut manifest = sample();
        manifest.kinds = vec!["action".into()];
        manifest.entry_points = BTreeMap::from([("action".to_string(), "index.json".to_string())]);
        manifest.permissions = vec![serde_json::json!({"id": "file.read"})];
        let found = problems(&manifest, "0.1.0");
        assert!(found.iter().any(|p| p.contains("bac à sable")));
        assert!(found.iter().any(|p| p.contains("permissions")));
    }

    #[test]
    fn entry_points_must_match_the_declared_kinds() {
        let mut manifest = sample();
        manifest.entry_points.insert("aliases".into(), "aliases.json".into());
        assert!(problems(&manifest, "0.1.0").iter().any(|p| p.contains("exactement un fichier")));
    }

    #[test]
    fn an_incompatible_nexus_version_is_reported() {
        let mut manifest = sample();
        manifest.engines.nexus = ">=0.3.0 <1.0.0".into();
        assert!(problems(&manifest, "0.1.0").iter().any(|p| p.contains("nécessite Nexus")));
    }

    #[test]
    fn unknown_fields_are_rejected_when_parsing() {
        let text = r#"{"schemaVersion":1,"id":"community.a.b","name":"n","version":"1.0.0","author":"a","description":"d",
            "engines":{"nexus":">=0.1.0"},"kinds":["language"],"entryPoints":{"language":"language.json"},"permissions":[],"cheat":true}"#;
        assert!(parse(text).is_err());
    }
}
