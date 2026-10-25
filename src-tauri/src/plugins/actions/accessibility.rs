//! Lecture et action sur les contrôles d'une fenêtre, par l'accessibilité Windows (UI Automation).
//!
//! Trois règles :
//! - la fenêtre visée est la plus haute de l'ordre d'empilement qui n'appartient pas à NEXUS : une demande tapée dans
//!   NEXUS ne lit jamais NEXUS ;
//! - les champs de mot de passe, et tout ce qu'ils contiennent, ne sont jamais lus ; les valeurs des champs ne le sont
//!   pas non plus, seulement leurs noms et leurs rôles ;
//! - une action (invoquer un bouton) ne se fait qu'après confirmation, sur un bouton unique, dans la fenêtre vérifiée
//!   juste avant. Un nom ambigu ne déclenche rien.
//!
//! Disponible sous Windows seulement ; ailleurs, chaque fonction renvoie `unsupported-platform`.

use serde::Serialize;

use crate::error::AdapterError;

/// Nombre maximal de contrôles renvoyés pour une fenêtre.
pub const MAX_CONTROLS: usize = 150;
/// Profondeur maximale de l'arbre lu depuis la fenêtre.
pub const MAX_DEPTH: u32 = 6;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Control {
    pub role: String,
    pub name: String,
    pub enabled: bool,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub window: String,
    pub process: String,
    pub controls: Vec<Control>,
    /// Vrai quand la lecture a été arrêtée avant la fin de la fenêtre (limite de contrôles ou de profondeur).
    pub truncated: bool,
}

/// Rôle lisible d'un type de contrôle UI Automation. Un type inconnu devient « contrôle ».
pub fn role_name(control_type: i32) -> &'static str {
    match control_type {
        50000 => "bouton",
        50001 => "calendrier",
        50002 => "case à cocher",
        50003 => "liste déroulante",
        50004 => "champ de texte",
        50005 => "lien",
        50006 => "image",
        50007 => "élément de liste",
        50008 => "liste",
        50009 => "menu",
        50010 => "barre de menus",
        50011 => "élément de menu",
        50012 => "progression",
        50013 => "bouton radio",
        50014 => "barre de défilement",
        50015 => "curseur",
        50016 => "compteur",
        50017 => "barre d'état",
        50018 => "onglets",
        50019 => "onglet",
        50020 => "texte",
        50021 => "barre d'outils",
        50022 => "info-bulle",
        50023 => "arbre",
        50024 => "élément d'arbre",
        50026 => "groupe",
        50028 => "grille",
        50029 => "élément de grille",
        50030 => "document",
        50031 => "bouton à menu",
        50032 => "fenêtre",
        50033 => "volet",
        50036 => "tableau",
        50037 => "barre de titre",
        _ => "contrôle",
    }
}

/// Comparaison des noms : sans casse ni espaces autour. Les accents comptent (« Enregistrer » ≠ « Enregistré »).
pub fn same_name(candidate: &str, wanted: &str) -> bool {
    let wanted = wanted.trim();
    !wanted.is_empty() && candidate.trim().to_lowercase() == wanted.to_lowercase()
}

/// Un seul élément doit correspondre. Zéro ou plusieurs : rien n'est fait, et le message dit pourquoi.
pub fn choose_unique<T>(mut matches: Vec<T>, name: &str) -> Result<T, AdapterError> {
    match matches.len() {
        0 => Err(AdapterError::InvalidTarget(format!("aucun bouton nommé « {name} » dans la fenêtre active : rien n'a été fait"))),
        1 => Ok(matches.remove(0)),
        count => Err(AdapterError::InvalidTarget(format!("{count} boutons portent le nom « {name} » : rien n'a été fait, précisez-le"))),
    }
}

