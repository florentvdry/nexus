//! Kokoro (synthèse vocale neuronale, Apache 2.0) : des phonèmes deviennent une forme d'onde, avec ONNX Runtime.
//!
//! Le modèle quantifié, le vocabulaire et la voix de la langue sont téléchargés et vérifiés par `voice_tts`. Le runtime
//! ONNX est chargé à l'exécution depuis `voices/runtime/`. La session reste en mémoire pour les réponses suivantes.

use std::collections::HashMap;
use std::path::Path;

use ort::{environment::Environment, session::Session, value::Tensor};
use serde_json::Value;

use crate::error::AdapterError;

/// Fréquence d'échantillonnage du modèle.
pub const SAMPLE_RATE: u32 = 24_000;
/// Kokoro est entraîné sur des séquences de 510 jetons, marques de début et de fin comprises.
const MAX_TOKENS: usize = 510;
/// Une séquence plus longue est découpée sur ses espaces, sous cette limite.
const CHUNK_TOKENS: usize = 400;
/// Chaque voix contient 510 styles de 256 valeurs ; le style voulu dépend de la longueur de la séquence.
const STYLE_ROWS: usize = 510;
const STYLE_DIM: usize = 256;
/// Silence entre deux phrases, en échantillons (0,2 s).
pub const PAUSE_SAMPLES: usize = SAMPLE_RATE as usize / 5;

/// Caractère phonétique → jeton, lu dans `tokenizer.json` (`model.vocab`).
pub struct Vocabulary(HashMap<char, i64>);

impl Vocabulary {
    pub fn parse(text: &str) -> Result<Self, AdapterError> {
        let value: Value = serde_json::from_str(text).map_err(|error| AdapterError::ModelInvalid(format!("vocabulaire illisible ({error})")))?;
        let vocab = value["model"]["vocab"].as_object().ok_or_else(|| AdapterError::ModelInvalid("vocabulaire absent".into()))?;
        let mut map = HashMap::new();
        for (key, id) in vocab {
            // Seules les entrées d'un caractère sont des phonèmes ; les autres ne servent pas à la phonétique.
            let mut chars = key.chars();
            if let (Some(symbol), None, Some(id)) = (chars.next(), chars.next(), id.as_i64()) {
                map.insert(symbol, id);
            }
        }
        if map.is_empty() {
            return Err(AdapterError::ModelInvalid("vocabulaire vide".into()));
        }
        Ok(Self(map))
    }

    /// Jetons d'une suite de phonèmes. Un caractère absent du vocabulaire est ignoré.
    pub fn tokens(&self, phonemes: &str) -> Vec<i64> {
        phonemes.chars().filter_map(|symbol| self.0.get(&symbol).copied()).collect()
    }
}

/// Les 510 styles d'une voix, à plat : 510 × 256 flottants.
pub fn read_voice(path: &Path) -> Result<Vec<f32>, AdapterError> {
    let bytes = std::fs::read(path).map_err(|error| AdapterError::ModelMissing(format!("voix Kokoro ({error})")))?;
    if bytes.len() != STYLE_ROWS * STYLE_DIM * 4 {
        return Err(AdapterError::ModelInvalid("voix Kokoro de taille inattendue".into()));
    }
    let (quads, _) = bytes.as_chunks::<4>();
    Ok(quads.iter().map(|quad| f32::from_le_bytes(*quad)).collect())
}

