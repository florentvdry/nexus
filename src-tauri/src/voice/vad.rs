//! Détection d'activité vocale avec Silero VAD v5 (MIT), exécuté par tract (ONNX en Rust pur).
//!
//! Le modèle attend des blocs de 512 échantillons précédés de 64 échantillons de contexte.
//! L'état récurrent est conservé d'un bloc à l'autre.
//!
//! Variante `silero_vad_16k_openvino.onnx` : sans opérateur `If`, donc exécutable par tract.
//! Le modèle ne gère que 16 kHz, ce qui correspond au format du pipeline.

use std::sync::Arc;

use tract_onnx::prelude::*;

use crate::error::AdapterError;

pub const CHUNK_SAMPLES: usize = 512;
const CONTEXT_SAMPLES: usize = 64;
const STATE_SIZE: usize = 128;

const MODEL_BYTES: &[u8] = include_bytes!("../../resources/models/silero_vad_16k_openvino.onnx");

type Plan = Arc<TypedRunnableModel>;

pub struct SileroVad {
    plan: Plan,
    state: Tensor,
    context: Vec<f32>,
}

fn inference_error(error: impl std::fmt::Display) -> AdapterError {
    AdapterError::Inference(format!("{error:#}"))
}

impl SileroVad {
    pub fn load() -> Result<Self, AdapterError> {
        let input_len = CONTEXT_SAMPLES + CHUNK_SAMPLES;
        let plan = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(MODEL_BYTES))
            .map_err(inference_error)?
            .with_input_fact(0, InferenceFact::dt_shape(f32::datum_type(), tvec!(1, input_len)))
            .map_err(inference_error)?
            .with_input_fact(1, InferenceFact::dt_shape(f32::datum_type(), tvec!(2, 1, STATE_SIZE)))
            .map_err(inference_error)?
            .into_optimized()
            .map_err(inference_error)?
            .into_runnable()
            .map_err(inference_error)?;

        Ok(Self::with_plan(plan))
    }

    fn with_plan(plan: Plan) -> Self {
        Self {
            plan,
            state: Tensor::zero::<f32>(&[2, 1, STATE_SIZE]).expect("état initial du VAD"),
            context: vec![0.0; CONTEXT_SAMPLES],
        }
    }

    /// Renvoie la probabilité de parole (0.0 à 1.0) pour un bloc de 512 échantillons à 16 kHz.
    pub fn speech_probability(&mut self, chunk: &[f32]) -> Result<f32, AdapterError> {
        if chunk.len() != CHUNK_SAMPLES {
            return Err(inference_error(format!("bloc de {} échantillons au lieu de {CHUNK_SAMPLES}", chunk.len())));
        }

        let mut input = Vec::with_capacity(CONTEXT_SAMPLES + CHUNK_SAMPLES);
        input.extend_from_slice(&self.context);
        input.extend_from_slice(chunk);
        self.context = chunk[CHUNK_SAMPLES - CONTEXT_SAMPLES..].to_vec();

        let input_tensor: Tensor = tract_ndarray::Array2::from_shape_vec((1, input.len()), input)
            .map_err(inference_error)?
            .into();
        let outputs = self
            .plan
            .run(tvec!(input_tensor.into(), self.state.clone().into()))
            .map_err(inference_error)?;

        let probability = *outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(inference_error)?
            .iter()
            .next()
            .ok_or_else(|| inference_error("sortie vide"))?;
        self.state = outputs[1].clone().into_tensor();
        Ok(probability)
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::audio::read_wav_mono_16k;

    fn probabilities(path: &str) -> Vec<f32> {
        let samples = read_wav_mono_16k(std::fs::File::open(path).expect("fixture présente")).unwrap();
        let mut vad = SileroVad::load().expect("modèle VAD chargé");
        samples
            .chunks_exact(CHUNK_SAMPLES)
            .map(|chunk| vad.speech_probability(chunk).expect("inférence"))
            .collect()
    }

    fn fixture(name: &str) -> String {
        format!("{}/tests/fixtures/voice/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn detects_the_spoken_segment_after_the_leading_silence() {
        let probs = probabilities(&fixture("fr-lance-discord.wav"));
        let speech: Vec<usize> = probs.iter().enumerate().filter(|(_, p)| **p > 0.5).map(|(i, _)| i).collect();
        let first_ms = speech.first().copied().unwrap_or(0) * CHUNK_SAMPLES * 1000 / 16_000;
        let last_ms = (speech.last().copied().unwrap_or(0) + 1) * CHUNK_SAMPLES * 1000 / 16_000;
        assert!((700..=900).contains(&first_ms), "début de parole : {first_ms} ms");
        assert!((1500..=1900).contains(&last_ms), "fin de parole : {last_ms} ms");
    }

    #[test]
    fn silence_stays_below_the_speech_threshold() {
        let silence = vec![0.0_f32; CHUNK_SAMPLES * 20];
        let mut vad = SileroVad::load().unwrap();
        for chunk in silence.chunks_exact(CHUNK_SAMPLES) {
            assert!(vad.speech_probability(chunk).unwrap() < 0.5);
        }
    }

    #[test]
    fn rejects_blocks_of_the_wrong_size() {
        let mut vad = SileroVad::load().unwrap();
        assert!(matches!(vad.speech_probability(&[0.0; 100]), Err(AdapterError::Inference(_))));
    }
}
