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
}