/// Découpe une suite de phonèmes en morceaux de moins de `CHUNK_TOKENS` jetons, toujours sur un espace.
pub fn chunk(vocabulary: &Vocabulary, phonemes: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut size = 0;
    for word in phonemes.split_whitespace() {
        // Un espace compte pour un jeton, comme dans le vocabulaire.
        let cost = vocabulary.tokens(word).len() + 1;
        if size + cost > CHUNK_TOKENS && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            size = 0;
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
        size += cost;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Modèle chargé : session ONNX et vocabulaire. Une seule instance par processus.
pub struct Kokoro {
    _environment: Environment,
    session: Session,
    vocabulary: Vocabulary,
}

impl Kokoro {
    pub fn load(runtime: &Path, model: &Path, tokenizer: &Path) -> Result<Self, AdapterError> {
        let environment = ort::init_from(runtime)
            .map_err(|error| AdapterError::Operation(format!("runtime ONNX indisponible ({error})")))?
            .build()
            .map_err(|error| AdapterError::Operation(format!("runtime ONNX non démarré ({error})")))?;
        let inference = |error: ort::Error| AdapterError::Inference(error.to_string());
        let mut builder = Session::builder(&environment).map_err(inference)?;
        let session = builder.commit_from_file(model).map_err(inference)?;
        let text = std::fs::read_to_string(tokenizer).map_err(|error| AdapterError::ModelMissing(format!("vocabulaire ({error})")))?;
        Ok(Self { _environment: environment, session, vocabulary: Vocabulary::parse(&text)? })
    }

    /// Forme d'onde d'une suite de phonèmes (espaces entre les mots), avec les styles de la voix choisie.
    pub fn speak(&mut self, styles: &[f32], phonemes: &str, speed: f32) -> Result<Vec<f32>, AdapterError> {
        let mut audio = Vec::new();
        for piece in chunk(&self.vocabulary, phonemes) {
            audio.extend(self.infer(styles, &piece, speed)?);
        }
        Ok(audio)
    }

    fn infer(&mut self, styles: &[f32], phonemes: &str, speed: f32) -> Result<Vec<f32>, AdapterError> {
        let ids = self.vocabulary.tokens(phonemes);
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        if ids.len() + 2 > MAX_TOKENS {
            return Err(AdapterError::InvalidTarget("phrase trop longue pour la voix".into()));
        }
        let row = (ids.len() - 1).min(STYLE_ROWS - 1);
        let style = styles[row * STYLE_DIM..(row + 1) * STYLE_DIM].to_vec();
        let mut tokens = Vec::with_capacity(ids.len() + 2);
        tokens.push(0);
        tokens.extend(ids);
        tokens.push(0);

        let inference = |error: ort::Error| AdapterError::Inference(error.to_string());
        let length = tokens.len() as i64;
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => Tensor::from_array((vec![1_i64, length], tokens)).map_err(inference)?,
                "style" => Tensor::from_array((vec![1_i64, STYLE_DIM as i64], style)).map_err(inference)?,
                "speed" => Tensor::from_array((vec![1_i64], vec![speed])).map_err(inference)?,
            ])
            .map_err(inference)?;
        let (_, samples) = outputs[0].try_extract_tensor::<f32>().map_err(inference)?;
        Ok(samples.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un vocabulaire réduit, au format de `tokenizer.json` : la marque `$` et quelques phonèmes.
    const TOKENIZER: &str = r#"{"model": {"vocab": {"$": 0, " ": 16, "b": 44, "ɔ": 76, "ˈ": 156, "x": 66, "ab": 99}}}"#;

    #[test]
    fn the_vocabulary_keeps_single_symbols_and_drops_the_rest() {
        let vocabulary = Vocabulary::parse(TOKENIZER).unwrap();
        assert_eq!(vocabulary.tokens("bɔ"), vec![44, 76]);
        assert_eq!(vocabulary.tokens("ˈb x"), vec![156, 44, 16, 66]);
        // « ab » est une entrée de deux caractères : elle n'est jamais un jeton, seul le « b » isolé compte.
        assert_eq!(vocabulary.tokens("ab"), vec![44]);
    }

    #[test]
    fn a_broken_vocabulary_is_refused() {
        assert!(Vocabulary::parse("pas du json").is_err());
        assert!(Vocabulary::parse(r#"{"model": {}}"#).is_err());
    }

    #[test]
    fn long_phonemes_are_split_on_spaces_under_the_limit() {
        let vocabulary = Vocabulary::parse(TOKENIZER).unwrap();
        let word = "bɔɔɔɔɔɔɔɔɔɔ";
        let text = std::iter::repeat_n(word, 60).collect::<Vec<_>>().join(" ");
        let chunks = chunk(&vocabulary, &text);
        assert!(chunks.len() > 1, "une suite de 60 mots tient en un seul morceau");
        for piece in &chunks {
            let tokens: usize = piece.split(' ').map(|part| vocabulary.tokens(part).len() + 1).sum();
            assert!(tokens <= CHUNK_TOKENS, "un morceau dépasse la limite : {tokens} jetons");
            assert!(!piece.starts_with(' ') && !piece.ends_with(' '));
        }
        assert_eq!(chunks.join(" "), text, "aucun mot n'est perdu ni coupé");
    }

    #[test]
    fn a_voice_must_have_every_style_row() {
        let root = std::env::temp_dir().join(format!("nexus-kokoro-voice-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let wrong = root.join("wrong.bin");
        std::fs::write(&wrong, vec![0_u8; 16]).unwrap();
        assert!(read_voice(&wrong).is_err());

        let right = root.join("right.bin");
        std::fs::write(&right, vec![0_u8; STYLE_ROWS * STYLE_DIM * 4]).unwrap();
        assert_eq!(read_voice(&right).unwrap().len(), STYLE_ROWS * STYLE_DIM);
        let _ = std::fs::remove_dir_all(&root);
    }
}
