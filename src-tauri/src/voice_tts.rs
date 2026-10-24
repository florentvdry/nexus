//! Voix naturelle locale (Piper) : le texte devient un fichier WAV, que l'interface joue. Rien n'est envoyé en ligne.
//! Le moteur et la voix sont installés dans le dossier de données de NEXUS (`voices/`), après accord de l'utilisateur.
//! Le frontend ne donne jamais de chemin : seuls le texte et la vitesse sont transmis, le texte passe par l'entrée du
//! moteur (jamais dans la ligne de commande).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::AdapterError;
use crate::grants::require_core;
use crate::web::base64;

/// Fichiers installés dans `voices/` : le moteur (dans son dossier, avec ses bibliothèques) et la voix française.
const ENGINE_DIR: &str = "piper/piper";
const ENGINE_FILE: &str = "piper.exe";
const VOICE_FILE: &str = "fr_FR-siwis-medium.onnx";
/// Un texte de réponse tient largement dans cette limite ; au-delà, la synthèse serait longue pour rien.
const MAX_TEXT_CHARS: usize = 2000;
const SYNTH_TIMEOUT: Duration = Duration::from_secs(30);
/// Silence entre deux phrases, en secondes : la réponse respire comme une phrase parlée.
const SENTENCE_SILENCE: &str = "0.2";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Le moteur et la voix, à leurs emplacements fixes dans le dossier de données.
pub fn voice_paths(root: &Path) -> (PathBuf, PathBuf) {
    let voices = root.join("voices");
    (voices.join(ENGINE_DIR).join(ENGINE_FILE), voices.join(VOICE_FILE))
}

/// Vrai quand le moteur et la voix sont présents.
pub fn installed(root: &Path) -> bool {
    let (engine, voice) = voice_paths(root);
    engine.is_file() && voice.is_file()
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

/// Synthèse du texte en WAV, par le moteur installé. Le fichier temporaire est supprimé dans tous les cas.
pub fn synthesize_at(root: &Path, text: &str, rate: f64) -> Result<Vec<u8>, AdapterError> {
    let text = valid_text(text)?;
    let (engine, voice) = voice_paths(root);
    if !engine.is_file() || !voice.is_file() {
        return Err(AdapterError::ModelMissing("voix naturelle non installée".into()));
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let output = std::env::temp_dir().join(format!("nexus-voice-{}-{nanos}.wav", std::process::id()));
    let outcome = run_piper(&engine, &voice, &text, &output, length_scale(rate)).and_then(|()| {
        std::fs::read(&output).map_err(|error| AdapterError::Operation(format!("audio illisible ({error})")))
    });
    let _ = std::fs::remove_file(&output);
    outcome
}

fn run_piper(engine: &Path, voice: &Path, text: &str, output: &Path, scale: f64) -> Result<(), AdapterError> {
    let mut command = Command::new(engine);
    command
        .arg("-m")
        .arg(voice)
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

/// Vrai si la voix naturelle est installée sur ce poste.
#[tauri::command]
pub async fn speech_neural_available(app: AppHandle, caller: String) -> Result<bool, AdapterError> {
    require_core(&caller)?;
    Ok(installed(&data_root(&app)?))
}

/// Le texte, lu par la voix naturelle, en WAV encodé en base64.
#[tauri::command]
pub async fn speech_neural_speak(app: AppHandle, caller: String, text: String, rate: f64) -> Result<String, AdapterError> {
    require_core(&caller)?;
    let root = data_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || synthesize_at(&root, &text, rate).map(|bytes| base64(&bytes)))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn the_voice_is_installed_only_when_engine_and_voice_are_present() {
        let root = std::env::temp_dir().join(format!("nexus-voice-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        assert!(!installed(&root));

        let (engine, voice) = voice_paths(&root);
        std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
        std::fs::write(&engine, b"").unwrap();
        assert!(!installed(&root));
        std::fs::write(&voice, b"").unwrap();
        assert!(installed(&root));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn synthesis_refuses_when_nothing_is_installed() {
        let root = std::env::temp_dir().join(format!("nexus-voice-missing-{}", std::process::id()));
        let error = synthesize_at(&root, "Bonjour", 1.0).unwrap_err();
        assert!(matches!(error, AdapterError::ModelMissing(_)));
    }
}