/// Fenêtre visée pour une lecture ou une action : la première qui n'appartient pas à ce processus, dans l'ordre
/// d'empilement (la plus haute en premier). Renvoie `None` quand il n'y en a aucune.
pub fn first_window_not_ours<T>(windows: impl IntoIterator<Item = (T, u32)>, own_pid: u32) -> Option<T> {
    windows.into_iter().find(|(_, pid)| *pid != own_pid).map(|(window, _)| window)
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;

    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern, IUIAutomationTreeWalker, UIA_ButtonControlTypeId,
        UIA_InvokePatternId,
    };

    use super::{choose_unique, role_name, same_name, Control, Inspection, MAX_CONTROLS, MAX_DEPTH};
    use crate::error::AdapterError;
    use crate::plugins::actions::windows::{self as desktop_windows, WindowEntry};

    /// Fenêtre visée au moment de la demande.
    pub fn target_window() -> Result<WindowEntry, AdapterError> {
        let own = std::process::id();
        let windows = desktop_windows::list()?;
        super::first_window_not_ours(windows.into_iter().map(|window| {
            let pid = window.pid;
            (window, pid)
        }), own)
        .ok_or_else(|| AdapterError::InvalidTarget("aucune fenêtre à lire : ouvrez l'application voulue, puis redemandez".into()))
    }

    fn automation() -> Result<IUIAutomation, AdapterError> {
        // SAFETY: appel COM standard ; un fil déjà initialisé renvoie un code sans conséquence, ignoré volontairement.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| AdapterError::Operation(format!("accessibilité Windows indisponible ({error})")))
        }
    }

    fn root(automation: &IUIAutomation, window: usize) -> Result<IUIAutomationElement, AdapterError> {
        // SAFETY: l'identifiant vient de l'énumération des fenêtres ; si la fenêtre a disparu, l'appel échoue proprement.
        unsafe { automation.ElementFromHandle(HWND(window as *mut c_void)) }
            .map_err(|_| AdapterError::InvalidTarget("la fenêtre visée n'existe plus".into()))
    }

    /// Parcourt les descendants visibles en profondeur, en ignorant les champs de mot de passe et leur contenu.
    /// Le visiteur renvoie `false` pour arrêter ; la fonction renvoie `false` dans ce cas.
    fn visit(walker: &IUIAutomationTreeWalker, parent: &IUIAutomationElement, depth: u32, visitor: &mut dyn FnMut(&IUIAutomationElement, u32) -> bool) -> bool {
        if depth > MAX_DEPTH {
            return true;
        }
        // SAFETY: lecture seule de l'arbre d'accessibilité ; chaque élément est relâché par COM à la fin de sa portée.
        unsafe {
            let mut next = walker.GetFirstChildElement(parent).ok();
            while let Some(element) = next {
                let secret = element.CurrentIsPassword().map(|value| value.as_bool()).unwrap_or(true);
                if !secret {
                    if !visitor(&element, depth) {
                        return false;
                    }
                    if !visit(walker, &element, depth + 1, visitor) {
                        return false;
                    }
                }
                next = walker.GetNextSiblingElement(&element).ok();
            }
        }
        true
    }

    /// Lecture d'un contrôle : nom, rôle et état. Jamais la valeur d'un champ.
    fn describe(element: &IUIAutomationElement, depth: u32) -> Option<Control> {
        // SAFETY: propriétés en lecture seule.
        unsafe {
            if element.CurrentIsOffscreen().map(|value| value.as_bool()).unwrap_or(true) {
                return None;
            }
            let name = element.CurrentName().ok()?.to_string();
            let role = role_name(element.CurrentControlType().ok()?.0);
            // Un conteneur sans nom n'apporte rien à l'utilisateur : il est parcouru, pas listé.
            if name.trim().is_empty() && matches!(role, "contrôle" | "volet" | "groupe" | "barre d'outils") {
                return None;
            }
            let enabled = element.CurrentIsEnabled().map(|value| value.as_bool()).unwrap_or(false);
            Some(Control { role: role.into(), name, enabled, depth })
        }
    }

    /// Contrôles de la fenêtre visée, avec son titre et son processus. Lecture seule.
    pub fn inspect() -> Result<Inspection, AdapterError> {
        let target = target_window()?;
        let automation = automation()?;
        let start = root(&automation, target.id)?;
        // SAFETY: parcours en lecture seule de l'arbre de contrôle.
        let walker = unsafe { automation.ControlViewWalker() }.map_err(|error| AdapterError::Operation(format!("arbre inaccessible ({error})")))?;
        let mut controls = Vec::new();
        let complete = visit(&walker, &start, 0, &mut |element, depth| {
            if controls.len() >= MAX_CONTROLS {
                return false;
            }
            if let Some(control) = describe(element, depth) {
                controls.push(control);
            }
            controls.len() < MAX_CONTROLS
        });
        Ok(Inspection { window: target.title, process: target.process, controls, truncated: !complete })
    }

    /// Boutons qui portent exactement ce nom dans la fenêtre donnée, parmi les contrôles visibles et activables.
    fn buttons_named(automation: &IUIAutomation, window: usize, name: &str) -> Result<Vec<IUIAutomationElement>, AdapterError> {
        let start = root(automation, window)?;
        // SAFETY: lecture seule de l'arbre de contrôle.
        let walker = unsafe { automation.ControlViewWalker() }.map_err(|error| AdapterError::Operation(format!("arbre inaccessible ({error})")))?;
        let mut matches = Vec::new();
        visit(&walker, &start, 0, &mut |element, _| {
            // SAFETY: propriétés en lecture seule.
            let is_button = unsafe { element.CurrentControlType() }.map(|kind| kind == UIA_ButtonControlTypeId).unwrap_or(false);
            let named = unsafe { element.CurrentName() }.map(|text| same_name(&text.to_string(), name)).unwrap_or(false);
            let offscreen = unsafe { element.CurrentIsOffscreen() }.map(|value| value.as_bool()).unwrap_or(true);
            if is_button && named && !offscreen {
                matches.push(element.clone());
            }
            matches.len() <= MAX_CONTROLS
        });
        Ok(matches)
    }

    /// Ce qui sera fait : la fenêtre et le bouton exacts, vérifiés avant la confirmation.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Plan {
        pub window_id: usize,
        pub window_title: String,
        pub process: String,
        pub name: String,
    }

    /// Vérifie la cible sans rien faire : fenêtre visée, bouton unique et activable.
    pub fn plan_invoke(name: &str) -> Result<Plan, AdapterError> {
        let window = target_window()?;
        let automation = automation()?;
        let element = choose_unique(buttons_named(&automation, window.id, name)?, name)?;
        // SAFETY: propriété en lecture seule.
        if !unsafe { element.CurrentIsEnabled() }.map(|value| value.as_bool()).unwrap_or(false) {
            return Err(AdapterError::InvalidTarget(format!("le bouton « {name} » est désactivé : rien n'a été fait")));
        }
        Ok(Plan { window_id: window.id, window_title: window.title, process: window.process, name: name.trim().to_string() })
    }

    /// Exécute un plan confirmé. La fenêtre au premier plan doit être toujours la même, et le bouton toujours unique.
    pub fn act(plan: &Plan) -> Result<(), AdapterError> {
        let now = target_window()?;
        if now.id != plan.window_id {
            return Err(AdapterError::Operation("la fenêtre visée a changé depuis la confirmation : rien n'a été fait".into()));
        }
        let automation = automation()?;
        let element = choose_unique(buttons_named(&automation, now.id, &plan.name)?, &plan.name)?;
        // SAFETY: appel du motif Invoke d'un bouton unique, après confirmation de l'utilisateur.
        unsafe {
            let pattern: IUIAutomationInvokePattern = element
                .GetCurrentPatternAs(UIA_InvokePatternId)
                .map_err(|_| AdapterError::InvalidTarget(format!("le bouton « {} » ne peut pas être activé par NEXUS", plan.name)))?;
            pattern.Invoke().map_err(|error| AdapterError::Operation(format!("activation refusée ({error})")))?;
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::{act, inspect, plan_invoke, target_window, Plan};

#[cfg(not(windows))]
mod fallback {
    use super::Inspection;
    use crate::error::AdapterError;

    fn unsupported() -> AdapterError {
        AdapterError::Operation("unsupported-platform : lecture des contrôles disponible sous Windows seulement".into())
    }

    pub fn inspect() -> Result<Inspection, AdapterError> {
        Err(unsupported())
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct Plan {
        pub window_id: usize,
        pub window_title: String,
        pub process: String,
        pub name: String,
    }

    pub fn plan_invoke(_name: &str) -> Result<Plan, AdapterError> {
        Err(unsupported())
    }

    pub fn act(_plan: &Plan) -> Result<(), AdapterError> {
        Err(unsupported())
    }
}

#[cfg(not(windows))]
pub use fallback::{act, inspect, plan_invoke, Plan};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_control_types_have_french_roles() {
        assert_eq!(role_name(50000), "bouton");
        assert_eq!(role_name(50004), "champ de texte");
        assert_eq!(role_name(50020), "texte");
        assert_eq!(role_name(12345), "contrôle");
    }

    #[test]
    fn names_match_without_case_or_surrounding_spaces_only() {
        assert!(same_name("Enregistrer", "  enregistrer "));
        assert!(!same_name("Enregistrer", "Enregistré"));
        assert!(!same_name("OK", ""));
    }

    #[test]
    fn an_action_needs_exactly_one_button() {
        assert!(choose_unique(Vec::<u8>::new(), "OK").is_err());
        assert_eq!(choose_unique(vec![7u8], "OK").unwrap(), 7);
        let message = choose_unique(vec![1u8, 2u8], "OK").unwrap_err().to_string();
        assert!(message.contains("2 boutons"), "{message}");
    }

    #[test]
    fn the_window_is_never_nexus_itself() {
        let windows = vec![("nexus", 100u32), ("notes", 200), ("word", 300)];
        assert_eq!(first_window_not_ours(windows, 100), Some("notes"));
        assert_eq!(first_window_not_ours(vec![("nexus", 100u32)], 100), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_the_platform_is_reported_as_unsupported() {
        assert!(inspect().unwrap_err().to_string().contains("unsupported-platform"));
    }

    /// Test sur le vrai bureau : active « Agrandir » dans le Bloc-notes, puis le rend. Le Bloc-notes doit être la fenêtre
    /// au premier plan. `cargo test -- --ignored live_invoke`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_invoke_maximizes_the_notepad_window() {
        let window = target_window().expect("fenêtre visée");
        assert!(window.process.to_lowercase().contains("notepad"), "le Bloc-notes doit être au premier plan, reçu {}", window.process);
        let plan = plan_invoke("Agrandir").expect("aperçu : un seul bouton « Agrandir »");
        act(&plan).expect("activation du bouton");
    }

    /// Test sur le vrai bureau : lit les contrôles de la fenêtre au premier plan hors NEXUS (ouvrir le Bloc-notes d'abord).
    /// `cargo test -- --ignored live_inspection` sur Windows.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_inspection_reads_the_window_behind_nexus() {
        let inspection = inspect().expect("lecture des contrôles");
        assert!(!inspection.window.is_empty());
        assert!(!inspection.controls.is_empty(), "aucun contrôle lu dans {}", inspection.window);
        assert!(inspection.controls.len() <= MAX_CONTROLS);
        for control in &inspection.controls {
            println!("{:>2} {:<18} {:<40} {}", control.depth, control.role, control.name, if control.enabled { "activé" } else { "désactivé" });
        }
    }
}
