//! Agenda en lecture seule : le fichier iCalendar (.ics) que l'utilisateur a désigné dans les réglages. NEXUS ne lit que
//! ce fichier, jamais un autre chemin, et jamais un fichier qui n'a pas l'extension .ics ni une taille démesurée.

use std::path::Path;

use crate::error::AdapterError;
use crate::grants::require_main;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PATH_CHARS: usize = 520;

/// Chemin accepté : un fichier .ics, sans caractère de contrôle.
pub fn check_path(path: &str) -> Result<(), AdapterError> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_PATH_CHARS || trimmed.contains('\0') {
        return Err(AdapterError::InvalidTarget("chemin d'agenda invalide".into()));
    }
    let is_ics = Path::new(trimmed).extension().and_then(|extension| extension.to_str()).is_some_and(|extension| extension.eq_ignore_ascii_case("ics"));
    if !is_ics {
        return Err(AdapterError::InvalidTarget("l'agenda doit être un fichier .ics".into()));
    }
    Ok(())
}

/// Contenu de l'agenda, borné en taille.
pub fn read_agenda(path: &str) -> Result<String, AdapterError> {
    check_path(path)?;
    let metadata = std::fs::metadata(path.trim()).map_err(|error| AdapterError::Operation(format!("agenda introuvable ({error})")))?;
    if metadata.len() > MAX_BYTES {
        return Err(AdapterError::Operation("agenda trop volumineux".into()));
    }
    let bytes = std::fs::read(path.trim()).map_err(|error| AdapterError::Operation(format!("agenda illisible ({error})")))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn agenda_read(webview: tauri::Webview, path: String) -> Result<String, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || read_agenda(&path))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ics_files_are_accepted() {
        assert!(check_path(r"C:\Users\ana\agenda.ics").is_ok());
        assert!(check_path(r"C:\Users\ana\AGENDA.ICS").is_ok());
        assert!(check_path(r"C:\Users\ana\notes.txt").is_err());
        assert!(check_path("").is_err());
        assert!(check_path("agenda.ics\0.exe").is_err());
    }

    #[test]
    fn a_small_agenda_is_read_and_a_huge_one_is_refused() {
        let directory = std::env::temp_dir().join(format!("nexus-agenda-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let small = directory.join("petit.ics");
        std::fs::write(&small, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").unwrap();
        assert!(read_agenda(small.to_str().unwrap()).unwrap().contains("BEGIN:VCALENDAR"));

        let huge = directory.join("gros.ics");
        std::fs::write(&huge, vec![b'a'; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(read_agenda(huge.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&directory);
    }
}
