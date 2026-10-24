pub mod error;
pub mod grants;
pub mod hardware;
pub mod host;
pub mod model_download;
pub mod ollama;
pub mod journal;
pub mod mcp;
pub mod memory;
pub mod nim;
pub mod permissions;
pub mod schedule;
pub mod screen;
pub mod agenda;
pub mod power;
pub mod startup;
pub mod web;
pub mod plugin_store;
pub mod plugins;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, GlobalShortcutExt, ShortcutState};

use error::AdapterError;
use grants::{require, require_core};
use journal::{Journal, JournalEntry};
use plugin_store::{Installed, PackData, Prepared, Store};
use std::sync::Arc;
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

/// Classement d'une demande par le modèle local choisi par l'utilisateur (Ollama, sur ce poste uniquement).
/// Sans modèle, ou si Ollama ne répond pas, l'erreur fait retomber l'interface sur les règles.
#[tauri::command]
async fn model_classify(caller: String, text: String, model: String, memories: Vec<String>) -> Result<serde_json::Value, AdapterError> {
    require_core(&caller)?;
    if text.trim().is_empty() {
        return Err(AdapterError::InvalidTarget("demande vide".into()));
    }
    tauri::async_runtime::spawn_blocking(move || ollama::classify_at(ollama::ENDPOINT, &model, &text, &memories))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Question sur une capture d'écran, par le modèle de vision choisi. Seul ce poste reçoit l'image.
#[tauri::command]
async fn vision_ask(caller: String, model: String, question: String, image: String) -> Result<String, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || ollama::vision_at(ollama::ENDPOINT, &model, &question, &image))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Réponse JSON libre du modèle local, pour choisir un outil d'un connecteur MCP. Même garde-fous que `model_classify` :
/// la réponse est renvoyée à l'interface, qui la valide avant tout appel.
#[tauri::command]
async fn model_json(caller: String, model: String, system: String, user: String) -> Result<serde_json::Value, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || ollama::answer_json_at(ollama::ENDPOINT, &model, &system, &user))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Télécharge un modèle via Ollama, avec progression émise vers l'interface. Réservé à l'interface, après accord
/// explicite de l'utilisateur sur le parcours (taille affichée avant).
#[tauri::command]
async fn ollama_pull(app: AppHandle, caller: String, model: String) -> Result<(), AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        let name = model.clone();
        ollama::pull_at(ollama::ENDPOINT, &model, |step| {
            let _ = app.emit(
                ollama::PULL_EVENT,
                serde_json::json!({ "model": name, "status": step.status, "completed": step.completed, "total": step.total }),
            );
        })
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Installe Ollama (winget) après accord de l'utilisateur dans le parcours. Les étapes arrivent par `ollama://install`.
#[tauri::command]
async fn ollama_install(app: AppHandle, caller: String) -> Result<(), AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        ollama::install_ollama(ollama::ENDPOINT, |stage| {
            let _ = app.emit(ollama::INSTALL_EVENT, serde_json::json!({ "stage": stage }));
        })
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// État d'Ollama et modèles installés, pour l'interface. Ne renvoie pas d'erreur : « non joignable » est une réponse.
#[tauri::command]
async fn ollama_status(caller: String) -> Result<ollama::OllamaStatus, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(|| ollama::status_at(ollama::ENDPOINT))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))
}

/// Profil pour le choix du modèle local : réservé à l'interface, lecture seule.
#[tauri::command]
async fn hardware_profile(caller: String) -> Result<hardware::HardwareProfile, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(hardware::read_profile)
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

/// Magasin des plugins ouvert au démarrage. `None` si le dossier de données n'a pas pu être ouvert.
pub struct PluginStore(Option<Arc<Store>>);

impl PluginStore {
    fn get(&self) -> Result<Arc<Store>, AdapterError> {
        self.0.clone().ok_or_else(|| AdapterError::Operation("magasin des plugins indisponible sur cette installation".into()))
    }
}

fn plugin_requester_row(caller: &str) -> Row {
    Row { key: "requester".into(), value: caller.to_string() }
}

/// Étape 1 : examiner une source. Une adresse Git est téléchargée (sans exécution) seulement après accord.
#[tauri::command]
async fn plugin_prepare(app: AppHandle, broker: State<'_, Broker>, store: State<'_, PluginStore>, caller: String, source: String) -> Result<Prepared, AdapterError> {
    require(&caller, Permission::PluginManage)?;
    let store = store.get()?;
    let broker = broker.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        let rows = vec![Row { key: "source".into(), value: source.clone() }, plugin_requester_row(&caller)];
        permissions::confirm(&app, &broker, Permission::PluginManage, &rows)?;
        if source.starts_with("https://") {
            store.prepare_git(&source)
        } else {
            store.prepare_folder(std::path::Path::new(&source))
        }
    })
    .await
    .map_err(blocking_failed)?
}

