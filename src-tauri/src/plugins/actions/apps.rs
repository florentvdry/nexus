//! Lancement d'une application trouvée sur ce PC. Aucun catalogue n'est tenu : à chaque besoin, NEXUS regarde où Windows
//! range les applications, puis retient celle dont le nom correspond.
//!
//! Sources, par ordre de priorité : la liste des applications du menu Démarrer (`Get-StartApps`, qui donne le nom affiché
//! par Windows, par exemple « Bloc-notes » ou « Calculatrice » en français, y compris les applications du Store), les
//! raccourcis du menu Démarrer, les clés « App Paths » du registre (chemin direct de l'exécutable), puis les exécutables
//! sous Program Files et AppData\Local\Programs. Le frontend ne transmet jamais de commande : il transmet un nom, et seule
//! une application trouvée par le scan peut être lancée.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::AdapterError;

/// Profondeur maximale des dossiers parcourus, et nombre maximal d'entrées retenues.
const MAX_DEPTH_SHORTCUTS: usize = 4;
const MAX_DEPTH_PROGRAMS: usize = 3;
const MAX_ENTRIES: usize = 8000;
/// Au-delà, le scan est refait : une application installée depuis reste trouvée sans redémarrer NEXUS.
const INDEX_TTL: Duration = Duration::from_secs(600);

/// Mots sans valeur pour reconnaître un nom : « lance LE bloc-notes » et « lance the paint » donnent le même nom.
const FILLERS: &[&str] = &["le", "la", "les", "l", "un", "une", "de", "du", "des", "the", "mon", "ma", "mes", "my", "exe", "lnk"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Raccourci du menu Démarrer : Windows sait le lancer, on le confie à l'explorateur.
    Shortcut,
    /// Application du dossier « Applications » de Windows (Store, ou programme inscrit au menu) : identifiant AppUserModel.
    AppsFolder,
    /// Exécutable trouvé directement.
    Executable,
}

/// Une application trouvée : son nom affiché, son chemin (ou son identifiant AppUserModel), et la façon de la lancer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub name: String,
    pub path: PathBuf,
    pub kind: Kind,
}

/// Application trouvée, telle qu'elle est montrée au frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppMatch {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOutcome {
    pub display_name: String,
}

/// Mise en forme d'un nom pour la comparaison : minuscules, sans accent, ponctuation en espaces, mots vides retirés.
pub fn name_words(text: &str) -> Vec<String> {
    let folded: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    folded.split_whitespace().filter(|word| !FILLERS.contains(word)).map(str::to_string).collect()
}

/// Point de préférence selon la source : un raccourci passe avant le dossier « Applications », lui-même avant un exécutable.
fn source_bonus(kind: Kind) -> u32 {
    match kind {
        Kind::Shortcut => 2,
        Kind::AppsFolder => 1,
        Kind::Executable => 0,
    }
}

/// Score d'une application pour une demande : 0 si elle ne correspond pas. Un nom exact passe avant un nom qui
/// contient les mots demandés ; un nom plus court passe avant un nom plus long à égalité.
fn score(found: &Found, query: &[String]) -> u32 {
    if query.is_empty() {
        return 0;
    }
    let name = name_words(&found.name);
    let bonus = source_bonus(found.kind);
    if name == query {
        return 100 + bonus;
    }
    if query.iter().all(|word| name.contains(word)) {
        let extra = name.len().saturating_sub(query.len()) as u32;
        return 80u32.saturating_sub(extra.min(30) * 2) + bonus;
    }
    let joined = query.join(" ");
    if name.join(" ").contains(&joined) {
        return 40 + bonus;
    }
    0
}

/// L'application la mieux placée pour ce nom, parmi celles trouvées. `None` si aucune ne correspond.
pub fn best_match<'a>(found: &'a [Found], requested: &str) -> Option<&'a Found> {
    let query = name_words(requested);
    found
        .iter()
        .map(|entry| (score(entry, &query), entry))
        .filter(|(points, _)| *points > 0)
        .max_by(|(left_points, left), (right_points, right)| {
            left_points
                .cmp(right_points)
                .then_with(|| right.name.len().cmp(&left.name.len()))
        })
        .map(|(_, entry)| entry)
}

