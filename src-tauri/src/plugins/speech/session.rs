//! Session d'écoute : micro → VAD → segmentation → transcription. Tourne dans un thread dédié.
//!
//! Le micro est ouvert dans le thread (certains backends audio ne sont pas `Send`). Le démarrage
//! remonte son résultat à l'appelant, pour qu'une erreur de micro ou de modèle soit visible.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;

use super::capture::{self, Capture};
use super::segmenter::{Segmenter, SegmenterConfig};
use super::transcribe::Transcriber;
use super::vad::{SileroVad, CHUNK_SAMPLES};
use crate::error::AdapterError;

const SAMPLE_RATE: usize = 16_000;
/// Silence conservé avant le début détecté, pour ne pas amputer la première consonne.
const PRE_ROLL_SAMPLES: usize = SAMPLE_RATE * 300 / 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum VoiceEvent {
    Listening,
    SpeechStarted,
    Transcribing,
    Transcript { text: String, language: Option<String> },
    Error { code: String, message: String },
    Stopped,
}

pub type EventSink = Arc<dyn Fn(VoiceEvent) + Send + Sync>;

pub fn error_event(error: AdapterError) -> VoiceEvent {
    let value = serde_json::to_value(&error).unwrap_or(serde_json::Value::Null);
    VoiceEvent::Error {
        code: value["code"].as_str().unwrap_or("unknown").to_string(),
        message: value["message"].as_str().unwrap_or_default().to_string(),
    }
}

pub struct VoiceSession {
    stop: Arc<AtomicBool>,
    _worker: JoinHandle<()>,
}

impl VoiceSession {
    /// Ouvre le micro et démarre l'écoute. Renvoie une erreur si le micro ou le VAD est indisponible.
    pub fn start(
        sink: EventSink,
        transcriber: Arc<dyn Transcriber>,
        language: Option<String>,
    ) -> Result<Self, AdapterError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_sender, ready_receiver) = mpsc::channel::<Result<(), AdapterError>>();
        let worker_stop = Arc::clone(&stop);

        let worker = thread::spawn(move || {
            let mut vad = match SileroVad::load() {
                Ok(vad) => vad,
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                    return;
                }
            };
            let capture = match capture::start_default_input() {
                Ok(capture) => capture,
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                    return;
                }
            };
            let _ = ready_sender.send(Ok(()));

            sink(VoiceEvent::Listening);
            run(&worker_stop, &capture, &mut vad, transcriber.as_ref(), language.as_deref(), &sink);
            sink(VoiceEvent::Stopped);
        });

        match ready_receiver.recv() {
            Ok(Ok(())) => Ok(Self { stop, _worker: worker }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(AdapterError::TaskFailed("le thread vocal s'est arrêté au démarrage".into())),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for VoiceSession {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(
    stop: &AtomicBool,
    capture: &Capture,
    vad: &mut SileroVad,
    transcriber: &dyn Transcriber,
    language: Option<&str>,
    sink: &EventSink,
) {
    let mut segmenter = Segmenter::new(SegmenterConfig::default());
    let mut pending: Vec<f32> = Vec::new();
    // Audio conservé pour la transcription. `origin` est l'indice absolu de `buffer[0]`.
    let mut buffer: Vec<f32> = Vec::new();
    let mut origin = 0_usize;

    while !stop.load(Ordering::SeqCst) {
        let batch = match capture.samples.recv_timeout(Duration::from_millis(100)) {
            Ok(batch) => batch,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        pending.extend(batch);

        while pending.len() >= CHUNK_SAMPLES {
            let chunk: Vec<f32> = pending.drain(..CHUNK_SAMPLES).collect();
            buffer.extend_from_slice(&chunk);

            let probability = match vad.speech_probability(&chunk) {
                Ok(probability) => probability,
                Err(error) => {
                    sink(error_event(error));
                    return;
                }
            };

            let was_in_speech = segmenter.in_speech();
            let utterance = segmenter.push(probability);
            if !was_in_speech && segmenter.in_speech() {
                sink(VoiceEvent::SpeechStarted);
            }

            if let Some(utterance) = utterance {
                sink(VoiceEvent::Transcribing);
                let start = utterance.start_sample.saturating_sub(PRE_ROLL_SAMPLES).max(origin) - origin;
                let end = (utterance.end_sample.saturating_sub(origin)).min(buffer.len());
                match transcriber.transcribe(&buffer[start..end], language) {
                    Ok(transcript) if !transcript.text.is_empty() => sink(VoiceEvent::Transcript {
                        text: transcript.text,
                        language: transcript.language,
                    }),
                    Ok(_) => {}
                    Err(error) => sink(error_event(error)),
                }
                sink(VoiceEvent::Listening);
            }

            if !segmenter.in_speech() && buffer.len() > PRE_ROLL_SAMPLES {
                let drop = buffer.len() - PRE_ROLL_SAMPLES;
                buffer.drain(..drop);
                origin += drop;
            }
        }
    }
}
