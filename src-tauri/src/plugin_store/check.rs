//! Contrôle d'un dossier de plugin : fichiers, liens symboliques, tailles, contenu, et empreinte SHA-256.
//! L'empreinte couvre chaque fichier (chemin et contenu) : un fichier modifié après approbation change le résultat.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::manifest::{self, Manifest, NEXUS_VERSION};
use super::packs;
use super::sandbox::Sandbox;

const MAX_FILES: usize = 300;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRY_BYTES: u64 = 512 * 1024;
const MAX_MODULE_BYTES: u64 = 2 * 1024 * 1024;

/// Fichier du dossier : chemin relatif avec `/`, et chemin réel.
pub type FileEntry = (String, PathBuf);

/// Liste les fichiers du dossier. Refuse les liens symboliques, les dossiers trop volumineux et les fichiers spéciaux.
pub fn list_files(dir: &Path) -> Result<Vec<FileEntry>, String> {
    let mut files = Vec::new();
    let mut total = 0u64;
    // `.git` et `target` à la racine ne font pas partie du plugin : dépôt et sorties de compilation sont ignorés.
    let walk = WalkDir::new(dir).follow_links(false).sort_by_file_name().into_iter().filter_entry(|entry| {
        !(entry.depth() == 1 && matches!(entry.file_name().to_str(), Some(".git") | Some("target")))
    });
    for entry in walk {
        let entry = entry.map_err(|error| format!("dossier illisible : {error}"))?;
        let kind = entry.file_type();
        if kind.is_symlink() {
            return Err(format!("lien symbolique refusé : {}", entry.path().display()));
        }
        if kind.is_dir() {
            continue;
        }
        if !kind.is_file() {
            return Err(format!("fichier spécial refusé : {}", entry.path().display()));
        }
        let relative = entry.path().strip_prefix(dir).map_err(|_| "chemin hors du dossier".to_string())?;
        let rel = relative.to_string_lossy().replace('\\', "/");
        total += entry.metadata().map_err(|error| error.to_string())?.len();
        files.push((rel, entry.path().to_path_buf()));
        if files.len() > MAX_FILES {
            return Err(format!("trop de fichiers : {MAX_FILES} au maximum"));
        }
        if total > MAX_TOTAL_BYTES {
            return Err("dossier trop volumineux : 2 Mo au maximum".into());
        }
    }
    Ok(files)
}

/// Empreinte SHA-256 du contenu, fichier par fichier, dans l'ordre des chemins.
pub fn digest(files: &[FileEntry]) -> Result<String, String> {
    let mut sorted: Vec<&FileEntry> = files.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (rel, path) in sorted {
        let bytes = fs::read(path).map_err(|error| format!("lecture impossible de {rel} : {error}"))?;
        hasher.update((rel.len() as u64).to_be_bytes());
        hasher.update(rel.as_bytes());
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(&bytes);
    }
    Ok(format!("sha256:{}", hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>()))
}

fn read_limited(path: &Path, limit: u64, label: &str) -> Result<String, String> {
    let size = fs::metadata(path).map_err(|error| format!("{label} illisible : {error}"))?.len();
    if size > limit {
        return Err(format!("{label} trop volumineux ({size} octets)"));
    }
    fs::read_to_string(path).map_err(|error| format!("{label} illisible : {error}"))
}