/// Dossiers du menu Démarrer : celui de l'utilisateur et celui de tous les utilisateurs.
fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(programdata) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(programdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    roots
}

/// Dossiers où les installeurs rangent les exécutables.
fn program_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(|variable| std::env::var(variable).ok()).map(PathBuf::from).collect();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs"));
    }
    roots
}

/// Noms qui ne désignent pas l'application elle-même : désinstallation, notes de version, aide, mises à jour.
fn is_helper_name(stem: &str) -> bool {
    let lower = stem.to_lowercase();
    ["uninstall", "désinstall", "desinstall", "readme", "release notes", "update", "setup", "installer", "crash", "helper", "redist", "unins"]
        .iter()
        .any(|word| lower.contains(word))
}

/// Parcourt un dossier et ajoute les raccourcis (ou les exécutables) trouvés.
fn walk(root: &Path, kind: Kind, depth: usize, out: &mut Vec<Found>) {
    if depth == 0 || out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            walk(&path, kind, depth - 1, out);
            continue;
        }
        let wanted = match kind {
            Kind::Shortcut => "lnk",
            Kind::Executable => "exe",
            Kind::AppsFolder => return,
        };
        let is_wanted = path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| extension.eq_ignore_ascii_case(wanted));
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if is_wanted && !is_helper_name(stem) {
            out.push(Found { name: stem.to_string(), path: path.clone(), kind });
        }
    }
}

/// Entrée de `Get-StartApps` : le nom affiché par Windows et l'identifiant AppUserModel pour le lancer.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct StartApp {
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

/// Lit la sortie JSON de `Get-StartApps`. ConvertTo-Json donne un objet seul quand il n'y a qu'une application.
pub fn parse_start_apps(json: &str) -> Vec<Found> {
    let text = json.trim();
    let apps: Vec<StartApp> = match serde_json::from_str::<Vec<StartApp>>(text) {
        Ok(list) => list,
        Err(_) => serde_json::from_str::<StartApp>(text).map(|app| vec![app]).unwrap_or_default(),
    };
    apps.into_iter()
        .filter(|app| !app.name.trim().is_empty() && !app.app_id.trim().is_empty() && !is_helper_name(&app.name))
        .map(|app| Found { name: app.name, path: PathBuf::from(app.app_id), kind: Kind::AppsFolder })
        .collect()
}

#[cfg(windows)]
fn start_apps() -> Vec<Found> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(output) = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | ConvertTo-Json -Compress"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    parse_start_apps(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(windows))]
fn start_apps() -> Vec<Found> {
    Vec::new()
}

/// Lit une sortie de `reg query /s` sur les clés « App Paths » : nom de l'exécutable et chemin de sa valeur par défaut.
pub fn parse_app_paths(output: &str) -> Vec<Found> {
    let mut found = Vec::new();
    let mut current: Option<String> = None;
    for line in output.lines() {
        if line.starts_with("HKEY") {
            current = line.rsplit('\\').next().filter(|segment| segment.to_lowercase().ends_with(".exe")).map(str::to_string);
        } else if let (Some(name), true) = (current.as_ref(), line.trim_start().starts_with("(Default)")) {
            if let Some(at) = line.find("REG_SZ") {
                let path = line[at + "REG_SZ".len()..].trim().trim_matches('"');
                if path.to_lowercase().ends_with(".exe") {
                    let stem = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name.as_str());
                    found.push(Found { name: stem.to_string(), path: PathBuf::from(path), kind: Kind::Executable });
                }
            }
            current = None;
        }
    }
    found
}

