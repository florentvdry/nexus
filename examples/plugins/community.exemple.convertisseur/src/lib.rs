//! Convertisseur d'unités et mémo : exemple de plugin NEXUS en Rust (WebAssembly).

use nexus_plugin_sdk::{export_commands, host, Input, Output};

/// Couples d'unités : (unité d'origine, unité d'arrivée, facteur, décalage). Valeur d'arrivée = valeur × facteur + décalage.
const PAIRS: &[(&str, &str, f64, f64)] = &[
    ("km", "mi", 0.621_371, 0.0),
    ("mi", "km", 1.609_344, 0.0),
    ("kg", "lb", 2.204_62, 0.0),
    ("lb", "kg", 0.453_592, 0.0),
    ("c", "f", 1.8, 32.0),
    ("f", "c", 5.0 / 9.0, -32.0 * 5.0 / 9.0),
];

/// Lit « 12 km en miles », « 100 c en f », etc.
fn parse(text: &str) -> Option<(f64, &'static str, &'static str, f64, f64)> {
    let mut words = text.split_whitespace();
    let value: f64 = words.next()?.replace(',', ".").parse().ok()?;
    let from = words.next()?.to_lowercase();
    let connector = words.next()?.to_lowercase();
    let to = words.next()?.to_lowercase();
    if connector != "en" && connector != "to" {
        return None;
    }
    let (from_unit, to_unit, factor, offset) = PAIRS.iter().find(|(a, b, _, _)| {
        (*a == from || matches_name(&from, a)) && (*b == to || matches_name(&to, b))
    })?;
    Some((value, from_unit, to_unit, *factor, *offset))
}

/// Noms usuels : « miles », « kilomètres », « livres », « celsius », « fahrenheit ».
fn matches_name(word: &str, unit: &str) -> bool {
    match unit {
        "km" => word.starts_with("kilom"),
        "mi" => word.starts_with("mile"),
        "kg" => word.starts_with("kilogramme"),
        "lb" => word.starts_with("livre") || word.starts_with("pound"),
        "c" => word.starts_with("celsius"),
        "f" => word.starts_with("fahrenheit"),
        _ => false,
    }
}

/// Format français : deux décimales, virgule.
fn french(value: f64) -> String {
    format!("{value:.2}").replace('.', ",")
}

fn convert(input: Input) -> Result<Output, String> {
    let (value, from, to, factor, offset) = parse(&input.text).ok_or("écris par exemple « 12 km en miles »")?;
    let result = value * factor + offset;
    Ok(Output::text(format!("{} {from} = {} {to}", french(value), french(result))))
}

fn memorise(input: Input) -> Result<Output, String> {
    let note = input.text.trim();
    if note.is_empty() {
        return Err("rien à retenir".into());
    }
    host::storage_set("note", note)?;
    Ok(Output::text("Noté."))
}

fn rappelle(_input: Input) -> Result<Output, String> {
    match host::storage_get("note")? {
        Some(note) => Ok(Output::text(format!("Tu as noté : {note}"))),
        None => Ok(Output::text("Rien de noté pour l'instant.")),
    }
}

export_commands! {
    "convertit" => convert,
    "memorise" => memorise,
    "rappelle" => rappelle,
}
