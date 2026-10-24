//! Démarrage avec Windows : une entrée dans la clé de démarrage de l'utilisateur (HKCU, sans droits administrateur),
//! créée ou supprimée seulement sur demande dans les réglages. Rien n'est écrit à l'installation.

use std::path::Path;
use std::process::Command;

use crate::error::AdapterError;
use crate::grants::require_core;

/// Clé de démarrage de l'utilisateur courant.
pub const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
/// Nom de la valeur dans cette clé.
pub const VALUE_NAME: &str = "NEXUS";

/// Commande inscrite au démarrage : le chemin de l'exécutable, entre guillemets. Un chemin qui contient un guillemet
/// est refusé, pour que la commande ne puisse pas être détournée.
pub fn startup_command(exe: &Path) -> Result<String, AdapterError> {
    let text = exe.to_string_lossy();
    if text.contains('"') || text.trim().is_empty() {
        return Err(AdapterError::InvalidTarget("chemin d'exécutable refusé pour le démarrage".into()));
    }
    Ok(format!("\"{text}\""))
}

#[cfg(windows)]
fn reg(args: &[&str]) -> Result<bool, AdapterError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let status = Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| AdapterError::Operation(format!("registre inaccessible ({error})")))?;
    Ok(status.success())
}

/// Vrai si NEXUS est inscrit au démarrage de cet utilisateur.
#[cfg(windows)]
pub fn startup_enabled() -> Result<bool, AdapterError> {
    reg(&["query", RUN_KEY, "/v", VALUE_NAME])
}

/// Inscrit ou retire NEXUS du démarrage de cet utilisateur.
#[cfg(windows)]
pub fn set_startup(enabled: bool) -> Result<(), AdapterError> {
    if enabled {
        let exe = std::env::current_exe().map_err(|error| AdapterError::Operation(format!("chemin de NEXUS introuvable ({error})")))?;
        let command = startup_command(&exe)?;
        if reg(&["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", command.as_str(), "/f"])? {
            Ok(())
        } else {
            Err(AdapterError::Operation("l'inscription au démarrage a échoué".into()))
        }
    } else if reg(&["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])? || !startup_enabled()? {
        // Déjà absent : rien à retirer, c'est le résultat voulu.
        Ok(())
    } else {
        Err(AdapterError::Operation("le retrait du démarrage a échoué".into()))
    }
}

#[cfg(not(windows))]
pub fn startup_enabled() -> Result<bool, AdapterError> {
    Err(AdapterError::Operation("le démarrage automatique n'existe que sous Windows".into()))
}

#[cfg(not(windows))]
pub fn set_startup(_enabled: bool) -> Result<(), AdapterError> {
    Err(AdapterError::Operation("le démarrage automatique n'existe que sous Windows".into()))
}

#[tauri::command]
pub fn startup_status(caller: String) -> Result<bool, AdapterError> {
    require_core(&caller)?;
    startup_enabled()
}

#[tauri::command]
pub fn startup_set(caller: String, enabled: bool) -> Result<(), AdapterError> {
    require_core(&caller)?;
    set_startup(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn the_command_is_the_quoted_executable_path() {
        let command = startup_command(&PathBuf::from(r"C:\Program Files\NEXUS\nexus.exe")).unwrap();
        assert_eq!(command, r#""C:\Program Files\NEXUS\nexus.exe""#);
    }

    #[test]
    fn a_path_that_could_break_the_command_is_refused() {
        assert!(startup_command(&PathBuf::from(r#"C:\bad"name\nexus.exe"#)).is_err());
        assert!(startup_command(&PathBuf::from("")).is_err());
    }

    #[test]
    fn the_key_is_the_user_run_key_only() {
        assert!(RUN_KEY.starts_with(r"HKCU\"));
        assert!(!RUN_KEY.contains("HKLM"));
    }
}
