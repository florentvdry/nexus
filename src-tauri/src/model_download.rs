//! Téléchargement d'un modèle de langage local (TODO §1) : HTTPS seulement, somme SHA-256 vérifiée avant tout usage,
//! reprise d'un téléchargement interrompu, espace disque vérifié avant de commencer.
//!
//! Le fichier arrive dans `<nom>.part` ; il ne prend son nom définitif qu'après vérification. Une somme fausse
//! supprime le fichier partiel : un modèle non vérifié n'est jamais utilisé.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use sysinfo::Disks;

use crate::error::AdapterError;

/// Marge gardée libre sur le disque, en plus de la taille du modèle.
const DISK_MARGIN_BYTES: u64 = 512 * 1024 * 1024;
const CHUNK_BYTES: usize = 64 * 1024;
const MAX_REDIRECTS: u32 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPlan {
    /// Adresse HTTPS du fichier. Toute autre adresse est refusée.
    pub url: String,
    /// Nom du fichier une fois vérifié. Ne doit contenir aucun séparateur de dossier.
    pub file_name: String,
    /// Somme SHA-256 attendue, en hexadécimal minuscule (64 caractères).
    pub sha256: String,
    /// Taille attendue, en octets, pour contrôler l'espace disque avant de commencer.
    pub size_bytes: u64,
}

/// Contrôle la forme du plan avant toute connexion. Une erreur ici ne touche ni au réseau ni au disque.
pub fn validate_plan(plan: &DownloadPlan) -> Result<(), AdapterError> {
    if !plan.url.starts_with("https://") {
        return Err(AdapterError::InvalidTarget("le modèle doit être téléchargé depuis une adresse HTTPS".into()));
    }
    let name = plan.file_name.as_str();
    if name.is_empty() || name.starts_with('.') || name.contains('/') || name.contains('\\') {
        return Err(AdapterError::InvalidTarget("nom de fichier de modèle invalide".into()));
    }
    let hash = plan.sha256.as_str();
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
        return Err(AdapterError::InvalidTarget("somme SHA-256 attendue invalide".into()));
    }
    if plan.size_bytes == 0 {
        return Err(AdapterError::InvalidTarget("taille de modèle nulle".into()));
    }
    Ok(())
}

/// Vérifie qu'il reste assez de place sur le disque qui porte `dir`, marge comprise.
pub fn ensure_disk_space(dir: &Path, needed_bytes: u64) -> Result<(), AdapterError> {
    let disks = Disks::new_with_refreshed_list();
    // Le disque dont le point de montage est le plus long préfixe du dossier est celui qui le porte.
    let disk = disks
        .list()
        .iter()
        .filter(|disk| dir.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .ok_or_else(|| AdapterError::Operation("disque du dossier du modèle introuvable".into()))?;

    let required = needed_bytes.saturating_add(DISK_MARGIN_BYTES);
    if disk.available_space() < required {
        return Err(AdapterError::Operation(format!(
            "espace insuffisant : {} Mo libres, {} Mo nécessaires",
            disk.available_space() / (1024 * 1024),
            required / (1024 * 1024),
        )));
    }
    Ok(())
}

/// Agent HTTP du téléchargement : pas de délai global (un modèle pèse plusieurs Go), redirections limitées
/// (les hébergeurs de modèles redirigent vers un CDN), statuts HTTP lus par le code et non par la bibliothèque.
pub fn agent() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .max_redirects(MAX_REDIRECTS)
            .http_status_as_error(false)
            .user_agent("NEXUS-model/0.1")
            .build(),
    )
}

