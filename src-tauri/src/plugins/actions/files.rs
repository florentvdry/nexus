//! Recherche et opérations sur les fichiers, limitées aux dossiers utilisateur.
//!
//! Chaque opération suit trois étapes : `plan` vérifie les chemins et produit un aperçu, la confirmation est
//! demandée par l'appelant (voir `permissions`), puis `apply` exécute. Les suppressions vont à la corbeille.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::error::AdapterError;

pub const MAX_RESULTS: usize = 200;
const MAX_DEPTH: usize = 6;
const MAX_SCANNED: usize = 50_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub name_contains: Option<String>,
    pub extension: Option<String>,
    pub modified_within_days: Option<u64>,
    /// Dossier précis, qui doit se trouver dans un emplacement autorisé.
    pub folder: Option<String>,
    /// Dossier désigné par son nom : `downloads`, `documents`, `desktop` ou `pictures`.
    pub folder_hint: Option<String>,
}

/// Résout un nom de dossier connu vers son emplacement réel, s'il existe.
pub fn hinted_folder(hint: &str) -> Option<PathBuf> {
    let folder = match folder_alias(hint)? {
        "downloads" => dirs::download_dir(),
        "documents" => dirs::document_dir(),
        "desktop" => dirs::desktop_dir(),
        "pictures" => dirs::picture_dir(),
        _ => None,
    };
    folder.filter(|path| path.is_dir())
}

/// Nom canonique d'un dossier, en anglais ou en français (sans accents, sans casse) : « bureau » vaut `desktop`.
pub fn folder_alias(hint: &str) -> Option<&'static str> {
    let normalized: String = hint
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'é' | 'è' | 'ê' => 'e',
            'à' | 'â' => 'a',
            'ô' => 'o',
            'û' | 'ù' => 'u',
            'ï' | 'î' => 'i',
            other => other,
        })
        .collect();
    match normalized.as_str() {
        "downloads" | "telechargements" | "telechargement" => Some("downloads"),
        "documents" | "document" => Some("documents"),
        "desktop" | "bureau" => Some("desktop"),
        "pictures" | "images" | "image" | "photos" => Some("pictures"),
        _ => None,
    }
}

/// Dossiers utilisateur autorisés : Documents, Téléchargements, Bureau, Images, quand ils existent.
///
/// Le dossier personnel lui-même n'est jamais une racine : sans configuration XDG, la bibliothèque `dirs`
/// renvoie ce dossier pour Documents, ce qui donnerait accès à toute la session. Aucun repli n'est prévu :
/// sans dossier utilisateur, aucune recherche ni opération n'est possible.
pub fn allowed_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok()) else {
        return Vec::new();
    };
    let candidates = [dirs::document_dir(), dirs::download_dir(), dirs::desktop_dir(), dirs::picture_dir()]
        .into_iter()
        .flatten()
        .chain(["Documents", "Downloads", "Desktop", "Pictures"].into_iter().map(|name| home.join(name)));

    let mut roots: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if let Ok(real) = candidate.canonicalize() {
            if real != home && real.is_dir() && !roots.contains(&real) {
                roots.push(real);
            }
        }
    }
    roots
}

/// Vrai si le chemin réel (liens symboliques résolus) se trouve dans un des emplacements autorisés.
/// Pour un chemin qui n'existe pas encore, c'est son dossier parent qui est vérifié.
pub fn within(path: &Path, roots: &[PathBuf]) -> bool {
    let real = path
        .canonicalize()
        .or_else(|_| path.parent().ok_or(std::io::ErrorKind::NotFound.into()).and_then(|parent| parent.canonicalize()));
    let Ok(real) = real else { return false };
    roots.iter().filter_map(|root| root.canonicalize().ok()).any(|root| real.starts_with(root))
}

fn require_within(path: &Path, roots: &[PathBuf]) -> Result<(), AdapterError> {
    if within(path, roots) {
        Ok(())
    } else {
        Err(AdapterError::OutsideAllowedFolders(path.display().to_string()))
    }
}

