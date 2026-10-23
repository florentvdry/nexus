//! Installation des plugins : préparation dans un dossier de transit, installation après accord, lecture de l'état,
//! suppression. Rien n'est exécuté : un plugin de données n'est que lu.
//!
//! Disposition sous `<données>/plugins/` :
//! - `<identifiant>/`        : plugins installés ;
//! - `plugins.lock.json`     : commit, empreinte et date d'approbation de chaque plugin ;
//! - `.staging/<id>/`        : plugin préparé, en attente d'approbation ;
//! - `.staging/<id>.json`    : source et commit du plugin préparé.

use std::collections::BTreeMap;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::check::{self, digest, list_files};
use super::index::valid_git_url;
use super::manifest::{self, Manifest};
use super::packs::{self, AliasesPack, LanguagePack};
use crate::error::AdapterError;

const LOCK_FILE: &str = "plugins.lock.json";
const STAGING_DIR: &str = ".staging";
const GIT_TIMEOUT: Duration = Duration::from_secs(120);

/// Plugin préparé : examiné, prêt à être installé après accord de l'utilisateur.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub staging_id: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub kinds: Vec<String>,
    pub source: String,
    pub commit: Option<String>,
    pub digest: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Installé, empreinte conforme, manifeste valide.
    Active,
    /// Le contenu a changé depuis l'approbation : désactivé jusqu'à une nouvelle installation.
    Modified,
    /// Le manifeste ou un fichier ne passe plus les contrôles (p. ex. version de Nexus incompatible).
    Invalid,
    /// Le dossier du plugin a disparu.
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub commit: Option<String>,
    pub digest: String,
    pub state: State,
    pub problems: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lock {
    #[serde(default)]
    pub plugins: BTreeMap<String, LockEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockEntry {
    pub version: String,
    pub source: String,
    pub commit: Option<String>,
    pub digest: String,
    pub approved_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StagingSource {
    source: String,
    commit: Option<String>,
}

/// Données d'un paquet actif, prêtes pour le moteur de compréhension.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackData {
    pub id: String,
    pub name: String,
    pub version: String,
    pub language: Option<LanguagePack>,
    pub aliases: Option<AliasesPack>,
}

pub struct Store {
    root: PathBuf,
    known_apps: Vec<&'static str>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Compteur de préparations : deux plugins préparés en même temps reçoivent des identifiants distincts.
static PREPARATIONS: AtomicU64 = AtomicU64::new(0);

fn staging_id_valid(id: &str) -> bool {
    id.strip_prefix("stage-").map(|rest| rest.split('-').count() == 2 && rest.split('-').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))).unwrap_or(false)
}

fn problem(message: impl Into<String>) -> AdapterError {
    AdapterError::PluginInvalid(message.into())
}

impl Store {
    pub fn new(root: PathBuf, known_apps: Vec<&'static str>) -> Store {
        Store { root, known_apps }
    }

    fn lock_path(&self) -> PathBuf {
        self.root.join(LOCK_FILE)
    }

    fn staging_dir(&self, staging_id: &str) -> PathBuf {
        self.root.join(STAGING_DIR).join(staging_id)
    }

    fn staging_meta(&self, staging_id: &str) -> PathBuf {
        self.root.join(STAGING_DIR).join(format!("{staging_id}.json"))
    }

    fn new_staging_id(&self) -> String {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
        format!("stage-{}-{}", nanos % 1_000_000_000_000, PREPARATIONS.fetch_add(1, Ordering::Relaxed))
    }

