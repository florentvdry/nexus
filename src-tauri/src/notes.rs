//! Notes Obsidian. Un coffre Obsidian est un dossier de fichiers Markdown : NEXUS y écrit seulement dans son sous-dossier
//! `NEXUS/`, sous un nom simple, et n'écrase jamais une note qu'il n'a pas créée (le marqueur en tête de fichier le dit).
//! L'écriture est confirmée par le courtier avant d'avoir lieu (voir `lib.rs`).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::AdapterError;

/// Dossier du coffre réservé à NEXUS. Rien n'est écrit en dehors.
pub const FOLDER: &str = "NEXUS";
/// Première ligne de chaque note créée par NEXUS : sans elle, une note existante n'est jamais remplacée.
pub const MARKER: &str = "<!-- créé par NEXUS -->";
/// Taille maximale d'une note.
pub const MAX_BYTES: usize = 200_000;

/// Chemin de la note dans le coffre : `NEXUS/<nom>.md`, où le nom ne contient que des lettres, chiffres, espaces,
/// tirets, traits de soulignement et une barre oblique pour un sous-dossier. Pas de `..`, pas de chemin absolu.
pub fn note_path(vault: &Path, relative: &str) -> Result<PathBuf, AdapterError> {
    if !vault.is_absolute() || !vault.is_dir() {
        return Err(AdapterError::InvalidTarget("le coffre Obsidian n'est pas un dossier existant".into()));
    }
    let name = relative.trim();
    let valid_chars = name.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '/' | '.'));
    let parts: Vec<&str> = name.split('/').collect();
    let well_formed = !name.is_empty()
        && name.len() <= 120
        && valid_chars
        && name.ends_with(".md")
        && parts.iter().all(|part| !part.is_empty() && *part != "." && *part != "..");
    if !well_formed {
        return Err(AdapterError::InvalidTarget(format!("nom de note refusé : {relative}")));
    }
    let mut path = vault.join(FOLDER);
    for part in parts {
        path.push(part);
    }
    Ok(path)
}

/// Écrit la note après vérification. Renvoie son chemin. Une note existante sans le marqueur de NEXUS n'est pas remplacée.
pub fn save(vault: &Path, relative: &str, content: &str) -> Result<PathBuf, AdapterError> {
    if content.len() > MAX_BYTES {
        return Err(AdapterError::InvalidTarget("note trop longue".into()));
    }
    let path = note_path(vault, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AdapterError::Operation(format!("dossier impossible ({error})")))?;
    }
    if path.exists() {
        let existing = fs::read_to_string(&path).unwrap_or_default();
        if !existing.starts_with(MARKER) {
            return Err(AdapterError::Operation("une note existe déjà à cet endroit et n'a pas été créée par NEXUS : rien n'a été remplacé".into()));
        }
    }
    let text = format!("{MARKER}\n\n{}", content.trim_end());
    // Écriture par fichier temporaire puis renommage : une panne au milieu ne laisse pas une note à moitié écrite.
    let temporary = path.with_extension("md.tmp");
    {
        let mut file = fs::File::create(&temporary).map_err(|error| AdapterError::Operation(format!("écriture impossible ({error})")))?;
        file.write_all(text.as_bytes()).map_err(|error| AdapterError::Operation(format!("écriture impossible ({error})")))?;
        file.sync_all().ok();
    }
    fs::rename(&temporary, &path).map_err(|error| AdapterError::Operation(format!("enregistrement impossible ({error})")))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexus-obsidian-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn notes_stay_inside_the_nexus_folder() {
        let dir = vault("path");
        let path = note_path(&dir, "Memoire.md").unwrap();
        assert!(path.starts_with(dir.join(FOLDER)));
        assert!(note_path(&dir, "Rapports/2026-10-25.md").is_ok());
    }

    #[test]
    fn traversal_and_odd_names_are_refused() {
        let dir = vault("refuse");
        for bad in ["../secret.md", "/abs.md", "a/../../b.md", "note.txt", "", "a\\b.md", "con:.md"] {
            assert!(note_path(&dir, bad).is_err(), "{bad} doit être refusé");
        }
        let long = format!("{}.md", "a".repeat(130));
        assert!(note_path(&dir, &long).is_err());
    }

    #[test]
    fn a_note_is_written_with_the_marker_and_replaced_only_when_nexus_made_it() {
        let dir = vault("save");
        let path = save(&dir, "Memoire.md", "Prénom : Ana").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with(MARKER));
        assert!(text.contains("Prénom : Ana"));
        save(&dir, "Memoire.md", "Ville : Lyon").unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("Ville : Lyon"));
    }

    #[test]
    fn a_users_own_note_is_never_overwritten() {
        let dir = vault("users");
        let folder = dir.join(FOLDER);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("Journal.md"), "mon journal, pas celui de NEXUS").unwrap();
        assert!(save(&dir, "Journal.md", "écrasé").is_err());
        assert_eq!(fs::read_to_string(folder.join("Journal.md")).unwrap(), "mon journal, pas celui de NEXUS");
    }

    #[test]
    fn the_vault_must_be_an_existing_folder() {
        assert!(note_path(Path::new("C:\\n-existe-pas-du-tout"), "a.md").is_err());
        assert!(note_path(Path::new("relatif"), "a.md").is_err());
    }
}