#[cfg(windows)]
fn app_paths() -> Vec<Found> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut found = Vec::new();
    for key in [r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths", r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"] {
        let Ok(output) = Command::new("reg").args(["query", key, "/s"]).creation_flags(CREATE_NO_WINDOW).output() else {
            continue;
        };
        found.extend(parse_app_paths(&String::from_utf8_lossy(&output.stdout)).into_iter().filter(|entry| entry.path.is_file()));
    }
    found
}

#[cfg(not(windows))]
fn app_paths() -> Vec<Found> {
    Vec::new()
}

/// Scan complet du PC : applications du menu Démarrer, raccourcis, registre, puis dossiers des programmes.
pub fn scan() -> Vec<Found> {
    let mut found = start_apps();
    for root in start_menu_roots() {
        walk(&root, Kind::Shortcut, MAX_DEPTH_SHORTCUTS, &mut found);
    }
    found.extend(app_paths());
    for root in program_roots() {
        walk(&root, Kind::Executable, MAX_DEPTH_PROGRAMS, &mut found);
    }
    found
}

/// Dernier scan, gardé pour ne pas refaire le parcours à chaque demande.
static INDEX: Mutex<Option<(Instant, Vec<Found>)>> = Mutex::new(None);

fn cached_or_fresh_scan(force: bool) -> Vec<Found> {
    let mut index = INDEX.lock().unwrap_or_else(|poison| poison.into_inner());
    match index.as_ref() {
        Some((taken, found)) if !force && taken.elapsed() < INDEX_TTL => found.clone(),
        _ => {
            let found = scan();
            *index = Some((Instant::now(), found.clone()));
            found
        }
    }
}

/// L'application demandée, cherchée dans le dernier scan, puis dans un scan neuf si elle n'y est pas.
pub fn find(requested: &str) -> Option<Found> {
    let found = cached_or_fresh_scan(false);
    best_match(&found, requested).cloned().or_else(|| best_match(&cached_or_fresh_scan(true), requested).cloned())
}

/// Lance une application trouvée. Un raccourci ou une application du Store passe par l'explorateur, qui les connaît ;
/// un exécutable est lancé directement. Rend la main tout de suite, sans attendre la fermeture de l'application.
pub fn launch(found: &Found) -> Result<LaunchOutcome, AdapterError> {
    let mut command = match found.kind {
        Kind::Executable => Command::new(&found.path),
        Kind::Shortcut => {
            let mut command = Command::new("explorer.exe");
            command.arg(&found.path);
            command
        }
        Kind::AppsFolder => {
            let mut command = Command::new("explorer.exe");
            command.arg(format!("shell:AppsFolder\\{}", found.path.to_string_lossy()));
            command
        }
    };
    command.spawn().map_err(|error| AdapterError::LaunchFailed(format!("{} : {error}", found.name)))?;
    Ok(LaunchOutcome { display_name: found.name.clone() })
}

/// Trouve puis lance l'application demandée. Une application absente du PC : une erreur « non installée ».
pub fn open(requested: &str) -> Result<LaunchOutcome, AdapterError> {
    let found = find(requested).ok_or_else(|| AdapterError::NotInstalled(requested.trim().to_string()))?;
    launch(&found)
}

