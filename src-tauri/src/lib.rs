pub mod error;
pub mod grants;
pub mod host;
pub mod journal;
pub mod permissions;
pub mod plugins;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};

use error::AdapterError;
use grants::{require, require_core};
use journal::{Journal, JournalEntry};
use host::runner;
use permissions::{Broker, Permission, Row};
use plugins as connectors;
use plugins::actions::apps::{self, AppStatus, LaunchOutcome, OsEnvironment};
use plugins::actions::files::{self, FileEntry, Operation, SearchQuery};
use plugins::actions::processes::{self, ProcessEntry};
use plugins::actions::windows::{self as desktop_windows, WindowEntry};
use plugins::actions::system::{self, SystemInfo};
use plugins::agents::claude_code::{self, AgentEvent, Detection, Runs};
use plugins::report::{ConnectorReport, ConnectorRequest};
use plugins::speech::commands::{self, VoiceState};

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

fn blocking_failed(error: tauri::Error) -> AdapterError {
    AdapterError::TaskFailed(error.to_string())
}

#[tauri::command]
async fn processes_list(caller: String, limit: usize) -> Result<Vec<ProcessEntry>, AdapterError> {
    require(&caller, Permission::SystemRead)?;
    tauri::async_runtime::spawn_blocking(move || processes::top_by_memory(limit.clamp(1, 50)))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))
}

#[tauri::command]
async fn files_search(caller: String, query: SearchQuery) -> Result<Vec<FileEntry>, AdapterError> {
    require(&caller, Permission::FileRead)?;
    tauri::async_runtime::spawn_blocking(move || files::search(&files::allowed_roots(), &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Opération sur un fichier : aperçu, confirmation par le courtier, puis exécution. Rien n'est modifié sans accord.
#[tauri::command]
async fn files_operate(app: AppHandle, broker: State<'_, Broker>, caller: String, operation: Operation) -> Result<String, AdapterError> {
    let broker = broker.inner().clone_handle();
    let permission = if operation.is_deletion() { Permission::FileDelete } else { Permission::FileWrite };
    require(&caller, permission)?;
    let roots = files::allowed_roots();
    tauri::async_runtime::spawn_blocking(move || {
        let plan = files::plan(operation, &roots)?;
        let mut rows: Vec<Row> = plan.rows.iter().map(|(key, value)| Row { key: key.clone(), value: value.clone() }).collect();
        rows.push(Row { key: "requester".into(), value: caller });
        permissions::confirm(&app, &broker, permission, &rows)?;
        files::apply(&plan)
    })
    .await
    .map_err(blocking_failed)?
}

#[tauri::command]
async fn agent_detect(caller: String) -> Result<Detection, AdapterError> {
    require(&caller, Permission::AgentRun)?;
    tauri::async_runtime::spawn_blocking(claude_code::detect)
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))
}

/// Lance Claude Code dans un projet. Demande d'abord la confirmation ; renvoie dès que le run est démarré.
/// La progression et le résultat arrivent par l'événement `agents://event`, identifiés par `run_id`.
#[tauri::command]
async fn agent_run(
    app: AppHandle,
    broker: State<'_, Broker>,
    runs: State<'_, Runs>,
    caller: String,
    run_id: String,
    project: String,
    prompt: String,
) -> Result<(), AdapterError> {
    require(&caller, Permission::AgentRun)?;
    let binary: PathBuf = claude_code::locate().ok_or_else(|| AdapterError::AgentNotInstalled("claude".into()))?;
    let project_path = PathBuf::from(project.trim().trim_matches('"'));
    if !project_path.is_absolute() || !project_path.is_dir() {
        return Err(AdapterError::InvalidPath(project));
    }
    let prompt = claude_code::validate_prompt(&prompt)?;

    let shown_prompt: String = prompt.chars().take(300).collect();
    let rows = vec![
        Row { key: "project".into(), value: project_path.display().to_string() },
        Row { key: "prompt".into(), value: shown_prompt },
        Row { key: "requester".into(), value: caller },
    ];
    let confirm_broker = broker.inner().clone_handle();
    let confirm_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || permissions::confirm(&confirm_app, &confirm_broker, Permission::AgentRun, &rows))
        .await
        .map_err(blocking_failed)??;

    let control = runs.inner().register(&run_id);
    let runs_handle = runs.inner().clone_handle();
    let sink_app = app.clone();
    let id = run_id.clone();
    std::thread::spawn(move || {
        let mut emit = |event: AgentEvent| {
            let _ = sink_app.emit(claude_code::EVENT_CHANNEL, claude_code::AgentEnvelope { run_id: id.clone(), event });
        };
        claude_code::run(&binary, &project_path, &prompt, claude_code::DEFAULT_BUDGET_USD, &control, &mut emit);
        runs_handle.finish(&id);
    });
    Ok(())
}

#[tauri::command]
async fn window_list(caller: String) -> Result<Vec<WindowEntry>, AdapterError> {
    require(&caller, Permission::WindowRead)?;
    tauri::async_runtime::spawn_blocking(desktop_windows::list).await.map_err(blocking_failed)?
}

