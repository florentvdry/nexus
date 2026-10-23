//! Fenêtres de bureau : liste, activation et demande de fermeture. Disponible sous Windows seulement ; ailleurs,
//! chaque fonction renvoie `unsupported-platform`.
//!
//! La fermeture envoie `WM_CLOSE` : l'application décide, et peut demander d'enregistrer avant de se fermer.
//! NEXUS ne termine jamais un processus et ne ferme jamais sa propre fenêtre.

use serde::Serialize;

use crate::error::AdapterError;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowEntry {
    /// Identifiant de fenêtre (HWND). Valable tant que la fenêtre existe : chaque action le revérifie.
    pub id: usize,
    pub title: String,
    pub process: String,
    pub pid: u32,
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;
    use std::ffi::c_void;

    use sysinfo::{ProcessesToUpdate, System};
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        PostMessageW, SetForegroundWindow, ShowWindow, GWL_EXSTYLE, SW_RESTORE, WM_CLOSE, WS_EX_TOOLWINDOW,
    };

    use super::WindowEntry;
    use crate::error::AdapterError;

    /// Titre, identifiant de processus d'une fenêtre visible et ordinaire ; `None` pour les autres.
    unsafe fn read_window(hwnd: HWND) -> Option<(String, u32)> {
        if !IsWindowVisible(hwnd).as_bool() {
            return None;
        }
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if style & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        let title = String::from_utf16_lossy(&buffer[..copied.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        Some((title, pid))
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let found = &mut *(lparam.0 as *mut Vec<(usize, String, u32)>);
        if let Some((title, pid)) = read_window(hwnd) {
            found.push((hwnd.0 as usize, title, pid));
        }
        BOOL(1)
    }

    pub fn list() -> Result<Vec<WindowEntry>, AdapterError> {
        let mut found: Vec<(usize, String, u32)> = Vec::new();
        unsafe { EnumWindows(Some(collect), LPARAM(&mut found as *mut _ as isize)) }
            .map_err(|error| AdapterError::Operation(error.to_string()))?;

        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let names: HashMap<u32, String> = system
            .processes()
            .iter()
            .map(|(pid, process)| (pid.as_u32(), process.name().to_string_lossy().into_owned()))
            .collect();

        let own = std::process::id();
        Ok(found
            .into_iter()
            .filter(|(_, _, pid)| *pid != own)
            .map(|(id, title, pid)| WindowEntry {
                id,
                title,
                process: names.get(&pid).cloned().unwrap_or_default(),
                pid,
            })
            .collect())
    }

    pub fn focus(hwnd: HWND) -> Result<(), AdapterError> {
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err(AdapterError::Operation("Windows n'a pas autorisé le passage au premier plan".into()));
            }
        }
        Ok(())
    }

    pub fn close(hwnd: HWND) -> Result<(), AdapterError> {
        unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(|error| AdapterError::Operation(error.to_string()))
    }

    pub fn handle(id: usize) -> HWND {
        HWND(id as *mut c_void)
    }
}

/// Fenêtres visibles, sans les fenêtres d'outils ni celles de NEXUS.
#[cfg(windows)]
pub fn list() -> Result<Vec<WindowEntry>, AdapterError> {
    platform::list()
}

#[cfg(not(windows))]
pub fn list() -> Result<Vec<WindowEntry>, AdapterError> {
    Err(unsupported())
}

/// Renvoie la fenêtre désignée, en revérifiant qu'elle existe encore. Sert aussi à afficher ce qui va être fermé.
pub fn describe(id: usize) -> Result<WindowEntry, AdapterError> {
    list()?.into_iter().find(|window| window.id == id).ok_or_else(|| AdapterError::WindowNotFound(id.to_string()))
}

/// Ramène la fenêtre au premier plan (la restaure si elle est réduite).
#[cfg(windows)]
pub fn focus(id: usize) -> Result<(), AdapterError> {
    describe(id)?;
    platform::focus(platform::handle(id))
}

/// Demande à l'application de se fermer : elle peut refuser, ou demander d'enregistrer.
#[cfg(windows)]
pub fn close(id: usize) -> Result<(), AdapterError> {
    let window = describe(id)?;
    if window.pid == std::process::id() {
        return Err(AdapterError::Operation("NEXUS ne ferme pas sa propre fenêtre".into()));
    }
    platform::close(platform::handle(id))
}

#[cfg(not(windows))]
pub fn focus(_id: usize) -> Result<(), AdapterError> {
    Err(unsupported())
}

#[cfg(not(windows))]
pub fn close(_id: usize) -> Result<(), AdapterError> {
    Err(unsupported())
}

#[cfg(not(windows))]
fn unsupported() -> AdapterError {
    AdapterError::Unsupported("contrôle des fenêtres (Windows uniquement)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sur Windows, l'énumération réussit même sans fenêtre visible.
    #[cfg(windows)]
    #[test]
    fn listing_works_on_windows() {
        assert!(list().is_ok());
    }

    /// Ailleurs, la fonction le signale clairement au lieu de renvoyer une liste vide.
    #[cfg(not(windows))]
    #[test]
    fn listing_reports_the_platform_honestly() {
        assert!(matches!(list(), Err(AdapterError::Unsupported(_))));
    }

    #[cfg(windows)]
    #[test]
    fn an_unknown_window_is_reported_not_guessed() {
        assert!(matches!(describe(usize::MAX), Err(AdapterError::WindowNotFound(_))));
    }

    #[cfg(not(windows))]
    #[test]
    fn an_unknown_window_is_reported_not_guessed() {
        assert!(matches!(close(1), Err(AdapterError::Unsupported(_))));
    }

    /// Test sur le vrai bureau : ouvre le Bloc-notes, le retrouve, l'active puis demande sa fermeture.
    /// Sous Windows 11, le Bloc-notes est une application empaquetée : le processus lancé passe la main à un autre
    /// processus. La fenêtre est donc cherchée parmi les Bloc-notes absents avant le lancement, et suivie par son
    /// identifiant : une fenêtre déjà ouverte par l'utilisateur n'est jamais visée.
    /// `cargo test -- --ignored live_` sur Windows.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_notepad_is_listed_focused_and_closed() {
        use std::collections::HashSet;
        use std::time::{Duration, Instant};

        let notepads = || -> Vec<WindowEntry> {
            list().expect("liste des fenêtres").into_iter().filter(|entry| entry.process.eq_ignore_ascii_case("notepad.exe")).collect()
        };
        let before: HashSet<usize> = notepads().iter().map(|entry| entry.id).collect();

        let mut child = std::process::Command::new("notepad.exe").spawn().expect("notepad.exe doit se lancer");
        let started = Instant::now();
        let window = loop {
            if let Some(entry) = notepads().into_iter().find(|entry| !before.contains(&entry.id)) {
                break entry;
            }
            assert!(started.elapsed() < Duration::from_secs(10), "la fenêtre du Bloc-notes n'apparaît pas dans la liste");
            std::thread::sleep(Duration::from_millis(200));
        };

        let focused = focus(window.id);
        let closed = close(window.id);
        let waiting_since = Instant::now();
        let gone = loop {
            let still_open = list().expect("liste des fenêtres").iter().any(|entry| entry.id == window.id);
            if !still_open {
                break true;
            }
            if waiting_since.elapsed() > Duration::from_secs(5) {
                break false;
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        let _ = child.kill();
        let _ = child.wait();

        focused.expect("Windows doit autoriser l'activation de la fenêtre");
        closed.expect("WM_CLOSE doit être accepté");
        assert!(gone, "la fenêtre est restée ouverte (l'application a peut-être demandé d'enregistrer)");
    }
}
