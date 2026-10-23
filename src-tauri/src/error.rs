use serde::Serialize;
use thiserror::Error;

/// Erreur renvoyée au frontend. Le `code` est stable, le `message` est destiné à l'affichage.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "kebab-case")]
pub enum AdapterError {
    #[error("application inconnue : {0}")]
    UnknownApp(String),
    #[error("application non installée : {0}")]
    NotInstalled(String),
    #[error("échec du lancement : {0}")]
    LaunchFailed(String),
    #[error("tâche système interrompue : {0}")]
    TaskFailed(String),
    #[error("modèle de reconnaissance vocale absent : {0}")]
    ModelMissing(String),
    #[error("fichier de modèle invalide : {0}")]
    ModelInvalid(String),
    #[error("microphone indisponible : {0}")]
    AudioDevice(String),
    /// Décodage de fichiers audio : utilisé par les tests et l'analyse de fichiers (phase 3).
    #[allow(dead_code)]
    #[error("fichier audio invalide : {0}")]
    Audio(String),
    #[error("échec de l'inférence : {0}")]
    Inference(String),
    #[error("une session vocale est déjà active")]
    VoiceAlreadyActive,
    #[error("connecteur inconnu : {0}")]
    UnknownConnector(String),
    #[error("cible invalide : {0}")]
    InvalidTarget(String),
    #[error("échec du connecteur : {0}")]
    ConnectorFailed(String),
    #[error("délai dépassé pour le connecteur : {0}")]
    ConnectorTimeout(String),
}
