//! Reconnaissance vocale hors ligne avec whisper.cpp (MIT), via `whisper-rs`.
//!
//! Les poids du modèle ne sont jamais embarqués ni téléchargés automatiquement : l'utilisateur
//! place le fichier `ggml-*.bin` dans le dossier de modèles indiqué par l'application.

use std::path::Path;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::AdapterError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    pub text: String,
    /// Code de langue détecté (`fr`, `en`, …), ou `None` si Whisper n'a pas pu le déterminer.
    pub language: Option<String>,
}

pub trait Transcriber: Send + Sync {
    /// `language` : code forcé (`fr`, `en`) ou `None` pour une détection automatique.
    fn transcribe(&self, pcm: &[f32], language: Option<&str>) -> Result<Transcript, AdapterError>;
}

pub struct WhisperTranscriber {
    context: WhisperContext,
}

impl WhisperTranscriber {
    pub fn load(model_path: &Path) -> Result<Self, AdapterError> {
        if !model_path.is_file() {
            return Err(AdapterError::ModelMissing(model_path.display().to_string()));
        }
        let path = model_path
            .to_str()
            .ok_or_else(|| AdapterError::ModelMissing(model_path.display().to_string()))?;
        let context = WhisperContext::new_with_params(path, WhisperContextParameters::default())
            .map_err(|error| AdapterError::ModelInvalid(error.to_string()))?;
        Ok(Self { context })
    }
}

impl Transcriber for WhisperTranscriber {
    fn transcribe(&self, pcm: &[f32], language: Option<&str>) -> Result<Transcript, AdapterError> {
        let inference = |error: whisper_rs::WhisperError| AdapterError::Inference(error.to_string());
        let mut state = self.context.create_state().map_err(inference)?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(language);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state.full(params, pcm).map_err(inference)?;

        let mut text = String::new();
        for index in 0..state.full_n_segments() {
            let segment = state
                .get_segment(index)
                .ok_or_else(|| AdapterError::Inference(format!("segment {index} absent")))?;
            text.push_str(&segment.to_str_lossy().map_err(inference)?);
        }
        let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_string);

        Ok(Transcript { text: text.trim().to_string(), language })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_model_is_reported_with_its_expected_location() {
        let missing = Path::new("/nexus/absent/ggml-base.bin");
        match WhisperTranscriber::load(missing) {
            Err(AdapterError::ModelMissing(path)) => assert!(path.ends_with("ggml-base.bin")),
            _ => panic!("une erreur model-missing était attendue"),
        }
    }

    /// Nécessite un modèle réel : `NEXUS_WHISPER_MODEL=/chemin/ggml-base.bin cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn transcribes_french_and_english_fixtures() {
        let model = std::env::var("NEXUS_WHISPER_MODEL").expect("NEXUS_WHISPER_MODEL défini");
        let transcriber = WhisperTranscriber::load(Path::new(&model)).unwrap();
        let fixture = |name: &str| {
            let path = format!("{}/tests/fixtures/voice/{name}", env!("CARGO_MANIFEST_DIR"));
            crate::plugins::speech::audio::read_wav_mono_16k(std::fs::File::open(path).unwrap()).unwrap()
        };

        let french = transcriber.transcribe(&fixture("fr-lance-discord.wav"), None).unwrap();
        assert_eq!(french.language.as_deref(), Some("fr"));
        assert!(french.text.to_lowercase().contains("discord"), "transcription : {}", french.text);

        let english = transcriber.transcribe(&fixture("en-open-notepad.wav"), None).unwrap();
        assert_eq!(english.language.as_deref(), Some("en"));
        assert!(english.text.to_lowercase().contains("notepad"), "transcription : {}", english.text);
    }

    /// Les audios de `tests/fixtures` sont synthétiques (espeak, voix robotique) : ce test-ci utilise une vraie voix.
    /// Kokoro dit la phrase, Whisper doit la reconnaître. Exige la voix installée et le modèle Whisper.
    #[test]
    #[ignore = "exige la voix installée (NEXUS_VOICE_ROOT) et le modèle Whisper (NEXUS_WHISPER_MODEL)"]
    fn live_whisper_understands_kokoro_speech() {
        let root = std::path::PathBuf::from(std::env::var("NEXUS_VOICE_ROOT").expect("NEXUS_VOICE_ROOT défini"));
        let model = std::env::var("NEXUS_WHISPER_MODEL").expect("NEXUS_WHISPER_MODEL défini");
        let wav = crate::voice_tts::synthesize_at(&root, "Lance Discord.", 1.0, "fr").unwrap();
        let mut reader = hound::WavReader::new(std::io::Cursor::new(wav)).unwrap();
        let rate = reader.spec().sample_rate;
        let samples: Vec<f32> = reader.samples::<i16>().map(|sample| f32::from(sample.unwrap()) / f32::from(i16::MAX)).collect();
        let pcm = resample_linear(&samples, rate, 16_000);

        let transcriber = WhisperTranscriber::load(Path::new(&model)).unwrap();
        let transcript = transcriber.transcribe(&pcm, Some("fr")).unwrap();
        assert!(transcript.text.to_lowercase().contains("discord"), "transcription : {}", transcript.text);
    }

    /// Interpolation linéaire : suffisant pour la reconnaissance de la parole, sans dépendance supplémentaire.
    fn resample_linear(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
        let ratio = f64::from(from) / f64::from(to);
        let length = (samples.len() as f64 / ratio) as usize;
        (0..length)
            .map(|index| {
                let position = index as f64 * ratio;
                let base = position.floor() as usize;
                let next = (base + 1).min(samples.len() - 1);
                let fraction = (position - base as f64) as f32;
                samples[base] * (1.0 - fraction) + samples[next] * fraction
            })
            .collect()
    }
}
