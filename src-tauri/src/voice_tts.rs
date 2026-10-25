//! Voix naturelle locale (Piper) : le texte devient un fichier WAV, que l'interface joue. Rien n'est envoyé en ligne.
//!
//! Une voix par langue de l'utilisateur. Le moteur (Piper) et la voix de la langue sont téléchargés sur demande, depuis
//! l'adresse fixée ici, vérifiés par leur somme SHA-256, puis rangés dans `voices/` du dossier de données de NEXUS.
//! Le frontend ne donne jamais de chemin ni d'adresse : seuls la langue, le texte et la vitesse sont transmis, et le
//! texte passe par l'entrée du moteur (jamais dans la ligne de commande).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::AdapterError;
use crate::grants::require_main;
use crate::model_download::{self, DownloadPlan};
use crate::web::base64;

/// Moteur Piper (Windows x64). Son archive contient le moteur, ses bibliothèques et les données de phonétique.
pub struct EngineSpec {
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

pub const ENGINE: EngineSpec = EngineSpec {
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
    size_bytes: 22_477_236,
};

/// Voix d'une langue : le modèle (`.onnx`) et sa configuration (`.onnx.json`), chacun avec sa somme.
pub struct VoiceModel {
    pub locale: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub config_url: &'static str,
    pub config_sha256: &'static str,
    pub config_size_bytes: u64,
}

/// Les voix de NEXUS, une par langue d'interface. Une langue absente d'ici n'a pas de voix naturelle : la voix Windows lit.
pub const VOICES: &[VoiceModel] = &[VoiceModel {
    locale: "fr",
    file: "fr_FR-siwis-medium.onnx",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx",
    sha256: "641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99",
    size_bytes: 63_201_294,
    config_url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json",
    config_sha256: "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959",
    config_size_bytes: 4_875,
}];

/// Un texte de réponse tient largement dans cette limite ; au-delà, la synthèse serait longue pour rien.
const MAX_TEXT_CHARS: usize = 2000;
const SYNTH_TIMEOUT: Duration = Duration::from_secs(30);
/// Silence entre deux phrases, en secondes : la réponse respire comme une phrase parlée.
const SENTENCE_SILENCE: &str = "0.2";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ENGINE_ARCHIVE: &str = "piper-engine.zip";
const ENGINE_DIR: &str = "piper";
/// Chemin du moteur dans `voices/` : l'archive contient un dossier `piper/` qui range `piper.exe` et ses bibliothèques.
const ENGINE_EXE: &str = "piper/piper/piper.exe";

pub fn voice_for(locale: &str) -> Option<&'static VoiceModel> {
    VOICES.iter().find(|voice| voice.locale == locale)
}

fn voices_dir(root: &Path) -> PathBuf {
    root.join("voices")
}

/// Le moteur installé, et le fichier de la voix de cette langue.
pub fn voice_paths(root: &Path, voice: &VoiceModel) -> (PathBuf, PathBuf) {
    let voices = voices_dir(root);
    (voices.join(ENGINE_EXE), voices.join(voice.file))
}

/// Vrai quand le moteur et la voix de cette langue sont présents, avec leur configuration.
pub fn installed(root: &Path, locale: &str) -> bool {
    let Some(voice) = voice_for(locale) else {
        return false;
    };
    let (engine, model) = voice_paths(root, voice);
    engine.is_file() && model.is_file() && voices_dir(root).join(format!("{}.json", voice.file)).is_file()
}