    pub fn read_lock(&self) -> Result<Lock, AdapterError> {
        match fs::read_to_string(self.lock_path()) {
            Ok(text) => serde_json::from_str(&text).map_err(|error| problem(format!("{LOCK_FILE} illisible : {error}"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Lock::default()),
            Err(error) => Err(AdapterError::Operation(format!("{LOCK_FILE} : {error}"))),
        }
    }

    fn write_lock(&self, lock: &Lock) -> Result<(), AdapterError> {
        fs::create_dir_all(&self.root).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let text = serde_json::to_string_pretty(lock).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let temporary = self.root.join(format!("{LOCK_FILE}.tmp"));
        fs::write(&temporary, text).map_err(|error| AdapterError::Operation(error.to_string()))?;
        fs::rename(&temporary, self.lock_path()).map_err(|error| AdapterError::Operation(error.to_string()))
    }

    /// Prépare un plugin depuis un dossier local (copie contrôlée).
    pub fn prepare_folder(&self, source: &Path) -> Result<Prepared, AdapterError> {
        if !source.is_absolute() || !source.is_dir() {
            return Err(AdapterError::InvalidPath(source.display().to_string()));
        }
        let staging_id = self.new_staging_id();
        let target = self.staging_dir(&staging_id);
        fs::create_dir_all(&target).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let copied = list_files(source).and_then(|files| {
            for (rel, path) in files {
                let destination = target.join(&rel);
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::copy(&path, &destination).map_err(|error| error.to_string())?;
            }
            Ok(())
        });
        if let Err(error) = copied {
            let _ = fs::remove_dir_all(&target);
            return Err(problem(error));
        }
        self.finish_prepare(&staging_id, &source.display().to_string(), None)
    }

    /// Prépare un plugin depuis un dépôt Git HTTPS. Le dépôt est cloné sans exécuter aucun script.
    pub fn prepare_git(&self, url: &str) -> Result<Prepared, AdapterError> {
        if !valid_git_url(url) {
            return Err(AdapterError::InvalidTarget(url.to_string()));
        }
        let staging_id = self.new_staging_id();
        let target = self.staging_dir(&staging_id);
        fs::create_dir_all(self.root.join(STAGING_DIR)).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let outcome = clone_repository(url, &target).and_then(|commit| {
            let _ = fs::remove_dir_all(target.join(".git"));
            self.finish_prepare(&staging_id, url, Some(commit))
        });
        if outcome.is_err() {
            let _ = fs::remove_dir_all(&target);
        }
        outcome
    }

    fn finish_prepare(&self, staging_id: &str, source: &str, commit: Option<String>) -> Result<Prepared, AdapterError> {
        let target = self.staging_dir(staging_id);
        let problems = check::check_dir(&target, &self.known_apps);
        if !problems.is_empty() {
            let _ = fs::remove_dir_all(&target);
            return Err(problem(problems.join(" ; ")));
        }
        let manifest = read_manifest(&target)?;
        let files = list_files(&target).map_err(problem)?;
        let digest = digest(&files).map_err(problem)?;
        let meta = StagingSource { source: source.to_string(), commit: commit.clone() };
        let text = serde_json::to_string(&meta).map_err(|error| AdapterError::Operation(error.to_string()))?;
        fs::write(self.staging_meta(staging_id), text).map_err(|error| AdapterError::Operation(error.to_string()))?;
        Ok(summary(staging_id, &manifest, source, commit, digest))
    }

    /// Relit un plugin préparé et vérifie qu'il est toujours valide.
    pub fn staged(&self, staging_id: &str) -> Result<Prepared, AdapterError> {
        if !staging_id_valid(staging_id) {
            return Err(AdapterError::InvalidTarget(staging_id.to_string()));
        }
        let target = self.staging_dir(staging_id);
        let problems = check::check_dir(&target, &self.known_apps);
        if !problems.is_empty() {
            return Err(problem(problems.join(" ; ")));
        }
        let manifest = read_manifest(&target)?;
        let meta: StagingSource = serde_json::from_str(
            &fs::read_to_string(self.staging_meta(staging_id)).map_err(|_| AdapterError::InvalidTarget(staging_id.to_string()))?,
        )
        .map_err(|error| problem(error.to_string()))?;
        let digest = digest(&list_files(&target).map_err(problem)?).map_err(problem)?;
        Ok(summary(staging_id, &manifest, &meta.source, meta.commit, digest))
    }

    /// Installe le plugin préparé, à condition que son contenu soit exactement celui que l'utilisateur a approuvé.
    pub fn install(&self, staging_id: &str, approved_digest: &str) -> Result<Installed, AdapterError> {
        let prepared = self.staged(staging_id)?;
        if prepared.digest != approved_digest {
            return Err(problem("le contenu du plugin a changé depuis la validation : relance l'installation"));
        }
        let target = self.root.join(&prepared.id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| AdapterError::Operation(error.to_string()))?;
        }
        fs::create_dir_all(&self.root).map_err(|error| AdapterError::Operation(error.to_string()))?;
        fs::rename(self.staging_dir(staging_id), &target).map_err(|error| AdapterError::Operation(error.to_string()))?;
        let _ = fs::remove_file(self.staging_meta(staging_id));

        let mut lock = self.read_lock()?;
        lock.plugins.insert(
            prepared.id.clone(),
            LockEntry {
                version: prepared.version.clone(),
                source: prepared.source.clone(),
                commit: prepared.commit.clone(),
                digest: prepared.digest.clone(),
                approved_at: now_secs(),
            },
        );
        self.write_lock(&lock)?;
        self.installed_status(&prepared.id)
    }

    /// Supprime un plugin installé. Refuse les identifiants qui ne sont pas dans le lock.
    pub fn remove(&self, id: &str) -> Result<(), AdapterError> {
        if !manifest::valid_id(id) {
            return Err(AdapterError::InvalidTarget(id.to_string()));
        }
        let mut lock = self.read_lock()?;
        if lock.plugins.remove(id).is_none() {
            return Err(AdapterError::InvalidTarget(id.to_string()));
        }
        let target = self.root.join(id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| AdapterError::Operation(error.to_string()))?;
        }
        self.write_lock(&lock)
    }

