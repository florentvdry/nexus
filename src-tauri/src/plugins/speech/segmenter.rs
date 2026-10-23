//! Découpe le flux en énoncés à partir des probabilités du VAD. Logique pure, sans audio.
//!
//! Un énoncé commence après une parole suffisamment longue et se termine après un silence
//! suffisamment long, pour ne pas couper les pauses courtes entre deux mots.

use super::vad::CHUNK_SAMPLES;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SegmenterConfig {
    pub threshold: f32,
    pub min_speech_chunks: usize,
    pub min_silence_chunks: usize,
    pub max_utterance_chunks: usize,
}

impl Default for SegmenterConfig {
    fn default() -> Self {
        Self {
            threshold: 0.5,
            // 250 ms de parole pour ignorer les bruits brefs.
            min_speech_chunks: 8,
            // 600 ms de silence pour clore un énoncé.
            min_silence_chunks: 19,
            // 15 s maximum : au-delà, l'énoncé est coupé.
            max_utterance_chunks: 470,
        }
    }
}

/// Énoncé, en indices d'échantillons absolus depuis le début du flux.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Utterance {
    pub start_sample: usize,
    pub end_sample: usize,
}

#[derive(Debug)]
pub struct Segmenter {
    config: SegmenterConfig,
    chunk_index: usize,
    speech_run: usize,
    silence_run: usize,
    in_speech: bool,
    start_chunk: usize,
    last_speech_chunk: usize,
}

impl Segmenter {
    pub fn new(config: SegmenterConfig) -> Self {
        Self {
            config,
            chunk_index: 0,
            speech_run: 0,
            silence_run: 0,
            in_speech: false,
            start_chunk: 0,
            last_speech_chunk: 0,
        }
    }

    pub fn in_speech(&self) -> bool {
        self.in_speech
    }

    /// Traite la probabilité du bloc suivant. Renvoie un énoncé lorsqu'il est terminé.
    pub fn push(&mut self, probability: f32) -> Option<Utterance> {
        let index = self.chunk_index;
        self.chunk_index += 1;

        if probability >= self.config.threshold {
            self.silence_run = 0;
            self.speech_run += 1;
            if !self.in_speech && self.speech_run >= self.config.min_speech_chunks {
                self.in_speech = true;
                self.start_chunk = index + 1 - self.speech_run;
            }
            if self.in_speech {
                self.last_speech_chunk = index;
                if index + 1 - self.start_chunk >= self.config.max_utterance_chunks {
                    return self.close(index + 1);
                }
            }
            return None;
        }

        self.speech_run = 0;
        if !self.in_speech {
            return None;
        }
        self.silence_run += 1;
        if self.silence_run >= self.config.min_silence_chunks {
            return self.close(self.last_speech_chunk + 1);
        }
        None
    }

    fn close(&mut self, end_chunk: usize) -> Option<Utterance> {
        let utterance = Utterance {
            start_sample: self.start_chunk * CHUNK_SAMPLES,
            end_sample: end_chunk * CHUNK_SAMPLES,
        };
        self.in_speech = false;
        self.silence_run = 0;
        self.speech_run = 0;
        Some(utterance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(config: SegmenterConfig, pattern: &[f32]) -> Vec<Utterance> {
        let mut segmenter = Segmenter::new(config);
        pattern.iter().filter_map(|probability| segmenter.push(*probability)).collect()
    }

    fn config() -> SegmenterConfig {
        SegmenterConfig { threshold: 0.5, min_speech_chunks: 2, min_silence_chunks: 3, max_utterance_chunks: 10 }
    }

    #[test]
    fn emits_one_utterance_when_speech_is_followed_by_enough_silence() {
        let pattern = [0.0, 0.9, 0.9, 0.9, 0.0, 0.0, 0.0];
        assert_eq!(
            run(config(), &pattern),
            vec![Utterance { start_sample: CHUNK_SAMPLES, end_sample: 4 * CHUNK_SAMPLES }]
        );
    }

    #[test]
    fn short_pauses_do_not_split_an_utterance() {
        let pattern = [0.9, 0.9, 0.0, 0.0, 0.9, 0.9, 0.0, 0.0, 0.0];
        let utterances = run(config(), &pattern);
        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].end_sample, 6 * CHUNK_SAMPLES);
    }

    #[test]
    fn ignores_isolated_clicks_shorter_than_the_minimum_speech() {
        assert!(run(config(), &[0.9, 0.0, 0.0, 0.0, 0.0]).is_empty());
    }

    #[test]
    fn cuts_utterances_longer_than_the_maximum() {
        let pattern = vec![0.9; 12];
        let utterances = run(config(), &pattern);
        assert_eq!(utterances, vec![Utterance { start_sample: 0, end_sample: 10 * CHUNK_SAMPLES }]);
    }

    #[test]
    fn utterance_still_open_at_end_of_stream_is_not_emitted() {
        assert!(run(config(), &[0.9, 0.9, 0.9]).is_empty());
    }
}
