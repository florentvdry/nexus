//! Voix naturelle locale : le texte devient un fichier WAV, que l'interface joue. Rien n'est envoyé en ligne.
//!
//! Synthèse : Kokoro (modèle quantifié, 92 Mo) avec ONNX Runtime ; la phonétique vient d'espeak-ng. Reconnaissance :
//! Whisper (whisper.cpp, modèle « small » quantifié). Tout est téléchargé sur demande, depuis les adresses fixées ici,
//! vérifié par sa somme SHA-256, puis rangé dans le dossier de données de NEXUS. Le frontend ne donne jamais de chemin
//! ni d'adresse : seuls la langue, le texte et la vitesse sont transmis.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::error::AdapterError;
use crate::espeak;
use crate::grants::require_main;
use crate::kokoro::{self, Kokoro};
use crate::model_download::{self, DownloadPlan};
use crate::web::base64;

/// Un fichier téléchargé : adresse HTTPS, somme SHA-256 attendue, taille (pour contrôler l'espace disque).
struct Artifact {
    file: &'static str,
    url: &'static str,
    sha256: &'static str,
    size_bytes: u64,
}

impl Artifact {
    fn plan(&self) -> DownloadPlan {
        DownloadPlan { url: self.url.into(), file_name: self.file.into(), sha256: self.sha256.into(), size_bytes: self.size_bytes }
    }
}

const KOKORO_MODEL: Artifact = Artifact {
    file: "kokoro-v1.0-quantized.onnx",
    url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx",
    sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
    size_bytes: 92_361_116,
};

const KOKORO_TOKENIZER: Artifact = Artifact {
    file: "kokoro-tokenizer.json",
    url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json",
    sha256: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34",
    size_bytes: 3_497,
};

/// Runtime ONNX (Microsoft, MIT) : seules deux de ses bibliothèques sont gardées, extraites de l'archive vérifiée.
const RUNTIME_ARCHIVE: Artifact = Artifact {
    file: "onnxruntime-1.31.0.zip",
    url: "https://github.com/microsoft/onnxruntime/releases/download/v1.31.0/onnxruntime-win-x64-1.31.0.zip",
    sha256: "3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195",
    size_bytes: 82_887_349,
};
const RUNTIME_FOLDER_IN_ARCHIVE: &str = "onnxruntime-win-x64-1.31.0/lib";
const RUNTIME_FILES: &[&str] = &["onnxruntime.dll", "onnxruntime_providers_shared.dll"];

/// espeak-ng (GPL-3.0) : sa bibliothèque et ses données viennent de l'archive du moteur vocal Piper, vérifiée.
const ESPEAK_ARCHIVE: Artifact = Artifact {
    file: "espeak-source.zip",
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
    size_bytes: 22_477_236,
};
const ESPEAK_FOLDER_IN_ARCHIVE: &str = "piper";
const ESPEAK_ITEMS: &[&str] = &[espeak::LIBRARY_FILE, "espeak-ng-data"];

/// Reconnaissance vocale : Whisper « small » quantifié en 5 bits (multilingue, bon compromis entre précision et vitesse).
const WHISPER_MODEL: Artifact = Artifact {
    file: "ggml-small-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    size_bytes: 190_085_487,
};

/// Une voix par langue de l'interface : la phonétique espeak, et le fichier de styles Kokoro.
struct VoiceSpec {
    locale: &'static str,
    espeak_voice: &'static str,
    kokoro_voice: Artifact,
}

const VOICES: &[VoiceSpec] = &[
    VoiceSpec {
        locale: "fr",
        espeak_voice: "fr",
        kokoro_voice: Artifact {
            file: "ff_siwis.bin",
            url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/ff_siwis.bin",
            sha256: "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861",
            size_bytes: 522_240,
        },
    },
    VoiceSpec {
        locale: "en",
        espeak_voice: "en-us",
        kokoro_voice: Artifact {
            file: "af_heart.bin",
            url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin",
            sha256: "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b",
            size_bytes: 522_240,
        },
    },
];

/// Un texte de réponse tient largement dans cette limite ; au-delà, la synthèse serait longue pour rien.
const MAX_TEXT_CHARS: usize = 2000;
/// Marques de ponctuation gardées dans la phonétique : elles donnent les pauses de la parole.
const MARKS: &str = ".,;:!?";

/// Le moteur Kokoro chargé : une seule session, réutilisée d'une réponse à l'autre.
static KOKORO: Mutex<Option<Kokoro>> = Mutex::new(None);