/// Ramener une fenêtre au premier plan : confirmation d'abord, puis action sur la fenêtre revérifiée.
#[tauri::command]
async fn window_focus(app: AppHandle, broker: State<'_, Broker>, caller: String, id: usize) -> Result<(), AdapterError> {
    require(&caller, Permission::WindowControl)?;
    window_action(app, broker.inner().clone_handle(), caller, id, WindowAction::Focus).await
}

/// Demander la fermeture d'une fenêtre : l'application reste libre de refuser ou de demander d'enregistrer.
#[tauri::command]
async fn window_close(app: AppHandle, broker: State<'_, Broker>, caller: String, id: usize) -> Result<(), AdapterError> {
    require(&caller, Permission::WindowControl)?;
    window_action(app, broker.inner().clone_handle(), caller, id, WindowAction::Close).await
}

#[derive(Clone, Copy)]
enum WindowAction {
    Focus,
    Close,
}

async fn window_action(app: AppHandle, broker: Broker, caller: String, id: usize, action: WindowAction) -> Result<(), AdapterError> {
    tauri::async_runtime::spawn_blocking(move || {
        let window = desktop_windows::describe(id)?;
        let rows = vec![
            Row { key: "window".into(), value: window.title.clone() },
            Row { key: "process".into(), value: window.process.clone() },
            Row { key: "requester".into(), value: caller },
        ];
        permissions::confirm(&app, &broker, Permission::WindowControl, &rows)?;
        match action {
            WindowAction::Focus => desktop_windows::focus(id),
            WindowAction::Close => desktop_windows::close(id),
        }
    })
    .await
    .map_err(blocking_failed)?
}

/// Journal ouvert au démarrage. `None` si le fichier n'a pas pu être ouvert : l'interface le signale.
pub struct JournalStore(Option<Journal>);

impl JournalStore {
    fn get(&self) -> Result<&Journal, AdapterError> {
        self.0.as_ref().ok_or_else(|| AdapterError::Operation("journal indisponible sur cette installation".into()))
    }
}

// Le journal est réservé à l'interface : un plugin ne peut ni lire ni alimenter l'historique.
#[tauri::command]
fn journal_status(store: State<'_, JournalStore>, caller: String) -> Result<bool, AdapterError> {
    require_core(&caller)?;
    store.get()?.enabled()
}

#[tauri::command]
fn journal_set_enabled(store: State<'_, JournalStore>, caller: String, enabled: bool) -> Result<(), AdapterError> {
    require_core(&caller)?;
    store.get()?.set_enabled(enabled)
}

#[tauri::command]
fn journal_record(store: State<'_, JournalStore>, caller: String, kind: String, text: String) -> Result<bool, AdapterError> {
    require_core(&caller)?;
    store.get()?.record(&kind, &text)
}

#[tauri::command]
fn journal_list(store: State<'_, JournalStore>, caller: String, limit: usize) -> Result<Vec<JournalEntry>, AdapterError> {
    require_core(&caller)?;
    store.get()?.list(limit)
}

#[tauri::command]
fn journal_clear(store: State<'_, JournalStore>, caller: String) -> Result<(), AdapterError> {
    require_core(&caller)?;
    store.get()?.clear()
}

#[tauri::command]
fn agent_cancel(runs: State<'_, Runs>, caller: String, run_id: String) -> Result<bool, AdapterError> {
    require(&caller, Permission::AgentRun)?;
    Ok(runs.cancel(&run_id))
}

/// Seule l'interface répond aux confirmations : un plugin ne peut pas approuver sa propre demande.
#[tauri::command]
fn permission_answer(broker: State<'_, Broker>, caller: String, id: String, approved: bool) -> Result<(), AdapterError> {
    require_core(&caller)?;
    broker.answer(&id, approved)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionStatus {
    id: &'static str,
    tier: permissions::Tier,
}

#[tauri::command]
fn permissions_status() -> Vec<PermissionStatus> {
    permissions::status().into_iter().map(|(id, tier)| PermissionStatus { id, tier }).collect()
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

fn open_journal(app: &tauri::App) -> Option<Journal> {
    let directory = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&directory).ok()?;
    match Journal::open(&directory.join("journal.db")) {
        Ok(journal) => Some(journal),
        Err(error) => {
            eprintln!("NEXUS : journal indisponible : {error}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(shortcut_plugin())
        .setup(|app| {
            app.manage(VoiceState::default());
            app.manage(Broker::default());
            app.manage(Runs::default());
            app.manage(JournalStore(open_journal(app)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            launch_app,
            list_apps,
            commands::voice_status,
            commands::voice_start,
            commands::voice_stop,
            osint_run,
            processes_list,
            files_search,
            files_operate,
            window_list,
            window_focus,
            window_close,
            agent_detect,
            agent_run,
            agent_cancel,
            permission_answer,
            permissions_status,
            journal_status,
            journal_set_enabled,
            journal_record,
            journal_list,
            journal_clear
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de NEXUS");
}