/// Problèmes d'un dossier de plugin. Liste vide : le dossier peut être installé.
/// `known_apps` : identifiants du catalogue, pour valider les alias.
pub fn check_dir(dir: &Path, known_apps: &[&str], sandbox: &Sandbox) -> Vec<String> {
    let files = match list_files(dir) {
        Ok(files) => files,
        Err(problem) => return vec![problem],
    };
    let Some((_, manifest_path)) = files.iter().find(|(rel, _)| rel == manifest::MANIFEST_FILE) else {
        return vec![format!("{} absent à la racine du plugin", manifest::MANIFEST_FILE)];
    };
    let manifest: Manifest = match read_limited(manifest_path, MAX_MANIFEST_BYTES, manifest::MANIFEST_FILE).and_then(|text| manifest::parse(&text)) {
        Ok(manifest) => manifest,
        Err(problem) => return vec![problem],
    };
    let mut problems = manifest::problems(&manifest, NEXUS_VERSION);
    if !problems.is_empty() {
        return problems;
    }
    for (kind, file) in &manifest.entry_points {
        let Some((_, path)) = files.iter().find(|(rel, _)| rel == file) else {
            problems.push(format!("fichier « {file} » absent pour le type « {kind} »"));
            continue;
        };
        if kind == "action" {
            match fs::read(path) {
                Ok(bytes) if bytes.len() as u64 <= MAX_MODULE_BYTES => problems.extend(sandbox.check_module(&bytes)),
                Ok(_) => problems.push(format!("module « {file} » trop volumineux : 2 Mo au maximum")),
                Err(error) => problems.push(format!("module « {file} » illisible : {error}")),
            }
            continue;
        }
        let text = match read_limited(path, MAX_ENTRY_BYTES, file) {
            Ok(text) => text,
            Err(problem) => {
                problems.push(problem);
                continue;
            }
        };
        let content_problems = match kind.as_str() {
            "language" => packs::validate_language(&text).err(),
            "aliases" => packs::validate_aliases(&text, known_apps).err(),
            _ => Some(vec![format!("type « {kind} » sans lecteur")]),
        };
        problems.extend(content_problems.unwrap_or_default());
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> Sandbox {
        Sandbox::new().unwrap()
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexus-check-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const MANIFEST: &str = r#"{"schemaVersion":1,"id":"community.ana.verbes","name":"Verbes","version":"1.0.0","author":"Ana",
        "description":"Vocabulaire","engines":{"nexus":">=0.1.0 <1.0.0"},"kinds":["language"],
        "entryPoints":{"language":"language.json"},"permissions":[]}"#;

    #[test]
    fn a_complete_pack_passes_the_checks() {
        let dir = scratch("ok");
        write(&dir, "nexus.json", MANIFEST);
        write(&dir, "language.json", r#"{"locale":"fr","phrases":{"openVerbs":["ouvre"]}}"#);
        assert!(check_dir(&dir, &[], &sandbox()).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_entry_file_or_bad_content_is_reported() {
        let dir = scratch("missing");
        write(&dir, "nexus.json", MANIFEST);
        assert!(check_dir(&dir, &[], &sandbox()).iter().any(|p| p.contains("absent pour le type")));
        write(&dir, "language.json", r#"{"locale":"fr","phrases":{"openVerbs":["OUVRE"]}}"#);
        assert!(check_dir(&dir, &[], &sandbox()).iter().any(|p| p.contains("refusée")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_digest_changes_when_any_byte_changes_and_ignores_nothing() {
        let dir = scratch("digest");
        write(&dir, "nexus.json", MANIFEST);
        write(&dir, "language.json", r#"{"locale":"fr","phrases":{"openVerbs":["ouvre"]}}"#);
        let first = digest(&list_files(&dir).unwrap()).unwrap();
        assert_eq!(first, digest(&list_files(&dir).unwrap()).unwrap(), "empreinte stable");
        write(&dir, "language.json", r#"{"locale":"fr","phrases":{"openVerbs":["lance"]}}"#);
        assert_ne!(first, digest(&list_files(&dir).unwrap()).unwrap());
        write(&dir, "extra.txt", "ajout");
        assert!(first.starts_with("sha256:") && first.len() == "sha256:".len() + 64);
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_refused() {
        let dir = scratch("link");
        write(&dir, "nexus.json", MANIFEST);
        std::os::unix::fs::symlink("/etc/hostname", dir.join("language.json")).unwrap();
        assert!(list_files(&dir).unwrap_err().contains("lien symbolique"));
        let _ = fs::remove_dir_all(dir);
    }
}