/// Télécharge et vérifie le moteur puis la voix de la langue. Ce qui est déjà présent et juste n'est pas refait.
pub fn install_at(root: &Path, locale: &str) -> Result<(), AdapterError> {
    let voice = voice_for(locale).ok_or_else(|| AdapterError::InvalidTarget("aucune voix naturelle pour cette langue".into()))?;
    let dir = voices_dir(root);
    let agent = model_download::agent();

    let (engine, _) = voice_paths(root, voice);
    if !engine.is_file() {
        let archive = model_download::download(
            &DownloadPlan { url: ENGINE.url.into(), file_name: ENGINE_ARCHIVE.into(), sha256: ENGINE.sha256.into(), size_bytes: ENGINE.size_bytes },
            &dir,
            &agent,
            |_, _| {},
        )?;
        let target = dir.join(ENGINE_DIR);
        std::fs::create_dir_all(&target).map_err(|error| AdapterError::Operation(format!("dossier du moteur ({error})")))?;
        // `tar` (intégré à Windows) lit les archives zip. Le contenu est celui de l'archive vérifiée ci-dessus.
        let status = Command::new("tar")
            .arg("-xf")
            .arg(&archive)
            .arg("-C")
            .arg(&target)
            .status()
            .map_err(|error| AdapterError::Operation(format!("extraction du moteur impossible ({error})")))?;
        let _ = std::fs::remove_file(&archive);
        if !status.success() || !engine.is_file() {
            return Err(AdapterError::Operation("le moteur vocal n'a pas pu être installé".into()));
        }
    }

    model_download::download(
        &DownloadPlan { url: voice.url.into(), file_name: voice.file.into(), sha256: voice.sha256.into(), size_bytes: voice.size_bytes },
        &dir,
        &agent,
        |_, _| {},
    )?;
    model_download::download(
        &DownloadPlan {
            url: voice.config_url.into(),
            file_name: format!("{}.json", voice.file),
            sha256: voice.config_sha256.into(),
            size_bytes: voice.config_size_bytes,
        },
        &dir,
        &agent,
        |_, _| {},
    )?;
    Ok(())
}

/// Texte accepté : non vide, borné, sans caractère de contrôle. Les retours à la ligne séparent les phrases.
pub fn valid_text(text: &str) -> Result<String, AdapterError> {
    let cleaned: String = text.chars().filter(|c| *c == '\n' || !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return Err(AdapterError::InvalidTarget("texte vide pour la voix".into()));
    }
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        return Err(AdapterError::InvalidTarget("texte trop long pour la voix".into()));
    }
    Ok(trimmed.to_string())
}

/// Vitesse de Piper à partir de la vitesse de l'interface (1 = normal). Piper allonge le son quand la valeur grandit.
pub fn length_scale(rate: f64) -> f64 {
    if !rate.is_finite() || rate <= 0.0 {
        return 1.0;
    }
    (1.0 / rate).clamp(0.6, 2.0)
}

/// Synthèse du texte en WAV, avec la voix de la langue. Le fichier temporaire est supprimé dans tous les cas.
pub fn synthesize_at(root: &Path, text: &str, rate: f64, locale: &str) -> Result<Vec<u8>, AdapterError> {
    let voice = voice_for(locale).ok_or_else(|| AdapterError::InvalidTarget("aucune voix naturelle pour cette langue".into()))?;
    let text = valid_text(text)?;
    let (engine, model) = voice_paths(root, voice);
    if !installed(root, locale) {
        return Err(AdapterError::ModelMissing("voix naturelle non installée".into()));
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let output = std::env::temp_dir().join(format!("nexus-voice-{}-{nanos}.wav", std::process::id()));
    let outcome = run_piper(&engine, &model, &text, &output, length_scale(rate)).and_then(|()| {
        std::fs::read(&output).map_err(|error| AdapterError::Operation(format!("audio illisible ({error})")))
    });
    let _ = std::fs::remove_file(&output);
    outcome
}

fn run_piper(engine: &Path, model: &Path, text: &str, output: &Path, scale: f64) -> Result<(), AdapterError> {
    let mut command = Command::new(engine);
    command
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(output)
        .arg("--length_scale")
        .arg(format!("{scale:.2}"))
        .arg("--sentence_silence")
        .arg(SENTENCE_SILENCE)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|error| AdapterError::Operation(format!("moteur vocal indisponible ({error})")))?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(text.as_bytes()).map_err(|error| AdapterError::Operation(format!("texte non transmis au moteur ({error})")))?;
    }
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err(AdapterError::Operation("la synthèse vocale a échoué".into())),
            Ok(None) if started.elapsed() > SYNTH_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AdapterError::Operation("la synthèse vocale a dépassé le délai".into()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(AdapterError::Operation(format!("moteur vocal inaccessible ({error})"))),
        }
    }
}

