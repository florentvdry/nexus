//! Contrôle des arguments d'un outil MCP contre le JSON Schema annoncé par le serveur. Un argument produit par le modèle
//! n'est jamais transmis tel quel : il doit respecter le schéma, sinon l'appel est refusé avant de lancer quoi que ce soit.
//!
//! Sous-ensemble volontairement strict : `type`, `properties`, `required`, `additionalProperties` (booléen ou schéma),
//! `items`, `enum`, `minLength`/`maxLength`, `minItems`/`maxItems`, `minimum`/`maximum`. Un schéma qui utilise une
//! composition (`anyOf`, `oneOf`, `allOf`, `not`) ou une référence (`$ref`) est refusé : NEXUS ne sait pas le vérifier.

use serde_json::{Map, Value};

/// Taille maximale des arguments sérialisés : un appel d'outil n'a pas besoin de plus, et la limite borne la mémoire.
pub const MAX_ARGUMENT_BYTES: usize = 64 * 1024;
const UNSUPPORTED: &[&str] = &["$ref", "anyOf", "oneOf", "allOf", "not"];

/// Vérifie `value` contre `schema`. Renvoie le premier défaut trouvé, lisible par l'utilisateur.
pub fn validate(schema: &Value, value: &Value) -> Result<(), String> {
    let size = serde_json::to_string(value).map(|text| text.len()).unwrap_or(usize::MAX);
    if size > MAX_ARGUMENT_BYTES {
        return Err(format!("arguments trop volumineux ({size} octets, maximum {MAX_ARGUMENT_BYTES})"));
    }
    check(schema, value, "racine")
}

fn check(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    let Some(schema) = schema.as_object() else {
        // Un schéma absent ou non objet n'impose rien, sauf sous forme de booléen, refusée ici par prudence.
        return if schema.is_null() { Ok(()) } else { Err(format!("{path} : schéma non pris en charge")) };
    };
    if let Some(keyword) = UNSUPPORTED.iter().find(|keyword| schema.contains_key(**keyword)) {
        return Err(format!("{path} : schéma non pris en charge ({keyword})"));
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(value) {
            return Err(format!("{path} : valeur hors des choix autorisés"));
        }
    }
    if let Some(expected) = schema.get("type") {
        if !type_matches(expected, value) {
            return Err(format!("{path} : type attendu {}", describe_type(expected)));
        }
    }
    match value {
        Value::Object(map) => check_object(schema, map, path),
        Value::Array(items) => check_array(schema, items, path),
        Value::String(text) => check_string(schema, text, path),
        Value::Number(number) => check_number(schema, number.as_f64().unwrap_or(f64::NAN), path),
        _ => Ok(()),
    }
}

fn check_object(schema: &Map<String, Value>, map: &Map<String, Value>, path: &str) -> Result<(), String> {
    for name in schema.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        if !map.contains_key(name) {
            return Err(format!("{path} : champ obligatoire absent : {name}"));
        }
    }
    let properties = schema.get("properties").and_then(Value::as_object);
    for (name, value) in map {
        match properties.and_then(|properties| properties.get(name)) {
            Some(property) => check(property, value, &format!("{path}.{name}"))?,
            None => match schema.get("additionalProperties") {
                Some(Value::Bool(false)) => return Err(format!("{path} : champ inattendu : {name}")),
                Some(extra) if extra.is_object() => check(extra, value, &format!("{path}.{name}"))?,
                _ => {}
            },
        }
    }
    Ok(())
}

fn check_array(schema: &Map<String, Value>, items: &[Value], path: &str) -> Result<(), String> {
    if let Some(max) = schema.get("maxItems").and_then(Value::as_u64) {
        if items.len() as u64 > max {
            return Err(format!("{path} : au plus {max} éléments"));
        }
    }
    if let Some(min) = schema.get("minItems").and_then(Value::as_u64) {
        if (items.len() as u64) < min {
            return Err(format!("{path} : au moins {min} éléments"));
        }
    }
    if let Some(item_schema) = schema.get("items") {
        for (index, item) in items.iter().enumerate() {
            check(item_schema, item, &format!("{path}[{index}]"))?;
        }
    }
    Ok(())
}