/// Étape 2 : installer le plugin examiné. L'accord porte sur l'empreinte affichée : tout changement entre-temps est refusé.
#[tauri::command]
async fn plugin_install(
    app: AppHandle,
    broker: State<'_, Broker>,
    store: State<'_, PluginStore>,
    caller: String,
    staging_id: String,
    digest: String,
) -> Result<Installed, AdapterError> {
    require(&caller, Permission::PluginManage)?;
    let store = store.get()?;
    let broker = broker.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = store.staged(&staging_id)?;
        let previous = store.list()?.into_iter().find(|installed| installed.id == prepared.id);
        let mut rows = vec![
            Row { key: "plugin".into(), value: format!("{} — {}", prepared.id, prepared.name) },
            Row { key: "version".into(), value: prepared.version.clone() },
            Row { key: "source".into(), value: prepared.source.clone() },
            Row { key: "commit".into(), value: prepared.commit.clone().unwrap_or_else(|| "dossier local".into()) },
            Row { key: "kinds".into(), value: prepared.kinds.join(", ") },
            Row { key: "digest".into(), value: prepared.digest.chars().take(23).collect() },
        ];
        if !prepared.permissions.is_empty() {
            let granted: Vec<String> = prepared.permissions.iter().map(|decl| format!("{} — {}", decl.id, decl.reason)).collect();
            rows.push(Row { key: "permissions".into(), value: granted.join(" ; ") });
        }
        if !prepared.commands.is_empty() {
            rows.push(Row { key: "commands".into(), value: prepared.commands.join(", ") });
        }
        if let Some(previous) = previous {
            rows.push(Row { key: "previous".into(), value: previous.version });
        }
        rows.push(plugin_requester_row(&caller));
        permissions::confirm(&app, &broker, Permission::PluginManage, &rows)?;
        store.install(&staging_id, &digest)
    })
    .await
    .map_err(blocking_failed)?
}

#[tauri::command]
async fn plugin_remove(app: AppHandle, broker: State<'_, Broker>, store: State<'_, PluginStore>, caller: String, id: String) -> Result<(), AdapterError> {
    require(&caller, Permission::PluginManage)?;
    let store = store.get()?;
    let broker = broker.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        let installed = store.list()?.into_iter().find(|entry| entry.id == id).ok_or_else(|| AdapterError::InvalidTarget(id.clone()))?;
        let rows = vec![
            Row { key: "plugin".into(), value: format!("{} — {}", installed.id, installed.name) },
            Row { key: "version".into(), value: installed.version },
            plugin_requester_row(&caller),
        ];
        permissions::confirm(&app, &broker, Permission::PluginManage, &rows)?;
        store.remove(&id)
    })
    .await
    .map_err(blocking_failed)?
}

/// Exécute une commande d'un plugin WebAssembly. Seul le gestionnaire de plugins peut appeler cette commande ;
/// le texte est borné avant d'atteindre le module.
#[tauri::command]
async fn plugin_run(caller: String, store: State<'_, PluginStore>, plugin_id: String, command: String, text: String) -> Result<plugin_store::sandbox::ActionOutput, AdapterError> {
    require(&caller, Permission::PluginManage)?;
    if text.chars().count() > 2_000 {
        return Err(AdapterError::InvalidTarget("texte trop long".into()));
    }
    let store = store.get()?;
    tauri::async_runtime::spawn_blocking(move || store.run_action(&plugin_id, &command, &text)).await.map_err(blocking_failed)?
}

#[tauri::command]
async fn plugin_list(caller: String, store: State<'_, PluginStore>) -> Result<Vec<Installed>, AdapterError> {
    require(&caller, Permission::PluginManage)?;
    let store = store.get()?;
    tauri::async_runtime::spawn_blocking(move || store.list()).await.map_err(blocking_failed)?
}

/// Paquets actifs, lus par l'interface seule pour enrichir la compréhension des commandes.
#[tauri::command]
async fn plugin_packs(caller: String, store: State<'_, PluginStore>) -> Result<Vec<PackData>, AdapterError> {
    require_core(&caller)?;
    let store = store.get()?;
    tauri::async_runtime::spawn_blocking(move || store.packs()).await.map_err(blocking_failed)?
}

#[tauri::command]
async fn plugin_index(caller: String) -> Result<Vec<plugin_store::index::IndexEntry>, AdapterError> {
    require(&caller, Permission::PluginManage)?;
    let url = plugin_store::index::configured_url()
        .ok_or_else(|| AdapterError::Operation(format!("aucun catalogue configuré : définis {} avec une adresse HTTPS", plugin_store::index::INDEX_ENV)))?;
    tauri::async_runtime::spawn_blocking(move || plugin_store::index::fetch(&url)).await.map_err(blocking_failed)?
}

