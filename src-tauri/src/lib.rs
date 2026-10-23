mod apps;
mod error;
mod system;

use apps::{AppStatus, LaunchOutcome, OsEnvironment};
use error::AdapterError;
use system::SystemInfo;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_info, launch_app, list_apps])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de NEXUS");
}
