//! Lecture du presse-papiers, à la demande seulement. Le texte lu sert à une action (traduire, résumer) faite par le
//! modèle local. Rien n'est lu en arrière-plan, rien n'est écrit, et le texte ne quitte pas le poste.

use crate::error::AdapterError;

/// Taille maximale du texte pris dans le presse-papiers. Au-delà, le texte est coupé : le modèle local a un contexte borné.
pub const MAX_CHARS: usize = 8_000;

/// Texte du presse-papiers, borné et sans caractères de contrôle. Erreur explicite si le presse-papiers ne contient pas de texte.
pub fn read_text() -> Result<String, AdapterError> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| AdapterError::Operation(format!("presse-papiers indisponible ({error})")))?;
    let raw = clipboard.get_text().map_err(|_| AdapterError::InvalidTarget("le presse-papiers ne contient pas de texte".into()))?;
    clean(&raw)
}

/// Nettoie et borne un texte : retire les caractères de contrôle, sauf les retours à la ligne et les tabulations.
pub fn clean(raw: &str) -> Result<String, AdapterError> {
    let text: String = raw.chars().filter(|character| !character.is_control() || matches!(character, '\n' | '\t')).take(MAX_CHARS).collect();
    if text.trim().is_empty() {
        return Err(AdapterError::InvalidTarget("le presse-papiers est vide".into()));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_characters_are_removed_but_lines_and_tabs_are_kept() {
        assert_eq!(clean("a\u{0007}b\nc\td").unwrap(), "ab\nc\td");
    }

    #[test]
    fn an_empty_clipboard_is_an_explicit_error() {
        assert!(clean("  \n ").is_err());
        assert!(clean("").is_err());
    }

    #[test]
    fn the_text_is_bounded() {
        let long = "x".repeat(MAX_CHARS + 500);
        assert_eq!(clean(&long).unwrap().chars().count(), MAX_CHARS);
    }
}
