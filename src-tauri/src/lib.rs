pub mod error;
pub mod host;
pub mod plugins;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};

use error::AdapterError;
use host::runner;
use plugins::actions::apps::{self, AppStatus, LaunchOutcome, OsEnvironment};
use plugins::actions::system::{self, SystemInfo};
use plugins::report::{ConnectorReport, ConnectorRequest};
use plugins::speech::commands::{self, VoiceState};
use plugins as connectors;

/// Raccourci pour démarrer ou arrêter l'écoute, même lorsque NEXUS n'a pas le focus.
pub const VOICE_SHORTCUT: &str = "Ctrl+Alt+Space";
pub const VOICE_TOGGLE_EVENT: &str = "voice://toggle";

#[tauri::command]
async fn system_info() -> Result<SystemInfo, AdapterError> {
    tauri::async_runtime::spawn_blocking(system::read_system_info)
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))
}

#[tauri::command]
async fn launch_app(app_id: String) -> Result<LaunchOutcome, AdapterError> {
    apps::launch(&app_id, &OsEnvironment)
}

#[tauri::command]
async fn list_apps() -> Vec<AppStatus> {
    apps::list(&OsEnvironment)
}

#[tauri::command]
async fn osint_run(request: ConnectorRequest) -> Result<ConnectorReport, AdapterError> {
    if !connectors::CONNECTORS.contains(&request.connector.as_str()) {
        return Err(AdapterError::UnknownConnector(request.connector));
    }
    let timeout = connectors::timeout_for(&request.connector);
    tauri::async_runtime::spawn_blocking(move || {
        let worker = runner::worker_path()?;
        runner::run_isolated(&worker, &request, timeout)
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Un raccourci déjà utilisé par une autre application ne doit pas empêcher NEXUS de démarrer.
fn shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let handler = |app: &tauri::AppHandle, _shortcut: &tauri_plugin_global_shortcut::Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent| {
        if event.state() == ShortcutState::Pressed {
            let _ = app.emit(VOICE_TOGGLE_EVENT, ());
        }
    };
    match ShortcutBuilder::new().with_shortcut(VOICE_SHORTCUT) {
        Ok(builder) => builder.with_handler(handler).build(),
        Err(error) => {
            eprintln!("NEXUS : raccourci {VOICE_SHORTCUT} indisponible : {error}");
            ShortcutBuilder::new().build()
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(shortcut_plugin())
        .setup(|app| {
            app.manage(VoiceState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            launch_app,
            list_apps,
            commands::voice_status,
            commands::voice_start,
            commands::voice_stop,
            osint_run
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de NEXUS");
}