fn unix_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn search(roots: &[PathBuf], query: &SearchQuery) -> Result<Vec<FileEntry>, AdapterError> {
    let hinted = match &query.folder_hint {
        Some(hint) => Some(hinted_folder(hint).ok_or_else(|| AdapterError::InvalidPath(hint.clone()))?),
        None => None,
    };
    let scope: Vec<PathBuf> = match (hinted, &query.folder) {
        (Some(folder), _) => {
            require_within(&folder, roots)?;
            vec![folder]
        }
        (None, Some(folder)) => {
            let folder = PathBuf::from(folder);
            if !folder.is_absolute() || !folder.is_dir() {
                return Err(AdapterError::InvalidPath(folder.display().to_string()));
            }
            require_within(&folder, roots)?;
            vec![folder]
        }
        (None, None) => roots.to_vec(),
    };

    let name = query.name_contains.as_ref().map(|value| value.to_lowercase());
    let extension = query.extension.as_ref().map(|value| value.trim_start_matches('.').to_lowercase());
    let cutoff = query.modified_within_days.map(|days| {
        let now = unix_seconds(SystemTime::now());
        now.saturating_sub(days * 86_400)
    });

    let mut results = Vec::new();
    for root in scope.iter().filter(|root| root.is_dir()) {
        for entry in WalkDir::new(root).max_depth(MAX_DEPTH).follow_links(false).into_iter().take(MAX_SCANNED).filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if let Some(name) = &name {
                if !file_name.to_lowercase().contains(name) {
                    continue;
                }
            }
            if let Some(extension) = &extension {
                let matches = Path::new(&file_name).extension().map(|ext| ext.to_string_lossy().to_lowercase() == *extension).unwrap_or(false);
                if !matches {
                    continue;
                }
            }
            let Ok(metadata) = entry.metadata() else { continue };
            let modified = metadata.modified().map(unix_seconds).unwrap_or(0);
            if cutoff.is_some_and(|cutoff| modified < cutoff) {
                continue;
            }
            results.push(FileEntry {
                path: entry.path().display().to_string(),
                name: file_name,
                size: metadata.len(),
                modified,
            });
            if results.len() >= MAX_RESULTS {
                break;
            }
        }
    }
    results.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.path.cmp(&b.path)));
    Ok(results)
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Operation {
    Rename { from: String, new_name: String },
    Move { from: String, to_dir: String },
    Copy { from: String, to_dir: String },
    Trash { path: String },
}

impl Operation {
    pub fn is_deletion(&self) -> bool {
        matches!(self, Operation::Trash { .. })
    }
}

/// Aperçu d'une opération : ce qui sera fait, avec les chemins exacts. Rien n'est modifié à cette étape.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub operation: Operation,
    pub rows: Vec<(String, String)>,
    source: PathBuf,
    /// Cible réelle de la source au moment de l'aperçu : toute substitution d'ici l'exécution est détectée.
    source_real: PathBuf,
    target: Option<PathBuf>,
}

