//! Pipeline vocal hors ligne : micro → Silero VAD → segmentation → whisper.cpp.
//!
//! Aucun flux audio n'est envoyé à un service externe. Le microphone n'est ouvert que pendant une
//! session d'écoute demandée par l'utilisateur.

pub mod audio;
pub mod capture;
pub mod commands;
pub mod segmenter;
pub mod session;
pub mod transcribe;
pub mod vad;
