//! Commandes Tauri des connecteurs MCP. Réservées à l'interface principale (`require_core`). Installer un connecteur
//! et appeler un de ses outils passent par le courtier natif (`permissions::confirm`) : l'accord est donné côté natif,
//! avec tous les paramètres, et l'action n'a lieu qu'après une réponse explicite. Une réponse de l'interface seule ne suffit pas.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};

use super::catalog::{Candidate, Catalog, GITHUB, REGISTRY};
use super::client::{self, Launch, Tool};
use super::scope::{self, ToolClass};
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
/// Ce que NEXUS ne limite pas, dit avant l'accord : un connecteur reste du code tiers avec les droits de l'utilisateur.
pub const ISOLATION_NOTE: &str = "job object et environnement réduits ; réseau et fichiers non restreints (il agit avec vos droits)";

fn install_rows(candidate: &Candidate) -> Vec<Row> {
    let names: Vec<&str> = candidate.env.iter().map(|spec| spec.name.as_str()).collect();
    vec![
        Row { key: "connector".into(), value: candidate.title.clone() },
        Row { key: "repository".into(), value: candidate.repository.clone() },
        Row { key: "command".into(), value: format!("npx -y {}@{}", candidate.package, candidate.version) },
        Row { key: "variables".into(), value: if names.is_empty() { "aucune".into() } else { names.join(", ") } },
        Row { key: "scope".into(), value: "lecture seule, écriture et suppression refusées jusqu'à accord".into() },
        Row { key: "isolation".into(), value: ISOLATION_NOTE.into() },
    ]
}

/// Lignes affichées avant un appel : le connecteur, l'outil, sa classe, les arguments complets et la commande exacte.
/// La description de l'outil n'y figure pas : elle est écrite par le serveur.
fn call_rows(connector: &str, launch: &Launch, tool: &Tool, arguments: &Value) -> Vec<Row> {
    vec![
        Row { key: "connector".into(), value: connector.to_string() },
        Row { key: "tool".into(), value: tool.name.clone() },
        Row { key: "scope".into(), value: scope::classify(tool).label().to_string() },
        Row { key: "arguments".into(), value: arguments.to_string() },
        Row { key: "command".into(), value: format!("npx -y {}@{}", launch.package, launch.version) },
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

/// Appel d'un outil. Le nom, les arguments et le périmètre sont contrôlés avant toute question ; ensuite seulement le
/// courtier demande l'accord, avec la classe de l'outil et les arguments complets. Renvoie le texte de la réponse.
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
    let installed = installed_or_error(&state.store, &id)?;
    let launch = launch_for(&installed)?;
    let granted = installed.scopes.clone();
    let broker = broker.inner().clone_handle();
    tauri::async_runtime::spawn_blocking(move || {
        client::call_tool(&launch, &tool, &arguments, &granted, |found| {
            let rows = call_rows(&id, &launch, found, &arguments);
            permissions::confirm(&app, &broker, Permission::ConnectorCall, &rows)
        })
    })
    .await
    .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Lignes affichées avant de modifier le périmètre d'un connecteur : les accès demandés, en clair.
fn scope_rows(installed: &Installed, scopes: &[ToolClass]) -> Vec<Row> {
    let granted: Vec<&str> = scopes.iter().map(|class| class.label()).collect();
    vec![
        Row { key: "connector".into(), value: installed.title.clone() },
        Row { key: "scope".into(), value: if granted.is_empty() { "aucun accès".into() } else { granted.join(", ") } },
    ]
}

/// Modifie les accès d'un connecteur installé (écriture, suppression), après accord du courtier natif.
#[tauri::command]
pub async fn mcp_set_scopes(
    app: AppHandle,
    broker: State<'_, Broker>,
    state: State<'_, McpState>,
    webview: tauri::Webview,
    id: String,
    scopes: Vec<ToolClass>,
) -> Result<InstalledView, AdapterError> {
    require_main(&webview)?;
    let installed = installed_or_error(&state.store, &id)?;
    let mut scopes = scopes;
    scopes.sort();
    scopes.dedup();
    let rows = scope_rows(&installed, &scopes);
    let broker = broker.inner().clone_handle();
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        permissions::confirm(&app, &broker, Permission::ConnectorScope, &rows)?;
        Ok(store.set_scopes(&id, scopes)?.view())
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
        // La limite de l'isolation est dite avant l'accord : pas de promesse de sandbox qui n'existe pas.
        assert!(value("isolation").contains("réseau et fichiers non restreints"), "{}", value("isolation"));
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
            scopes: vec![ToolClass::Read],
        };
        let error = launch_for(&installed).unwrap_err();
        assert!(error.to_string().contains("TOKEN"), "{error}");
    }
}