    /// Tous les plugins du lock, avec leur état vérifié.
    pub fn list(&self) -> Result<Vec<Installed>, AdapterError> {
        let lock = self.read_lock()?;
        Ok(lock.plugins.iter().map(|(id, entry)| self.status_of(id, entry)).collect())
    }

    fn installed_status(&self, id: &str) -> Result<Installed, AdapterError> {
        let lock = self.read_lock()?;
        let entry = lock.plugins.get(id).ok_or_else(|| AdapterError::InvalidTarget(id.to_string()))?;
        Ok(self.status_of(id, entry))
    }

    fn status_of(&self, id: &str, entry: &LockEntry) -> Installed {
        let dir = self.root.join(id);
        let base = |name: String, state: State, problems: Vec<String>| Installed {
            id: id.to_string(),
            name,
            version: entry.version.clone(),
            source: entry.source.clone(),
            commit: entry.commit.clone(),
            digest: entry.digest.clone(),
            state,
            problems,
        };
        if !dir.is_dir() {
            return base(id.to_string(), State::Missing, vec!["dossier du plugin introuvable".into()]);
        }
        let name = read_manifest(&dir).map(|m| m.name).unwrap_or_else(|_| id.to_string());
        let current = match list_files(&dir).and_then(|files| digest(&files)) {
            Ok(current) => current,
            Err(error) => return base(name, State::Invalid, vec![error]),
        };
        if current != entry.digest {
            return base(name, State::Modified, vec!["le contenu a changé depuis l'approbation".into()]);
        }
        let problems = check::check_dir(&dir, &self.known_apps);
        if problems.is_empty() {
            base(name, State::Active, vec![])
        } else {
            base(name, State::Invalid, problems)
        }
    }

    /// Données des paquets actifs. Un paquet modifié ou invalide n'est jamais chargé.
    pub fn packs(&self) -> Result<Vec<PackData>, AdapterError> {
        let mut packs = Vec::new();
        for installed in self.list()? {
            if installed.state != State::Active {
                continue;
            }
            let dir = self.root.join(&installed.id);
            let manifest = read_manifest(&dir)?;
            let mut pack = PackData { id: installed.id.clone(), name: manifest.name.clone(), version: manifest.version.clone(), language: None, aliases: None };
            for (kind, file) in &manifest.entry_points {
                let text = fs::read_to_string(dir.join(file)).map_err(|error| AdapterError::Operation(error.to_string()))?;
                match kind.as_str() {
                    "language" => pack.language = packs::validate_language(&text).ok(),
                    "aliases" => pack.aliases = packs::validate_aliases(&text, &self.known_apps).ok(),
                    _ => {}
                }
            }
            packs.push(pack);
        }
        Ok(packs)
    }
}

fn read_manifest(dir: &Path) -> Result<Manifest, AdapterError> {
    let text = fs::read_to_string(dir.join(manifest::MANIFEST_FILE)).map_err(|error| problem(error.to_string()))?;
    manifest::parse(&text).map_err(problem)
}

fn summary(staging_id: &str, manifest: &Manifest, source: &str, commit: Option<String>, digest: String) -> Prepared {
    Prepared {
        staging_id: staging_id.to_string(),
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        kinds: manifest.kinds.clone(),
        source: source.to_string(),
        commit,
        digest,
    }
}

/// Clone superficiel dans `target`, sans invite de mot de passe, avec délai. Renvoie le commit obtenu.
pub(crate) fn clone_repository(url: &str, target: &Path) -> Result<String, AdapterError> {
    let mut child = Command::new("git")
        .args(["clone", "--depth", "1", "--quiet", "--"])
        .arg(url)
        .arg(target)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| AdapterError::Operation("git introuvable : installe Git pour installer un plugin depuis une adresse".into()))?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|error| AdapterError::Operation(error.to_string()))? {
            Some(status) if status.success() => break,
            Some(_) => return Err(AdapterError::Operation("le dépôt n'a pas pu être cloné".into())),
            None if started.elapsed() > GIT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AdapterError::Operation("délai dépassé pendant le clonage".into()));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(target)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|error| AdapterError::Operation(error.to_string()))?;
    let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if commit.len() != 40 || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AdapterError::Operation("commit introuvable après le clonage".into()));
    }
    Ok(commit)
}

