//! Préparation de l'audio : décodage WAV et conversion au format attendu par le VAD et Whisper
//! (16 kHz, mono, flottant).

#[cfg(test)]
use crate::error::AdapterError;


pub const SAMPLE_RATE: u32 = 16_000;

#[cfg(test)]
pub fn read_wav_mono_16k<R: std::io::Read + std::io::Seek>(reader: R) -> Result<Vec<f32>, AdapterError> {
    let mut wav = hound::WavReader::new(reader).map_err(|error| AdapterError::Audio(error.to_string()))?;
    let spec = wav.spec();
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => wav
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|error| AdapterError::Audio(error.to_string()))?,
        hound::SampleFormat::Int => {
            let scale = (1_i64 << (spec.bits_per_sample - 1)) as f32;
            wav.samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 / scale))
                .collect::<Result<_, _>>()
                .map_err(|error| AdapterError::Audio(error.to_string()))?
        }
    };
    let mono = downmix(&interleaved, spec.channels as usize);
    Ok(resample_linear(&mono, spec.sample_rate, SAMPLE_RATE))
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn downmix(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Rééchantillonnage linéaire. Suffisant pour la parole ; la qualité n'est pas l'enjeu ici.
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let output_len = (input.len() as f64 / ratio).floor() as usize;
    let last = input.len() - 1;
    (0..output_len)
        .map(|index| {
            let position = index as f64 * ratio;
            let base = position.floor() as usize;
            let fraction = (position - base as f64) as f32;
            let current = input[base.min(last)];
            let next = input[(base + 1).min(last)];
            current + (next - current) * fraction
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn resample_halves_the_sample_count_when_going_from_32k_to_16k() {
        let input: Vec<f32> = (0..32_000).map(|i| (i as f32 / 100.0).sin()).collect();
        assert_eq!(resample_linear(&input, 32_000, 16_000).len(), 16_000);
    }

    #[test]
    fn reads_16_bit_pcm_wav_and_normalises_to_unit_range() {
        let mut bytes = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
            let mut writer = hound::WavWriter::new(&mut bytes, spec).unwrap();
            writer.write_sample(i16::MAX).unwrap();
            writer.write_sample(i16::MIN).unwrap();
            writer.finalize().unwrap();
        }
        bytes.set_position(0);
        let samples = read_wav_mono_16k(bytes).unwrap();
        assert!((samples[0] - 1.0).abs() < 1e-3);
        assert!((samples[1] + 1.0).abs() < 1e-3);
    }

    #[test]
    fn rejects_non_wav_input_with_audio_error() {
        let error = read_wav_mono_16k(Cursor::new(b"pas un wav".to_vec())).unwrap_err();
        assert!(matches!(error, AdapterError::Audio(_)));
    }
}