fn valid_file_name(name: &str) -> bool {
    !name.trim().is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

fn absolute_existing(raw: &str) -> Result<PathBuf, AdapterError> {
    let path = PathBuf::from(raw.trim().trim_matches('"'));
    if !path.is_absolute() || !path.exists() {
        return Err(AdapterError::InvalidPath(raw.to_string()));
    }
    Ok(path)
}

pub fn plan(operation: Operation, roots: &[PathBuf]) -> Result<Plan, AdapterError> {
    match &operation {
        Operation::Rename { from, new_name } => {
            let source = absolute_existing(from)?;
            require_within(&source, roots)?;
            if !valid_file_name(new_name) {
                return Err(AdapterError::InvalidPath(new_name.clone()));
            }
            let target = source.parent().ok_or_else(|| AdapterError::InvalidPath(from.clone()))?.join(new_name.trim());
            ensure_free(&target, roots)?;
            two_paths(operation, source, target)
        }
        Operation::Move { from, to_dir } | Operation::Copy { from, to_dir } => {
            let source = absolute_existing(from)?;
            require_within(&source, roots)?;
            let directory = absolute_existing(to_dir)?;
            if !directory.is_dir() {
                return Err(AdapterError::InvalidPath(to_dir.clone()));
            }
            require_within(&directory, roots)?;
            let name = source.file_name().ok_or_else(|| AdapterError::InvalidPath(from.clone()))?;
            let target = directory.join(name);
            ensure_free(&target, roots)?;
            if matches!(operation, Operation::Copy { .. }) && !source.is_file() {
                return Err(AdapterError::Operation("seuls les fichiers peuvent être copiés".into()));
            }
            two_paths(operation, source, target)
        }
        Operation::Trash { path } => {
            let source = absolute_existing(path)?;
            require_within(&source, roots)?;
            let source_real = real_path(&source)?;
            Ok(Plan {
                rows: vec![("path".into(), source.display().to_string())],
                operation,
                source,
                source_real,
                target: None,
            })
        }
    }
}

fn two_paths(operation: Operation, source: PathBuf, target: PathBuf) -> Result<Plan, AdapterError> {
    Ok(Plan {
        rows: vec![("from".into(), source.display().to_string()), ("to".into(), target.display().to_string())],
        operation,
        source_real: real_path(&source)?,
        source,
        target: Some(target),
    })
}

/// Chemin réel (liens et jonctions résolus) de ce qui existe.
fn real_path(path: &Path) -> Result<PathBuf, AdapterError> {
    path.canonicalize().map_err(|error| AdapterError::InvalidPath(format!("{} ({error})", path.display())))
}

fn ensure_free(target: &Path, roots: &[PathBuf]) -> Result<(), AdapterError> {
    require_within(target, roots)?;
    if target.exists() {
        return Err(AdapterError::Operation(format!("un élément existe déjà : {}", target.display())));
    }
    Ok(())
}

/// Revalide un plan juste avant son exécution : la confirmation peut prendre du temps, pendant lequel les fichiers
/// peuvent changer. Refusé si la source n'est plus la même cible, si elle ou sa destination sort des emplacements
/// autorisés, ou si la cible existe désormais (une écriture ne doit jamais écraser un fichier apparu entre-temps).
fn revalidate(plan: &Plan, roots: &[PathBuf]) -> Result<(), AdapterError> {
    require_within(&plan.source, roots)?;
    if real_path(&plan.source)? != plan.source_real {
        return Err(AdapterError::Operation("la source a changé depuis l'aperçu : rien n'a été fait".into()));
    }
    if let Some(target) = &plan.target {
        require_within(target, roots)?;
        if target.exists() {
            return Err(AdapterError::Operation(format!("un élément existe déjà : {}", target.display())));
        }
    }
    Ok(())
}

/// Exécute un plan déjà confirmé, après l'avoir revalidé. Renvoie le chemin final, ou le chemin supprimé.
pub fn apply(plan: &Plan, roots: &[PathBuf]) -> Result<String, AdapterError> {
    revalidate(plan, roots)?;
    let io = |error: std::io::Error| AdapterError::Operation(error.to_string());
    match (&plan.operation, &plan.target) {
        (Operation::Rename { .. } | Operation::Move { .. }, Some(target)) => {
            fs::rename(&plan.source, target).map_err(|error| {
                if error.raw_os_error().is_some() && plan.source.is_dir() {
                    AdapterError::Operation("déplacement de dossier entre volumes non pris en charge".into())
                } else {
                    io(error)
                }
            })?;
            Ok(target.display().to_string())
        }
        (Operation::Copy { .. }, Some(target)) => {
            fs::copy(&plan.source, target).map_err(io)?;
            Ok(target.display().to_string())
        }
        (Operation::Trash { .. }, None) => {
            trash::delete(&plan.source).map_err(|error| AdapterError::Operation(error.to_string()))?;
            Ok(plan.source.display().to_string())
        }
        _ => Err(AdapterError::Operation("plan incohérent".into())),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn french_folder_names_resolve_to_the_same_folders() {
        assert_eq!(folder_alias("bureau"), Some("desktop"));
        assert_eq!(folder_alias("Téléchargements"), Some("downloads"));
        assert_eq!(folder_alias("Images"), Some("pictures"));
        assert_eq!(folder_alias("dans le jardin"), None);
    }

    /// Test sur le vrai bureau : envoie un fichier temporaire à la corbeille. Il y reste ensuite, à vider à la main.
    /// `cargo test -- --ignored live_` sur Windows.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_trash_moves_a_temporary_file_to_the_recycle_bin() {
        let path = std::env::temp_dir().join(format!("nexus-corbeille-{}.txt", std::process::id()));
        std::fs::write(&path, "test NEXUS").expect("fichier temporaire");
        trash::delete(&path).expect("envoi à la corbeille");
        assert!(!path.exists(), "le fichier est toujours à son emplacement");
    }

    use super::*;

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("nexus-files-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join("sub")).unwrap();
            fs::write(dir.join("facture.pdf"), b"%PDF-1.4 test").unwrap();
            fs::write(dir.join("notes.txt"), b"bonjour").unwrap();
            fs::write(dir.join("sub").join("contrat.pdf"), b"%PDF").unwrap();
            Sandbox(dir)
        }
        fn path(&self) -> PathBuf {
            self.0.clone()
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn search_filters_by_extension_recursively_and_sorts() {
        let sandbox = Sandbox::new("search");
        let roots = vec![sandbox.path()];
        let found = search(&roots, &SearchQuery { extension: Some("PDF".into()), ..Default::default() }).unwrap();
        let names: Vec<&str> = found.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"facture.pdf") && names.contains(&"contrat.pdf"));
        assert!(!names.contains(&"notes.txt"));
    }

    #[test]
    fn search_refuses_a_folder_outside_the_allowed_roots() {
        let sandbox = Sandbox::new("scope");
        let other = std::env::temp_dir();
        let roots = vec![sandbox.path()];
        let error = search(&roots, &SearchQuery { folder: Some(other.display().to_string()), ..Default::default() }).unwrap_err();
        assert!(matches!(error, AdapterError::OutsideAllowedFolders(_)));
    }

    #[test]
    fn rename_is_planned_then_applied_inside_the_roots() {
        let sandbox = Sandbox::new("rename");
        let roots = vec![sandbox.path()];
        let from = sandbox.path().join("notes.txt").display().to_string();
        let plan = plan(Operation::Rename { from: from.clone(), new_name: "idees.txt".into() }, &roots).unwrap();
        assert!(plan.rows.iter().any(|(key, value)| key == "to" && value.ends_with("idees.txt")));
        assert!(sandbox.path().join("notes.txt").exists(), "le plan ne modifie rien");
        apply(&plan, &roots).unwrap();
        assert!(sandbox.path().join("idees.txt").exists());
        assert!(!sandbox.path().join("notes.txt").exists());
    }

    #[test]
    fn move_and_copy_refuse_conflicts_and_invalid_names() {
        let sandbox = Sandbox::new("conflicts");
        let roots = vec![sandbox.path()];
        let facture = sandbox.path().join("facture.pdf").display().to_string();
        let sub = sandbox.path().join("sub").display().to_string();
        fs::write(sandbox.path().join("sub").join("facture.pdf"), b"deja la").unwrap();
        assert!(matches!(plan(Operation::Move { from: facture.clone(), to_dir: sub.clone() }, &roots), Err(AdapterError::Operation(_))));
        assert!(matches!(plan(Operation::Rename { from: facture, new_name: "../evil.pdf".into() }, &roots), Err(AdapterError::InvalidPath(_))));
    }

    #[test]
    fn nothing_outside_the_roots_can_be_touched() {
        let sandbox = Sandbox::new("outside");
        let roots = vec![sandbox.path()];
        let outside = std::env::temp_dir().join(format!("nexus-outside-{}.txt", std::process::id()));
        fs::write(&outside, b"hors zone").unwrap();
        let result = plan(Operation::Trash { path: outside.display().to_string() }, &roots);
        let _ = fs::remove_file(&outside);
        assert!(matches!(result, Err(AdapterError::OutsideAllowedFolders(_))));
    }

    #[test]
    fn a_target_that_appears_after_the_preview_is_never_overwritten() {
        let sandbox = Sandbox::new("race-target");
        let roots = vec![sandbox.path()];
        let from = sandbox.path().join("notes.txt").display().to_string();
        let plan = plan(Operation::Rename { from, new_name: "idees.txt".into() }, &roots).unwrap();
        fs::write(sandbox.path().join("idees.txt"), b"apparu pendant la confirmation").unwrap();
        assert!(apply(&plan, &roots).is_err());
        assert_eq!(fs::read(sandbox.path().join("idees.txt")).unwrap(), b"apparu pendant la confirmation");
        assert!(sandbox.path().join("notes.txt").exists(), "la source doit rester en place");
    }

    #[test]
    fn a_source_that_is_replaced_after_the_preview_is_refused() {
        let sandbox = Sandbox::new("race-source");
        let roots = vec![sandbox.path()];
        let from = sandbox.path().join("notes.txt").display().to_string();
        let plan = plan(Operation::Copy { from, to_dir: sandbox.path().join("sub").display().to_string() }, &roots).unwrap();
        // La source est remplacée par un dossier entre l'aperçu et l'exécution : la copie ne doit pas partir.
        fs::remove_file(sandbox.path().join("notes.txt")).unwrap();
        fs::create_dir(sandbox.path().join("notes.txt")).unwrap();
        assert!(apply(&plan, &roots).is_err());
        assert!(!sandbox.path().join("sub").join("notes.txt").exists());
    }

    #[test]
    fn an_operation_is_refused_when_its_folders_are_no_longer_allowed() {
        let sandbox = Sandbox::new("scope-change");
        let roots = vec![sandbox.path()];
        let plan = plan(Operation::Rename { from: sandbox.path().join("notes.txt").display().to_string(), new_name: "x.txt".into() }, &roots).unwrap();
        assert!(matches!(apply(&plan, &[]), Err(AdapterError::OutsideAllowedFolders(_))));
        assert!(sandbox.path().join("notes.txt").exists());
    }

    #[test]
    fn the_home_directory_itself_is_never_an_allowed_root() {
        let home = dirs::home_dir().and_then(|home| home.canonicalize().ok());
        let roots = allowed_roots();
        assert!(home.map(|home| !roots.contains(&home)).unwrap_or(true));
    }

    #[test]
    fn relative_paths_are_refused() {
        let roots = vec![std::env::temp_dir()];
        assert!(matches!(plan(Operation::Trash { path: "notes.txt".into() }, &roots), Err(AdapterError::InvalidPath(_))));
    }
}
