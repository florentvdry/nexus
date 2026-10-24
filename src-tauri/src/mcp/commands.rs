//! Commandes Tauri des connecteurs MCP. Réservées à l'interface principale (`require_core`). Chaque action qui lance
//! un serveur ou appelle un outil suppose que l'utilisateur a déjà accepté, dans l'interface, l'installation ou l'envoi.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use super::catalog::{Candidate, Catalog, GITHUB, REGISTRY};
use super::client::{self, Launch, Tool};
use super::store::{Installed, InstalledView, Store};
use crate::error::AdapterError;
use crate::grants::require_core;

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
pub async fn mcp_search(state: State<'_, McpState>, caller: String, query: String) -> Result<Vec<Candidate>, AdapterError> {
    require_core(&caller)?;
    let catalog = state.catalog.clone();
    tauri::async_runtime::spawn_blocking(move || catalog.search(REGISTRY, GITHUB, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub fn mcp_installed(state: State<'_, McpState>, caller: String) -> Result<Vec<InstalledView>, AdapterError> {
    require_core(&caller)?;
    Ok(state.store.list().iter().map(Installed::view).collect())
}

/// Installe un connecteur trouvé par la dernière recherche. L'identifiant ne peut pas désigner autre chose.
#[tauri::command]
pub fn mcp_install(state: State<'_, McpState>, caller: String, id: String) -> Result<InstalledView, AdapterError> {
    require_core(&caller)?;
    let candidate = state
        .catalog
        .get(&id)
        .ok_or_else(|| AdapterError::InvalidTarget("connecteur inconnu : relancez la recherche".into()))?;
    Ok(state.store.install(&candidate)?.view())
}

#[tauri::command]
pub fn mcp_set_value(state: State<'_, McpState>, caller: String, id: String, name: String, value: String) -> Result<(), AdapterError> {
    require_core(&caller)?;
    state.store.set_value(&id, &name, &value)
}

/// Outils d'un connecteur installé. Lance le serveur le temps de la lecture.
#[tauri::command]
pub async fn mcp_tools(state: State<'_, McpState>, caller: String, id: String) -> Result<Vec<Tool>, AdapterError> {
    require_core(&caller)?;
    let launch = launch_for(&installed_or_error(&state.store, &id)?)?;
    tauri::async_runtime::spawn_blocking(move || client::list_tools(&launch))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Appel d'un outil, après accord de l'utilisateur dans l'interface. Renvoie le texte de la réponse.
#[tauri::command]
pub async fn mcp_call(state: State<'_, McpState>, caller: String, id: String, tool: String, arguments: Value) -> Result<String, AdapterError> {
    require_core(&caller)?;
    let launch = launch_for(&installed_or_error(&state.store, &id)?)?;
    tauri::async_runtime::spawn_blocking(move || client::call_tool(&launch, &tool, &arguments))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::super::catalog::EnvSpec;
    use super::*;

    #[test]
    fn a_connector_with_a_missing_required_value_is_never_launched() {
        let installed = Installed {
            id: "x".into(),
            title: "x".into(),
            package: "pkg".into(),
            version: "1.0.0".into(),
            env: vec![EnvSpec { name: "TOKEN".into(), required: true, secret: true, description: String::new() }],
            values: Default::default(),
        };
        let error = launch_for(&installed).unwrap_err();
        assert!(error.to_string().contains("TOKEN"), "{error}");
    }
}
