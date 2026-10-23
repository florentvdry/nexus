//! Capture du microphone par défaut. Le flux est converti en mono 16 kHz et envoyé par canal.

use std::sync::mpsc::{self, Receiver};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use super::audio::{downmix, resample_linear, SAMPLE_RATE};
use crate::error::AdapterError;

pub struct Capture {
    // Le flux doit rester vivant tant que la capture est utilisée.
    _stream: cpal::Stream,
    pub samples: Receiver<Vec<f32>>,
}

pub fn start_default_input() -> Result<Capture, AdapterError> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| AdapterError::AudioDevice("aucun microphone détecté".into()))?;
    let config = device
        .default_input_config()
        .map_err(|error| AdapterError::AudioDevice(error.to_string()))?;
    let channels = config.channels() as usize;
    let device_rate = config.sample_rate();
    let (sender, samples) = mpsc::channel::<Vec<f32>>();

    let send_mono = move |interleaved: Vec<f32>| {
        let mono = resample_linear(&downmix(&interleaved, channels), device_rate, SAMPLE_RATE);
        let _ = sender.send(mono);
    };
    let on_error = |error| eprintln!("NEXUS : erreur du flux audio : {error}");

    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            config.config(),
            move |data: &[f32], _| send_mono(data.to_vec()),
            on_error,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            config.config(),
            move |data: &[i16], _| send_mono(data.iter().map(|value| *value as f32 / 32_768.0).collect()),
            on_error,
            None,
        ),
        other => return Err(AdapterError::AudioDevice(format!("format d'échantillon non géré : {other:?}"))),
    }
    .map_err(|error| AdapterError::AudioDevice(error.to_string()))?;

    stream.play().map_err(|error| AdapterError::AudioDevice(error.to_string()))?;
    Ok(Capture { _stream: stream, samples })
}
