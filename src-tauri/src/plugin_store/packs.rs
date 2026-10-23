//! Paquets de données : vocabulaire (`language`) et noms alternatifs d'applications (`aliases`).
//! Ce sont des listes de mots, jamais du code ni des expressions régulières fournies par un auteur.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// Clés de vocabulaire acceptées : les intentions que le moteur sait reconnaître.
pub const PHRASE_KEYS: &[&str] = &["openVerbs", "closeAll", "closeWindow", "cancelTasks", "systemInfo", "help"];
const MAX_PHRASES_PER_KEY: usize = 100;
const MAX_FILLERS: usize = 50;
const MAX_APPS: usize = 50;
const MAX_ALIASES_PER_APP: usize = 20;

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguagePack {
    pub locale: String,
    #[serde(default)]
    pub phrases: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub fillers: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AliasesPack {
    #[serde(default)]
    pub applications: Vec<AppAliases>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppAliases {
    pub id: String,
    pub aliases: Vec<String>,
}

/// Un mot ou une expression : lettres minuscules sans accent, chiffres et espaces simples, 40 caractères au plus.
pub fn valid_phrase(phrase: &str) -> bool {
    let words: Vec<&str> = phrase.split(' ').collect();
    phrase.len() <= 40
        && (1..=6).contains(&words.len())
        && words.iter().all(|word| !word.is_empty() && word.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

pub fn validate_language(text: &str) -> Result<LanguagePack, Vec<String>> {
    let pack: LanguagePack = serde_json::from_str(text).map_err(|error| vec![format!("language.json illisible : {error}")])?;
    let mut problems = Vec::new();
    let locale_ok = pack.locale.len() == 2 && pack.locale.bytes().all(|b| b.is_ascii_lowercase());
    if !locale_ok {
        problems.push(format!("locale « {} » invalide : deux lettres minuscules attendues", pack.locale));
    }
    for (key, phrases) in &pack.phrases {
        if !PHRASE_KEYS.contains(&key.as_str()) {
            problems.push(format!("clé de vocabulaire « {key} » inconnue"));
        }
        if phrases.len() > MAX_PHRASES_PER_KEY {
            problems.push(format!("« {key} » : {MAX_PHRASES_PER_KEY} expressions au maximum"));
        }
        for phrase in phrases {
            if !valid_phrase(phrase) {
                problems.push(format!("expression « {phrase} » refusée dans « {key} » : minuscules sans accent, 6 mots au plus"));
            }
        }
    }
    if pack.fillers.len() > MAX_FILLERS {
        problems.push(format!("fillers : {MAX_FILLERS} mots au maximum"));
    }
    for filler in &pack.fillers {
        if !valid_phrase(filler) || filler.contains(' ') {
            problems.push(format!("mot de remplissage « {filler} » refusé : un seul mot, minuscules sans accent"));
        }
    }
    let total: usize = pack.phrases.values().map(Vec::len).sum::<usize>() + pack.fillers.len();
    if total == 0 {
        problems.push("le paquet ne contient aucune expression".into());
    }
    if problems.is_empty() { Ok(pack) } else { Err(problems) }
}

/// `known` : identifiants du catalogue d'applications. Un alias ne peut viser qu'une application connue.
pub fn validate_aliases(text: &str, known: &[&str]) -> Result<AliasesPack, Vec<String>> {
    let pack: AliasesPack = serde_json::from_str(text).map_err(|error| vec![format!("aliases.json illisible : {error}")])?;
    let mut problems = Vec::new();
    if pack.applications.len() > MAX_APPS {
        problems.push(format!("{MAX_APPS} applications au maximum"));
    }
    let mut seen = BTreeSet::new();
    for app in &pack.applications {
        if !known.contains(&app.id.as_str()) {
            problems.push(format!("application « {} » inconnue du catalogue de NEXUS", app.id));
        }
        if !seen.insert(app.id.as_str()) {
            problems.push(format!("application « {} » listée deux fois", app.id));
        }
        if app.aliases.len() > MAX_ALIASES_PER_APP {
            problems.push(format!("« {} » : {MAX_ALIASES_PER_APP} alias au maximum", app.id));
        }
        for alias in &app.aliases {
            if !valid_phrase(alias) {
                problems.push(format!("alias « {alias} » refusé : minuscules sans accent, 6 mots au plus"));
            }
        }
    }
    if problems.is_empty() { Ok(pack) } else { Err(problems) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KNOWN: &[&str] = &["discord", "notepad"];

    #[test]
    fn phrases_are_plain_lowercase_words() {
        assert!(valid_phrase("ouvre"));
        assert!(valid_phrase("que peux tu faire"));
        assert!(!valid_phrase("Ouvre"));
        assert!(!valid_phrase("déjà"));
        assert!(!valid_phrase("a  b"));
        assert!(!valid_phrase("un deux trois quatre cinq six sept"));
        assert!(!valid_phrase("ouvre.*"));
    }

    #[test]
    fn a_language_pack_accepts_known_keys_only() {
        let ok = validate_language(r#"{"locale":"fr","phrases":{"openVerbs":["ouvre","demarre"]},"fillers":["le"]}"#);
        assert!(ok.is_ok());
        let unknown = validate_language(r#"{"locale":"fr","phrases":{"execute":["rm"]}}"#).unwrap_err();
        assert!(unknown.iter().any(|p| p.contains("inconnue")));
    }

    #[test]
    fn regular_expressions_and_extra_fields_are_refused() {
        assert!(validate_language(r#"{"locale":"fr","phrases":{"openVerbs":["ouvre.*"]}}"#).is_err());
        assert!(validate_language(r#"{"locale":"fr","phrases":{"openVerbs":["ouvre"]},"regex":"x"}"#).is_err());
    }

    #[test]
    fn aliases_must_target_a_known_application() {
        let ok = validate_aliases(r#"{"applications":[{"id":"discord","aliases":["dis cord"]}]}"#, KNOWN);
        assert!(ok.is_ok());
        let unknown = validate_aliases(r#"{"applications":[{"id":"powershell","aliases":["shell"]}]}"#, KNOWN).unwrap_err();
        assert!(unknown.iter().any(|p| p.contains("inconnue du catalogue")));
    }

    #[test]
    fn empty_language_packs_are_refused() {
        assert!(validate_language(r#"{"locale":"fr"}"#).is_err());
    }
}