/// Application trouvée, pour l'affichage. Sans lancement.
pub fn describe(found: &Found) -> AppMatch {
    AppMatch { name: found.name.clone(), path: found.path.to_string_lossy().into_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcut(name: &str) -> Found {
        Found { name: name.to_string(), path: PathBuf::from(format!(r"C:\Menu\{name}.lnk")), kind: Kind::Shortcut }
    }

    fn executable(name: &str) -> Found {
        Found { name: name.to_string(), path: PathBuf::from(format!(r"C:\Apps\{name}.exe")), kind: Kind::Executable }
    }

    #[test]
    fn names_are_compared_without_case_accents_or_filler_words() {
        assert_eq!(name_words("Bloc-notes"), vec!["bloc", "notes"]);
        assert_eq!(name_words("le Bloc-notes.exe"), vec!["bloc", "notes"]);
        assert_eq!(name_words("Éditeur de Thème"), vec!["editeur", "theme"]);
    }

    #[test]
    fn an_exact_name_beats_a_name_that_only_contains_the_words() {
        let found = vec![shortcut("Microsoft Edge"), shortcut("Edge"), executable("msedge")];
        assert_eq!(best_match(&found, "edge").map(|entry| entry.name.as_str()), Some("Edge"));
        assert_eq!(best_match(&found, "le Microsoft Edge").map(|entry| entry.name.as_str()), Some("Microsoft Edge"));
    }

    #[test]
    fn a_shorter_name_wins_when_both_contain_the_words() {
        let found = vec![shortcut("Discord Canary"), shortcut("Discord")];
        assert_eq!(best_match(&found, "discord").map(|entry| entry.name.as_str()), Some("Discord"));
    }

    #[test]
    fn a_shortcut_is_preferred_over_the_same_app_from_the_apps_folder() {
        let apps_folder = Found { name: "Discord".into(), path: PathBuf::from("com.squirrel.Discord.Discord"), kind: Kind::AppsFolder };
        let found = vec![apps_folder, shortcut("Discord")];
        assert_eq!(best_match(&found, "discord").map(|entry| entry.kind), Some(Kind::Shortcut));
    }

    #[test]
    fn nothing_matches_an_unknown_name() {
        let found = vec![shortcut("Bloc-notes"), executable("calc")];
        assert!(best_match(&found, "logiciel-inconnu-zz").is_none());
        assert!(best_match(&found, "   ").is_none());
    }

    #[test]
    fn start_apps_output_gives_the_displayed_name_and_app_id() {
        let json = r#"[{"Name":"Calculatrice","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"},{"Name":"Discord","AppID":"com.squirrel.Discord.Discord"}]"#;
        let found = parse_start_apps(json);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].name, "Calculatrice");
        assert_eq!(found[0].path, PathBuf::from("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"));
        assert_eq!(found[0].kind, Kind::AppsFolder);
        assert_eq!(best_match(&found, "la calculatrice").map(|entry| entry.name.as_str()), Some("Calculatrice"));
    }

    #[test]
    fn a_single_start_app_and_empty_output_are_read_too() {
        let single = parse_start_apps(r#"{"Name":"Paint","AppID":"Microsoft.Paint_8wekyb3d8bbwe!App"}"#);
        assert_eq!(single.len(), 1);
        assert!(parse_start_apps("").is_empty());
        assert!(parse_start_apps("pas du json").is_empty());
    }

    #[test]
    fn app_paths_keys_give_the_executable_and_its_path() {
        let output = "\
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe
    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
    Path    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\readme.txt
    (Default)    REG_SZ    C:\\notes.txt
";
        let found = parse_app_paths(output);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "chrome");
        assert_eq!(found[0].path, PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"));
        assert_eq!(found[0].kind, Kind::Executable);
    }

    #[test]
    fn the_scan_finds_shortcuts_and_skips_uninstallers_on_disk() {
        let root = std::env::temp_dir().join(format!("nexus-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Accessoires")).unwrap();
        std::fs::write(root.join("Accessoires").join("Bloc-notes.lnk"), b"").unwrap();
        std::fs::write(root.join("Désinstaller Bloc-notes.lnk"), b"").unwrap();
        std::fs::write(root.join("notes.txt"), b"").unwrap();

        let mut found = Vec::new();
        walk(&root, Kind::Shortcut, MAX_DEPTH_SHORTCUTS, &mut found);
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Bloc-notes");
        assert_eq!(best_match(&found, "bloc notes").map(|entry| entry.name.as_str()), Some("Bloc-notes"));
    }

    #[test]
    fn an_app_missing_from_the_pc_is_reported_as_not_installed() {
        let error = open("logiciel-inconnu-zz-7431").unwrap_err();
        assert!(matches!(error, AdapterError::NotInstalled(ref name) if name == "logiciel-inconnu-zz-7431"));
    }
}
