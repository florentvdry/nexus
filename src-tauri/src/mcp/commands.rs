//! Commandes Tauri des connecteurs MCP. Réservées à l'interface principale (`require_core`). Installer un connecteur
//! et appeler un de ses outils passent par le courtier natif (`permissions::confirm`) : l'accord est donné côté natif,
//! avec tous les paramètres, et l'action n'a lieu qu'après une réponse explicite. Une réponse de l'interface seule ne suffit pas.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};

use super::catalog::{Candidate, Catalog, GITHUB, REGISTRY};
use super::client::{self, Launch, Tool};
use super::store::{Installed, InstalledView, Store};
use crate::error::AdapterError;
use crate::grants::require_main;
use crate::permissions::{self, Broker, Permission, Row};

/// État des connecteurs : le catalogue de la dernière recherche et le registre des connecteurs installés.
pub struct McpState {
    catalog: Arc<Catalog>,
    store: Arc<Store>,
}

/// Ouvre l'état à partir du dossier de données. Sans dossier, les installations ne survivent pas à la session.
pub fn open_state(data_dir: Option<PathBuf>) -> McpState {
    McpState {
        catalog: Arc::new(Catalog::default()),
        store: Arc::new(Store::open(data_dir.map(|directory| directory.join("mcp").join("installed.json")))),
    }
}

/// Lancement d'un connecteur installé. Une variable requise sans valeur arrête tout avant de lancer quoi que ce soit.
fn launch_for(installed: &Installed) -> Result<Launch, AdapterError> {
    if let Some(name) = installed.missing_required().first() {
        return Err(AdapterError::InvalidTarget(format!("valeur manquante pour {name}")));
    }
    Ok(Launch {
        package: installed.package.clone(),
        version: installed.version.clone(),
        env: installed.values.iter().map(|(name, value)| (name.clone(), value.clone())).collect(),
    })
}

fn installed_or_error(store: &Store, id: &str) -> Result<Installed, AdapterError> {
    store.get(id).ok_or_else(|| AdapterError::InvalidTarget("connecteur non installé".into()))
}

/// Cherche un connecteur fiable dans le registre officiel, avec la popularité de son dépôt.
#[tauri::command]
pub async fn mcp_search(state: State<'_, McpState>, webview: tauri::Webview, query: String) -> Result<Vec<Candidate>, AdapterError> {
    require_main(&webview)?;
    let catalog = state.catalog.clone();
    tauri::async_runtime::spawn_blocking(move || catalog.search(REGISTRY, GITHUB, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub fn mcp_installed(state: State<'_, McpState>, webview: tauri::Webview) -> Result<Vec<InstalledView>, AdapterError> {
    require_main(&webview)?;
    Ok(state.store.list().iter().map(Installed::view).collect())
}

/// Lignes affichées au courtier pour une installation : ce qui sera lancé sur ce poste, sans troncature.
fn install_rows(candidate: &Candidate) -> Vec<Row> {
    let names: Vec<&str> = candidate.env.iter().map(|spec| spec.name.as_str()).collect();
    vec![
        Row { key: "connector".into(), value: candidate.title.clone() },
        Row { key: "repository".into(), value: candidate.repository.clone() },
        Row { key: "command".into(), value: format!("npx -y {}@{}", candidate.package, candidate.version) },
        Row { key: "variables".into(), value: if names.is_empty() { "aucune".into() } else { names.join(", ") } },
    ]
}

/// Installe un connecteur trouvé par la dernière recherche, après accord du courtier natif.
/// L'identifiant ne peut pas désigner autre chose.
#[tauri::command]
pub async fn mcp_install(app: AppHandle, broker: State<'_, Broker>, state: State<'_, McpState>, webview: tauri::Webview, id: String) -> Result<InstalledView, AdapterError> {
    require_main(&webview)?;
    let candidate = state
        .catalog
        .get(&id)
        .ok_or_else(|| AdapterError::InvalidTarget("connecteur inconnu : relancez la recherche".into()))?;
    let rows = install_rows(&candidate);
    let broker = broker.inner().clone_handle();
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        permissions::confirm(&app, &broker, Permission::ConnectorInstall, &rows)?;
        Ok(store.install(&candidate)?.view())
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub fn mcp_set_value(state: State<'_, McpState>, webview: tauri::Webview, id: String, name: String, value: String) -> Result<(), AdapterError> {
    require_main(&webview)?;
    state.store.set_value(&id, &name, &value)
}

/// Outils d'un connecteur installé. Lance le serveur le temps de la lecture.
#[tauri::command]
pub async fn mcp_tools(state: State<'_, McpState>, webview: tauri::Webview, id: String) -> Result<Vec<Tool>, AdapterError> {
    require_main(&webview)?;
    let launch = launch_for(&installed_or_error(&state.store, &id)?)?;
    tauri::async_runtime::spawn_blocking(move || client::list_tools(&launch))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Appel d'un outil, après accord du courtier natif, avec les arguments complets. Renvoie le texte de la réponse.
#[tauri::command]
pub async fn mcp_call(
    app: AppHandle,
    broker: State<'_, Broker>,
    state: State<'_, McpState>,
    webview: tauri::Webview,
    id: String,
    tool: String,
    arguments: Value,
) -> Result<String, AdapterError> {
    require_main(&webview)?;
    let launch = launch_for(&installed_or_error(&state.store, &id)?)?;
    let rows = vec![
        Row { key: "connector".into(), value: id.clone() },
        Row { key: "tool".into(), value: tool.clone() },
        Row { key: "arguments".into(), value: arguments.to_string() },
        Row { key: "command".into(), value: format!("npx -y {}@{}", launch.package, launch.version) },
    ];
    let broker = broker.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        permissions::confirm(&app, &broker, Permission::ConnectorCall, &rows)?;
        client::call_tool(&launch, &tool, &arguments)
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::super::catalog::EnvSpec;
    use super::*;

    /// Ce que le courtier affiche avant une installation : la commande exacte, sans troncature, et les variables.
    #[test]
    fn the_install_confirmation_shows_the_exact_command_and_variables() {
        let candidate = Candidate {
            id: "app.example/discord".into(),
            title: "discord".into(),
            description: String::new(),
            repository: "https://github.com/acme/discord-mcp".into(),
            stars: 120,
            package: "@acme/discord-mcp".into(),
            version: "1.2.0".into(),
            env: vec![
                EnvSpec { name: "DISCORD_BOT_TOKEN".into(), required: true, secret: true, description: String::new() },
                EnvSpec { name: "DISCORD_GUILD".into(), required: false, secret: false, description: String::new() },
            ],
        };
        let rows = install_rows(&candidate);
        let value = |key: &str| rows.iter().find(|row| row.key == key).map(|row| row.value.clone()).unwrap();
        assert_eq!(value("command"), "npx -y @acme/discord-mcp@1.2.0");
        assert_eq!(value("variables"), "DISCORD_BOT_TOKEN, DISCORD_GUILD");
        assert_eq!(value("repository"), "https://github.com/acme/discord-mcp");
    }

    #[test]
    fn a_connector_with_a_missing_required_value_is_never_launched() {
        let installed = Installed {
            id: "x".into(),
            title: "x".into(),
            package: "pkg".into(),
            version: "1.0.0".into(),
            env: vec![EnvSpec { name: "TOKEN".into(), required: true, secret: true, description: String::new() }],
            values: Default::default(),
            protected: None,
        };
        let error = launch_for(&installed).unwrap_err();
        assert!(error.to_string().contains("TOKEN"), "{error}");
    }
}
