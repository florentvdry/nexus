//! Commandes Tauri de la voix. L'interface ne reçoit que des états et des événements.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::session::{EventSink, VoiceSession};
use super::transcribe::{Transcriber, WhisperTranscriber};
use crate::error::AdapterError;
use crate::grants::require_main;

pub const EVENT_CHANNEL: &str = "voice://event";
const MODEL_FILE: &str = "ggml-base.bin";

#[derive(Default)]
pub struct VoiceState {
    session: Mutex<Option<VoiceSession>>,
    transcriber: Mutex<Option<Arc<dyn Transcriber>>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub model_path: String,
    pub model_present: bool,
    pub listening: bool,
}

/// Emplacement attendu du modèle. `NEXUS_WHISPER_MODEL` permet de pointer un autre fichier.
fn model_path(app: &AppHandle) -> Result<PathBuf, AdapterError> {
    if let Ok(path) = std::env::var("NEXUS_WHISPER_MODEL") {
        return Ok(PathBuf::from(path));
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?;
    Ok(directory.join("models").join(MODEL_FILE))
}

fn transcriber_for(app: &AppHandle, state: &VoiceState) -> Result<Arc<dyn Transcriber>, AdapterError> {
    let mut cached = state.transcriber.lock().map_err(|_| AdapterError::TaskFailed("verrou vocal".into()))?;
    if let Some(transcriber) = cached.as_ref() {
        return Ok(Arc::clone(transcriber));
    }
    let transcriber: Arc<dyn Transcriber> = Arc::new(WhisperTranscriber::load(&model_path(app)?)?);
    *cached = Some(Arc::clone(&transcriber));
    Ok(transcriber)
}

#[tauri::command]
pub fn voice_status(webview: tauri::Webview, app: AppHandle, state: State<'_, VoiceState>) -> Result<VoiceStatus, AdapterError> {
    require_main(&webview)?;
    let path = model_path(&app)?;
    let listening = state.session.lock().map(|session| session.is_some()).unwrap_or(false);
    Ok(VoiceStatus {
        model_present: path.is_file(),
        model_path: path.display().to_string(),
        listening,
    })
}

#[tauri::command]
pub fn voice_start(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, VoiceState>,
    language: Option<String>,
) -> Result<(), AdapterError> {
    require_main(&webview)?;
    let mut session = state.session.lock().map_err(|_| AdapterError::TaskFailed("verrou vocal".into()))?;
    if session.is_some() {
        return Err(AdapterError::VoiceAlreadyActive);
    }

    let transcriber = transcriber_for(&app, &state)?;
    let handle = app.clone();
    let sink: EventSink = Arc::new(move |event| {
        let _ = handle.emit(EVENT_CHANNEL, event);
    });
    *session = Some(VoiceSession::start(sink, transcriber, language)?);
    Ok(())
}

#[tauri::command]
pub fn voice_stop(webview: tauri::Webview, state: State<'_, VoiceState>) -> Result<(), AdapterError> {
    require_main(&webview)?;
    let mut session = state.session.lock().map_err(|_| AdapterError::TaskFailed("verrou vocal".into()))?;
    if let Some(active) = session.take() {
        active.stop();
    }
    Ok(())
}