fn voice_for(locale: &str) -> Option<&'static VoiceSpec> {
    VOICES.iter().find(|voice| voice.locale == locale)
}

fn kokoro_dir(root: &Path) -> PathBuf {
    root.join("voices").join("kokoro")
}

fn runtime_dir(root: &Path) -> PathBuf {
    root.join("voices").join("runtime")
}

fn espeak_dir(root: &Path) -> PathBuf {
    root.join("voices").join("espeak")
}

/// Emplacement du modèle Whisper. Le frontend et la reconnaissance utilisent le même chemin.
pub fn whisper_model_path(root: &Path) -> PathBuf {
    root.join("models").join(WHISPER_MODEL.file)
}

/// Tout ce qu'il faut pour parler et écouter dans cette langue. Un seul fichier manquant, et rien n'est utilisé.
fn required_files(root: &Path, voice: &VoiceSpec) -> Vec<PathBuf> {
    let mut files = vec![
        kokoro_dir(root).join(KOKORO_MODEL.file),
        kokoro_dir(root).join(KOKORO_TOKENIZER.file),
        kokoro_dir(root).join(voice.kokoro_voice.file),
        espeak_dir(root).join(espeak::LIBRARY_FILE),
        espeak_dir(root).join("espeak-ng-data").join("phondata"),
        whisper_model_path(root),
    ];
    files.extend(RUNTIME_FILES.iter().map(|name| runtime_dir(root).join(name)));
    files
}

/// Vrai quand la voix de cette langue, la reconnaissance et leurs moteurs sont installés et complets.
pub fn installed(root: &Path, locale: &str) -> bool {
    let Some(voice) = voice_for(locale) else {
        return false;
    };
    required_files(root, voice).iter().all(|path| path.is_file())
}

/// Télécharge puis vérifie tout ce qui manque. Ce qui est déjà présent n'est pas refait.
pub fn install_at(root: &Path, locale: &str) -> Result<(), AdapterError> {
    let voice = voice_for(locale).ok_or_else(|| AdapterError::InvalidTarget("aucune voix naturelle pour cette langue".into()))?;
    let agent = model_download::agent();
    let voices = root.join("voices");

    fetch(&KOKORO_MODEL, &kokoro_dir(root), &agent)?;
    fetch(&KOKORO_TOKENIZER, &kokoro_dir(root), &agent)?;
    fetch(&voice.kokoro_voice, &kokoro_dir(root), &agent)?;

    if !RUNTIME_FILES.iter().all(|name| runtime_dir(root).join(name).is_file()) {
        let archive = fetch(&RUNTIME_ARCHIVE, &voices, &agent)?;
        extract_items(&archive, &voices.join("runtime-archive"), RUNTIME_FOLDER_IN_ARCHIVE, RUNTIME_FILES, &runtime_dir(root))?;
    }
    if !espeak_dir(root).join(espeak::LIBRARY_FILE).is_file() {
        let archive = fetch(&ESPEAK_ARCHIVE, &voices, &agent)?;
        extract_items(&archive, &voices.join("espeak-archive"), ESPEAK_FOLDER_IN_ARCHIVE, ESPEAK_ITEMS, &espeak_dir(root))?;
    }

    fetch(&WHISPER_MODEL, &root.join("models"), &agent)?;
    Ok(())
}

/// Le fichier déjà présent est gardé ; sinon il est téléchargé et vérifié. Renvoie son chemin.
fn fetch(artifact: &Artifact, dir: &Path, agent: &ureq::Agent) -> Result<PathBuf, AdapterError> {
    let target = dir.join(artifact.file);
    if target.is_file() {
        return Ok(target);
    }
    model_download::download(&artifact.plan(), dir, agent, |_, _| {})
}