fn data_root(app: &AppHandle) -> Result<PathBuf, AdapterError> {
    app.path().app_data_dir().map_err(|error| AdapterError::Operation(format!("dossier de données introuvable ({error})")))
}

/// Vrai si la voix naturelle de cette langue est installée sur ce poste.
#[tauri::command]
pub async fn speech_neural_available(app: AppHandle, webview: tauri::Webview, locale: String) -> Result<bool, AdapterError> {
    require_main(&webview)?;
    Ok(installed(&data_root(&app)?, &locale))
}

/// Installe la voix naturelle de cette langue (moteur et voix, vérifiés). Long : le frontend attend le résultat.
#[tauri::command]
pub async fn speech_neural_install(app: AppHandle, webview: tauri::Webview, locale: String) -> Result<(), AdapterError> {
    require_main(&webview)?;
    let root = data_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || install_at(&root, &locale))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Le texte, lu par la voix naturelle de cette langue, en WAV encodé en base64.
#[tauri::command]
pub async fn speech_neural_speak(app: AppHandle, webview: tauri::Webview, text: String, rate: f64, locale: String) -> Result<String, AdapterError> {
    require_main(&webview)?;
    let root = data_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || synthesize_at(&root, &text, rate, &locale).map(|bytes| base64(&bytes)))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("nexus-voice-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn speed_maps_to_piper_length_scale() {
        assert_eq!(length_scale(1.0), 1.0);
        assert_eq!(length_scale(0.5), 2.0);
        assert_eq!(length_scale(2.0), 0.6);
        assert_eq!(length_scale(0.0), 1.0);
        assert_eq!(length_scale(f64::NAN), 1.0);
    }

    #[test]
    fn texts_are_bounded_and_free_of_control_characters() {
        assert!(valid_text("   ").is_err());
        assert_eq!(valid_text("Bonjour\u{7}\nLa suite").unwrap(), "Bonjour\nLa suite");
        assert!(valid_text(&"a".repeat(MAX_TEXT_CHARS + 1)).is_err());
    }

    #[test]
    fn every_voice_and_the_engine_are_pinned_to_https_and_a_full_hash() {
        let hashes = std::iter::once(ENGINE.sha256).chain(VOICES.iter().flat_map(|voice| [voice.sha256, voice.config_sha256]));
        for hash in hashes {
            assert_eq!(hash.len(), 64, "somme SHA-256 attendue : {hash}");
            assert!(hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
        }
        assert!(ENGINE.url.starts_with("https://"));
        for voice in VOICES {
            assert!(voice.url.starts_with("https://") && voice.config_url.starts_with("https://"));
        }
    }

    #[test]
    fn each_language_has_at_most_one_voice() {
        let mut locales: Vec<&str> = VOICES.iter().map(|voice| voice.locale).collect();
        locales.sort_unstable();
        locales.dedup();
        assert_eq!(locales.len(), VOICES.len());
    }

    #[test]
    fn the_voice_is_installed_only_when_engine_voice_and_config_are_present() {
        let root = scratch("installed");
        assert!(!installed(&root, "fr"));

        let voice = voice_for("fr").unwrap();
        let (engine, model) = voice_paths(&root, voice);
        std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
        std::fs::write(&engine, b"").unwrap();
        std::fs::write(&model, b"").unwrap();
        assert!(!installed(&root, "fr"), "sans la configuration, la voix n'est pas utilisable");
        std::fs::write(voices_dir(&root).join(format!("{}.json", voice.file)), b"{}").unwrap();
        assert!(installed(&root, "fr"));
        assert!(!installed(&root, "de"), "une langue sans voix n'est jamais installée");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn synthesis_and_install_refuse_a_language_without_voice() {
        let root = scratch("unknown");
        assert!(matches!(synthesize_at(&root, "Bonjour", 1.0, "de"), Err(AdapterError::InvalidTarget(_))));
        assert!(matches!(install_at(&root, "de"), Err(AdapterError::InvalidTarget(_))));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn synthesis_refuses_when_the_voice_is_not_installed() {
        let root = scratch("missing");
        assert!(matches!(synthesize_at(&root, "Bonjour", 1.0, "fr"), Err(AdapterError::ModelMissing(_))));
        let _ = std::fs::remove_dir_all(&root);
    }
}