/// Somme SHA-256 d'un fichier, en hexadécimal minuscule.
pub fn hash_file(path: &Path) -> Result<String, AdapterError> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Télécharge le modèle, avec reprise, puis vérifie sa somme. Renvoie le chemin définitif.
///
/// `progress(reçu, attendu)` est appelé à chaque bloc. Une somme fausse supprime le fichier partiel.
pub fn download(
    plan: &DownloadPlan,
    dir: &Path,
    agent: &ureq::Agent,
    mut progress: impl FnMut(u64, u64),
) -> Result<PathBuf, AdapterError> {
    validate_plan(plan)?;
    fs::create_dir_all(dir).map_err(io_error)?;

    let final_path = dir.join(&plan.file_name);
    if final_path.exists() {
        if hash_file(&final_path)? == plan.sha256 {
            return Ok(final_path);
        }
        // Un fichier déjà présent mais faux n'est pas gardé : on repart d'un téléchargement propre.
        fs::remove_file(&final_path).map_err(io_error)?;
    }

    let part_path = dir.join(format!("{}.part", plan.file_name));
    let mut offset = part_path.metadata().map(|meta| meta.len()).unwrap_or(0);
    if offset > plan.size_bytes {
        fs::remove_file(&part_path).map_err(io_error)?;
        offset = 0;
    }
    ensure_disk_space(dir, plan.size_bytes - offset)?;

    let mut hasher = Sha256::new();
    if offset > 0 {
        feed_hasher(&part_path, &mut hasher)?;
    }

    let mut request = agent.get(plan.url.as_str());
    if offset > 0 {
        request = request.header("Range", format!("bytes={offset}-"));
    }
    let mut response = request.call().map_err(network_error)?;
    let status = response.status().as_u16();

    let (mut file, mut received) = match (status, offset) {
        // Reprise acceptée : la suite du fichier s'ajoute à la partie déjà reçue.
        (206, start) if start > 0 => (OpenOptions::new().append(true).open(&part_path).map_err(io_error)?, start),
        // Serveur sans reprise : on recommence, et le calcul de somme repart de zéro.
        (200, _) => {
            hasher = Sha256::new();
            (File::create(&part_path).map_err(io_error)?, 0)
        }
        (other, _) => return Err(AdapterError::Operation(format!("téléchargement refusé (statut HTTP {other})"))),
    };

    let mut reader = response.body_mut().as_reader();
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        let read = reader.read(&mut buffer).map_err(network_error_text)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(io_error)?;
        hasher.update(&buffer[..read]);
        received += read as u64;
        progress(received, plan.size_bytes);
    }
    file.flush().map_err(io_error)?;
    drop(file);

    if hex(&hasher.finalize()) != plan.sha256 {
        fs::remove_file(&part_path).map_err(io_error)?;
        return Err(AdapterError::ModelInvalid("somme SHA-256 différente de celle attendue : fichier supprimé".into()));
    }
    fs::rename(&part_path, &final_path).map_err(io_error)?;
    Ok(final_path)
}

fn feed_hasher(path: &Path, hasher: &mut Sha256) -> Result<(), AdapterError> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|byte| [DIGITS[usize::from(byte >> 4)] as char, DIGITS[usize::from(byte & 0x0f)] as char])
        .collect()
}

fn io_error(error: std::io::Error) -> AdapterError {
    AdapterError::Operation(format!("fichier du modèle : {error}"))
}

fn network_error(error: ureq::Error) -> AdapterError {
    AdapterError::Operation(format!("connexion au téléchargement interrompue, reprise possible : {error}"))
}

fn network_error_text(error: std::io::Error) -> AdapterError {
    AdapterError::Operation(format!("téléchargement interrompu, reprise possible : {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn plan() -> DownloadPlan {
        DownloadPlan {
            url: "https://example.org/modele.gguf".into(),
            file_name: "modele.gguf".into(),
            sha256: ABC_SHA256.into(),
            size_bytes: 3,
        }
    }

    #[test]
    fn a_well_formed_plan_is_accepted() {
        assert!(validate_plan(&plan()).is_ok());
    }

    #[test]
    fn plain_http_is_refused_before_any_connection() {
        let mut bad = plan();
        bad.url = "http://example.org/modele.gguf".into();
        assert!(matches!(validate_plan(&bad), Err(AdapterError::InvalidTarget(_))));
    }

    #[test]
    fn a_file_name_cannot_leave_its_folder() {
        for name in ["../modele.gguf", "sous\\modele.gguf", ".caché", ""] {
            let mut bad = plan();
            bad.file_name = name.into();
            assert!(matches!(validate_plan(&bad), Err(AdapterError::InvalidTarget(_))), "{name}");
        }
    }

    #[test]
    fn the_expected_hash_must_be_64_lowercase_hex_digits() {
        let uppercase = ABC_SHA256.to_uppercase();
        let longer = format!("{ABC_SHA256}0");
        for hash in ["abc", uppercase.as_str(), longer.as_str()] {
            let mut bad = plan();
            bad.sha256 = hash.to_string();
            assert!(matches!(validate_plan(&bad), Err(AdapterError::InvalidTarget(_))), "{hash}");
        }
    }

    #[test]
    fn an_empty_model_is_refused() {
        let mut bad = plan();
        bad.size_bytes = 0;
        assert!(matches!(validate_plan(&bad), Err(AdapterError::InvalidTarget(_))));
    }

    #[test]
    fn hashing_a_file_gives_its_known_sha256() {
        let dir = std::env::temp_dir().join(format!("nexus-modele-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.bin");
        fs::write(&path, b"abc").unwrap();
        assert_eq!(hash_file(&path).unwrap(), ABC_SHA256);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_model_larger_than_the_free_space_is_refused() {
        let dir = std::env::temp_dir();
        assert!(matches!(ensure_disk_space(&dir, u64::MAX / 2), Err(AdapterError::Operation(_))));
    }
}