/// Extrait l'archive dans un dossier de travail, copie les éléments voulus dans `target`, puis efface le reste.
fn extract_items(archive: &Path, scratch: &Path, folder: &str, items: &[&str], target: &Path) -> Result<(), AdapterError> {
    let _ = std::fs::remove_dir_all(scratch);
    std::fs::create_dir_all(scratch).map_err(|error| AdapterError::Operation(format!("dossier d'extraction ({error})")))?;
    // `tar` (intégré à Windows) lit les archives zip. Le contenu est celui de l'archive vérifiée avant ici.
    let status = Command::new("tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(scratch)
        .status()
        .map_err(|error| AdapterError::Operation(format!("extraction impossible ({error})")))?;
    if !status.success() {
        return Err(AdapterError::Operation("l'archive du moteur vocal n'a pas pu être extraite".into()));
    }

    std::fs::create_dir_all(target).map_err(|error| AdapterError::Operation(format!("dossier du moteur vocal ({error})")))?;
    for item in items {
        let from = scratch.join(folder).join(item);
        let to = target.join(item);
        if to.is_dir() {
            let _ = std::fs::remove_dir_all(&to);
        } else {
            let _ = std::fs::remove_file(&to);
        }
        std::fs::rename(&from, &to).map_err(|error| AdapterError::Operation(format!("élément du moteur absent de l'archive ({error})")))?;
    }
    let _ = std::fs::remove_dir_all(scratch);
    let _ = std::fs::remove_file(archive);
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

/// Vitesse du modèle à partir de la vitesse de l'interface (1 = normal, plus grand = plus vite).
pub fn speed_for(rate: f64) -> f32 {
    if !rate.is_finite() || rate <= 0.0 {
        return 1.0;
    }
    rate.clamp(0.5, 2.0) as f32
}

/// Synthèse du texte en WAV, avec la voix de la langue. Le moteur reste chargé entre deux réponses.
pub fn synthesize_at(root: &Path, text: &str, rate: f64, locale: &str) -> Result<Vec<u8>, AdapterError> {
    let voice = voice_for(locale).ok_or_else(|| AdapterError::InvalidTarget("aucune voix naturelle pour cette langue".into()))?;
    let text = valid_text(text)?;
    if !installed(root, locale) {
        return Err(AdapterError::ModelMissing("voix naturelle non installée".into()));
    }
    let styles = kokoro::read_voice(&kokoro_dir(root).join(voice.kokoro_voice.file))?;
    let speed = speed_for(rate);
    let samples = {
        let mut slot = KOKORO.lock().map_err(|_| AdapterError::TaskFailed("verrou de la synthèse vocale".into()))?;
        if slot.is_none() {
            let runtime = runtime_dir(root).join(RUNTIME_FILES[0]);
            *slot = Some(Kokoro::load(&runtime, &kokoro_dir(root).join(KOKORO_MODEL.file), &kokoro_dir(root).join(KOKORO_TOKENIZER.file))?);
        }
        let kokoro = slot.as_mut().ok_or_else(|| AdapterError::TaskFailed("moteur de synthèse absent".into()))?;
        speak_lines(kokoro, &styles, &espeak_dir(root), voice.espeak_voice, &text, speed)?
    };
    wav_bytes(&samples)
}

/// Chaque ligne est une phrase ; un silence les sépare.
fn speak_lines(kokoro: &mut Kokoro, styles: &[f32], espeak: &Path, espeak_voice: &str, text: &str, speed: f32) -> Result<Vec<f32>, AdapterError> {
    let mut audio = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if !audio.is_empty() {
            audio.extend(std::iter::repeat_n(0.0_f32, kokoro::PAUSE_SAMPLES));
        }
        let phonemes = line_phonemes(espeak, espeak_voice, line)?;
        audio.extend(kokoro.speak(styles, &phonemes, speed)?);
    }
    Ok(audio)
}

/// Morceau d'une phrase : des mots à phonétiser, ou une marque de ponctuation gardée pour la pause.
#[derive(Debug, PartialEq)]
enum Piece {
    Words(String),
    Mark(char),
}

fn pieces(line: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut words = String::new();
    for symbol in line.chars() {
        if MARKS.contains(symbol) {
            if !words.trim().is_empty() {
                pieces.push(Piece::Words(words.trim().to_string()));
            }
            words.clear();
            pieces.push(Piece::Mark(symbol));
        } else {
            words.push(symbol);
        }
    }
    if !words.trim().is_empty() {
        pieces.push(Piece::Words(words.trim().to_string()));
    }
    pieces
}

/// Phonèmes d'une phrase : les mots par espeak, la ponctuation telle quelle.
fn line_phonemes(espeak_dir: &Path, voice: &str, line: &str) -> Result<String, AdapterError> {
    let mut out = String::new();
    for piece in pieces(line) {
        match piece {
            Piece::Words(words) => out.push_str(&espeak::phonemes(espeak_dir, voice, &words)?),
            Piece::Mark(mark) => {
                out.push(mark);
                out.push(' ');
            }
        }
    }
    Ok(out)
}

/// WAV 16 bits, mono, à la fréquence du modèle.
fn wav_bytes(samples: &[f32]) -> Result<Vec<u8>, AdapterError> {
    let spec = hound::WavSpec { channels: 1, sample_rate: kokoro::SAMPLE_RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(audio_error)?;
        for sample in samples {
            writer.write_sample(pcm(*sample)).map_err(audio_error)?;
        }
        writer.finalize().map_err(audio_error)?;
    }
    Ok(cursor.into_inner())
}

fn pcm(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16
}

fn audio_error(error: hound::Error) -> AdapterError {
    AdapterError::Audio(error.to_string())
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

/// Installe la voix naturelle de cette langue et la reconnaissance vocale (vérifiées). Long : le frontend attend.
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
    fn speed_maps_to_the_model_speed() {
        assert_eq!(speed_for(1.0), 1.0);
        assert_eq!(speed_for(0.1), 0.5);
        assert_eq!(speed_for(9.0), 2.0);
        assert_eq!(speed_for(0.0), 1.0);
        assert_eq!(speed_for(f64::NAN), 1.0);
    }

    #[test]
    fn texts_are_bounded_and_free_of_control_characters() {
        assert!(valid_text("   ").is_err());
        assert_eq!(valid_text("Bonjour\u{7}\nLa suite").unwrap(), "Bonjour\nLa suite");
        assert!(valid_text(&"a".repeat(MAX_TEXT_CHARS + 1)).is_err());
    }

    #[test]
    fn every_download_is_pinned_to_https_and_a_full_hash() {
        let artifacts = [&KOKORO_MODEL, &KOKORO_TOKENIZER, &RUNTIME_ARCHIVE, &ESPEAK_ARCHIVE, &WHISPER_MODEL]
            .into_iter()
            .chain(VOICES.iter().map(|voice| &voice.kokoro_voice));
        for artifact in artifacts {
            let hash = artifact.sha256;
            assert_eq!(hash.len(), 64, "somme SHA-256 attendue : {hash}");
            assert!(hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
            assert!(artifact.url.starts_with("https://"), "adresse non HTTPS : {}", artifact.url);
            assert!(artifact.size_bytes > 0);
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
    fn the_voice_is_installed_only_when_every_file_is_present() {
        let root = scratch("installed");
        assert!(!installed(&root, "fr"));

        let voice = voice_for("fr").unwrap();
        let files = required_files(&root, voice);
        for file in &files[..files.len() - 1] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"").unwrap();
        }
        assert!(!installed(&root, "fr"), "il manque encore un fichier : rien n'est utilisé");
        let last = files.last().unwrap();
        std::fs::create_dir_all(last.parent().unwrap()).unwrap();
        std::fs::write(last, b"").unwrap();
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

    #[test]
    fn punctuation_is_kept_between_the_words_to_phonemize() {
        assert_eq!(
            pieces("Bonjour, tout le monde !"),
            vec![Piece::Words("Bonjour".into()), Piece::Mark(','), Piece::Words("tout le monde".into()), Piece::Mark('!')]
        );
        assert_eq!(pieces("  ?  "), vec![Piece::Mark('?')]);
        assert!(pieces("   ").is_empty());
    }

    #[test]
    fn the_wav_has_one_channel_at_the_model_rate() {
        let bytes = wav_bytes(&[0.0, 0.5, -0.5]).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let reader = hound::WavReader::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, kokoro::SAMPLE_RATE);
        assert_eq!(reader.duration(), 3);
    }

    /// Télécharge et vérifie tout (plusieurs centaines de Mo) dans le dossier désigné : à lancer avec accord.
    #[test]
    #[ignore = "télécharge la voix et la reconnaissance (NEXUS_VOICE_ROOT) : à lancer avec accord"]
    fn live_install_downloads_and_verifies_everything() {
        let root = PathBuf::from(std::env::var("NEXUS_VOICE_ROOT").expect("définir NEXUS_VOICE_ROOT"));
        install_at(&root, "fr").unwrap();
        assert!(installed(&root, "fr"));
    }

    /// Lit une voix réellement installée : `NEXUS_VOICE_ROOT` pointe le dossier de données de NEXUS.
    #[test]
    #[ignore = "exige la voix installée (NEXUS_VOICE_ROOT) : synthèse réelle"]
    fn live_french_voice_speaks_when_installed() {
        let root = PathBuf::from(std::env::var("NEXUS_VOICE_ROOT").expect("définir NEXUS_VOICE_ROOT"));
        assert!(installed(&root, "fr"), "la voix française n'est pas installée dans ce dossier");
        let wav = synthesize_at(&root, "Bonjour, je suis NEXUS. Voici la réponse.", 1.0, "fr").unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(wav)).unwrap();
        assert!(reader.duration() > 1, "la phrase est trop courte : {} échantillons", reader.duration());
    }
}