fn check_string(schema: &Map<String, Value>, text: &str, path: &str) -> Result<(), String> {
    let length = text.chars().count() as u64;
    if let Some(max) = schema.get("maxLength").and_then(Value::as_u64) {
        if length > max {
            return Err(format!("{path} : au plus {max} caractères"));
        }
    }
    if let Some(min) = schema.get("minLength").and_then(Value::as_u64) {
        if length < min {
            return Err(format!("{path} : au moins {min} caractères"));
        }
    }
    Ok(())
}

fn check_number(schema: &Map<String, Value>, number: f64, path: &str) -> Result<(), String> {
    if let Some(min) = schema.get("minimum").and_then(Value::as_f64) {
        if number < min {
            return Err(format!("{path} : au moins {min}"));
        }
    }
    if let Some(max) = schema.get("maximum").and_then(Value::as_f64) {
        if number > max {
            return Err(format!("{path} : au plus {max}"));
        }
    }
    Ok(())
}

fn type_matches(expected: &Value, value: &Value) -> bool {
    match expected {
        Value::String(name) => single_type_matches(name, value),
        Value::Array(names) => names.iter().filter_map(Value::as_str).any(|name| single_type_matches(name, value)),
        _ => true,
    }
}

fn single_type_matches(name: &str, value: &Value) -> bool {
    match name {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some() || value.as_f64().is_some_and(|n| n.fract() == 0.0),
        _ => false,
    }
}

fn describe_type(expected: &Value) -> String {
    match expected {
        Value::String(name) => name.clone(),
        Value::Array(names) => names.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ou "),
        _ => "inconnu".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn send_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "channel": { "type": "string", "maxLength": 20 },
                "text": { "type": "string" },
                "priority": { "type": "integer", "minimum": 0, "maximum": 3 },
                "recipients": { "type": "array", "items": { "type": "string" }, "maxItems": 2 },
                "mode": { "enum": ["draft", "send"] }
            },
            "required": ["channel", "text"],
            "additionalProperties": false
        })
    }

    #[test]
    fn a_valid_call_is_accepted() {
        let arguments = json!({ "channel": "general", "text": "bonjour", "priority": 2, "recipients": ["a"], "mode": "draft" });
        assert!(validate(&send_schema(), &arguments).is_ok());
    }

    #[test]
    fn a_missing_required_field_is_refused() {
        let error = validate(&send_schema(), &json!({ "channel": "general" })).unwrap_err();
        assert!(error.contains("text"), "{error}");
    }

    #[test]
    fn an_unexpected_field_is_refused_when_the_schema_forbids_it() {
        let error = validate(&send_schema(), &json!({ "channel": "a", "text": "b", "to_all": true })).unwrap_err();
        assert!(error.contains("to_all"), "{error}");
    }

    #[test]
    fn types_enums_and_bounds_are_checked_on_every_value() {
        let schema = send_schema();
        assert!(validate(&schema, &json!({ "channel": "a", "text": 3 })).is_err());
        assert!(validate(&schema, &json!({ "channel": "a", "text": "b", "priority": 2.5 })).is_err());
        assert!(validate(&schema, &json!({ "channel": "a", "text": "b", "priority": 9 })).is_err());
        assert!(validate(&schema, &json!({ "channel": "a", "text": "b", "recipients": ["x", "y", "z"] })).is_err());
        assert!(validate(&schema, &json!({ "channel": "a", "text": "b", "recipients": [1] })).is_err());
        assert!(validate(&schema, &json!({ "channel": "a", "text": "b", "mode": "envoi-direct" })).is_err());
        assert!(validate(&schema, &json!({ "channel": "trois fois vingt caracteres!!", "text": "b" })).is_err());
    }

    #[test]
    fn a_schema_it_cannot_check_is_refused_instead_of_trusted() {
        let schema = json!({ "type": "object", "properties": { "x": { "anyOf": [{ "type": "string" }] } } });
        let error = validate(&schema, &json!({ "x": "y" })).unwrap_err();
        assert!(error.contains("non pris en charge"), "{error}");
    }

    #[test]
    fn oversized_arguments_are_refused() {
        let big = "a".repeat(MAX_ARGUMENT_BYTES + 1);
        let schema = json!({ "type": "object" });
        assert!(validate(&schema, &json!({ "text": big })).is_err());
    }

    #[test]
    fn an_extra_field_can_be_checked_against_its_own_schema() {
        let schema = json!({ "type": "object", "additionalProperties": { "type": "number" } });
        assert!(validate(&schema, &json!({ "n": 1 })).is_ok());
        assert!(validate(&schema, &json!({ "n": "un" })).is_err());
    }
}