#[tauri::command]
fn agent_cancel(runs: State<'_, Runs>, caller: String, run_id: String) -> Result<bool, AdapterError> {
    require(&caller, Permission::AgentRun)?;
    Ok(runs.cancel(&run_id))
}

/// Seule l'interface répond aux confirmations : un plugin ne peut pas approuver sa propre demande.
/// `remember` : « toujours autoriser » pour le dossier ou le projet de la demande (refusé pour les actions non mémorisables).
#[tauri::command]
fn permission_answer(broker: State<'_, Broker>, caller: String, id: String, approved: bool, remember: Option<bool>) -> Result<(), AdapterError> {
    require_core(&caller)?;
    broker.answer_with(&id, approved, remember.unwrap_or(false))
}

/// Autorisations mémorisées, lues par les réglages.
#[tauri::command]
fn permission_rules(broker: State<'_, Broker>, caller: String) -> Result<Vec<permissions::Rule>, AdapterError> {
    require_core(&caller)?;
    Ok(broker.rules())
}

#[tauri::command]
fn permission_revoke(broker: State<'_, Broker>, caller: String, id: String) -> Result<bool, AdapterError> {
    require_core(&caller)?;
    broker.revoke(&id)
}

/// Actions approuvées automatiquement, les plus récentes d'abord.
#[tauri::command]
fn permission_audit(broker: State<'_, Broker>, caller: String) -> Result<Vec<permissions::AutoEntry>, AdapterError> {
    require_core(&caller)?;
    Ok(broker.audit())
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
    ShortcutBuilder::new().with_handler(handler).build()
}

/// L'enregistrement se fait après l'initialisation du plugin : un raccourci déjà pris par une autre application
/// (Windows le refuse) doit seulement être signalé, jamais empêcher NEXUS de démarrer.
fn register_voice_shortcut(app: &tauri::App) {
    if let Err(error) = app.global_shortcut().register(VOICE_SHORTCUT) {
        eprintln!("NEXUS : raccourci {VOICE_SHORTCUT} indisponible : {error}");
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

/// Courtier avec les autorisations mémorisées du dossier de données. Sans dossier, les règles restent en mémoire.
fn open_broker(app: &tauri::App) -> Broker {
    match app.path().app_data_dir() {
        Ok(directory) => Broker::load(directory.join("permission_rules.json")),
        Err(_) => Broker::default(),
    }
}

fn open_plugin_store(app: &tauri::App) -> Option<Arc<Store>> {
    let root = app.path().app_data_dir().ok()?.join("plugins");
    let known: Vec<&'static str> = plugins::actions::apps::CATALOG.iter().map(|spec| spec.id).collect();
    Store::new(root, known).ok().map(Arc::new)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(shortcut_plugin())
        .setup(|app| {
            register_voice_shortcut(app);
            app.manage(VoiceState::default());
            app.manage(open_broker(app));
            app.manage(Runs::default());
            app.manage(JournalStore(open_journal(app)));
            app.manage(PluginStore(open_plugin_store(app)));
            app.manage(mcp::commands::open_state(app.path().app_data_dir().ok()));
            app.manage(memory::open_store(app.path().app_data_dir().ok()));
            app.manage(schedule::open_store(app.path().app_data_dir().ok()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            hardware_profile,
            model_classify,
            model_json,
            mcp::commands::mcp_search,
            mcp::commands::mcp_installed,
            mcp::commands::mcp_install,
            mcp::commands::mcp_set_value,
            mcp::commands::mcp_tools,
            mcp::commands::mcp_call,
            memory::memory_list,
            memory::memory_add,
            memory::memory_remove,
            memory::memory_forget,
            memory::memory_clear,
            schedule::schedule_list,
            schedule::schedule_save,
            web::web_summary,
            web::web_photo,
            web::web_news,
            web::web_headlines,
            web::web_news_search,
            web::web_search,
            web::web_read,
            startup::startup_status,
            startup::startup_set,
            power::battery_status,
            agenda::agenda_read,
            screen::screen_capture,
            nim::nim_classify,
            vision_ask,
            ollama_status,
            ollama_pull,
            ollama_install,
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
            permission_rules,
            permission_revoke,
            permission_audit,
            permissions_status,
            journal_status,
            journal_set_enabled,
            journal_record,
            journal_list,
            journal_clear,
            plugin_prepare,
            plugin_install,
            plugin_remove,
            plugin_list,
            plugin_run,
            plugin_packs,
            plugin_index
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de NEXUS");
}
