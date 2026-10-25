//! Courtier des permissions : le seul endroit où une action sensible est autorisée.
//!
//! Les commandes natives appellent `confirm` avant toute action de niveau « confirmation ». L'interface ne fait que
//! répondre à une demande émise par le natif. Une demande sans réponse dans le délai est refusée.
//!
//! Autorisations mémorisées : l'utilisateur peut dire « toujours autoriser » pour un dossier (écriture de fichiers)
//! ou un projet (Claude Code). Une règle ne couvre jamais la suppression, ni la fermeture de fenêtre, ni les plugins.
//! Chaque règle est listée dans les réglages et peut être révoquée ; chaque action auto-approuvée est journalisée.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AdapterError;
use crate::grants::{CONFIRMATION_WINDOW, MAIN_WINDOW};

/// Demande complète, envoyée seulement à la fenêtre de confirmation : elle seule voit les paramètres.
pub const REQUEST_EVENT: &str = "permissions://request";
/// Avis envoyé à l'interface principale : il dit qu'une confirmation attend, sans ses paramètres ni ses boutons.
pub const NOTICE_EVENT: &str = "permissions://notice";
pub const AUTO_EVENT: &str = "permissions://auto";
pub const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_AUDIT: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Automatic,
    Confirmation,
    Restricted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    SystemRead,
    FileRead,
    FileWrite,
    FileDelete,
    AgentRun,
    WindowRead,
    WindowControl,
    PluginManage,
    /// Installation d'un connecteur MCP : lance un paquet npm sur ce poste, à chaque fois après accord.
    ConnectorInstall,
    /// Appel d'un outil d'un connecteur MCP : l'outil agit au nom de l'utilisateur, à chaque fois après accord.
    ConnectorCall,
}

/// Toutes les permissions natives, dans l'ordre d'affichage des réglages.
pub const ALL: [Permission; 10] = [
    Permission::SystemRead,
    Permission::FileRead,
    Permission::FileWrite,
    Permission::FileDelete,
    Permission::AgentRun,
    Permission::WindowRead,
    Permission::WindowControl,
    Permission::PluginManage,
    Permission::ConnectorInstall,
    Permission::ConnectorCall,
];

impl Permission {
    pub fn id(self) -> &'static str {
        match self {
            Permission::SystemRead => "system.read",
            Permission::FileRead => "file.read",
            Permission::FileWrite => "file.write",
            Permission::FileDelete => "file.delete",
            Permission::AgentRun => "agent.run",
            Permission::WindowRead => "window.read",
            Permission::WindowControl => "window.control",
            Permission::PluginManage => "plugin.manage",
            Permission::ConnectorInstall => "connector.install",
            Permission::ConnectorCall => "connector.call",
        }
    }

    pub fn from_id(id: &str) -> Option<Permission> {
        ALL.into_iter().find(|permission| permission.id() == id)
    }

    pub fn tier(self) -> Tier {
        match self {
            Permission::SystemRead | Permission::FileRead | Permission::WindowRead => Tier::Automatic,
            Permission::FileWrite
            | Permission::FileDelete
            | Permission::AgentRun
            | Permission::WindowControl
            | Permission::PluginManage
            | Permission::ConnectorInstall
            | Permission::ConnectorCall => Tier::Confirmation,
        }
    }

    /// Peut-on mémoriser « toujours autoriser » ? Seulement pour des actions réversibles et bornées à un dossier ou un projet.
    /// La suppression, la fermeture d'une fenêtre et les plugins ne le peuvent jamais.
    pub fn rememberable(self) -> bool {
        matches!(self, Permission::FileWrite | Permission::AgentRun)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Row {
    /// Clé de libellé, traduite par l'interface (`confirm.row.<clé>`).
    pub key: String,
    pub value: String,
}

/// Demande de confirmation telle qu'affichée par la fenêtre dédiée.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub permission: &'static str,
    pub rows: Vec<Row>,
    pub expires_in_secs: u64,
    pub rememberable: bool,
    /// Dossier ou projet que « toujours autoriser » couvrirait, si l'utilisateur le choisit.
    pub scope: Option<String>,
}

/// Ce que voit l'interface principale d'une confirmation : qu'elle attend, et depuis combien de temps. Aucun paramètre.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationNotice {
    pub id: String,
    pub permission: &'static str,
    pub expires_in_secs: u64,
}

fn permission_request(id: String, permission: Permission, rows: Vec<Row>, expires_in_secs: u64) -> PermissionRequest {
    PermissionRequest {
        scope: scope_for(permission, &rows),
        rememberable: permission.rememberable(),
        id,
        permission: permission.id(),
        rows,
        expires_in_secs,
    }
}

/// Autorisation mémorisée : une permission, bornée à un dossier (écriture) ou un projet (agent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub permission: String,
    pub scope: String,
    pub created_at: u64,
}

/// Action approuvée automatiquement grâce à une règle, gardée pour être affichée.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEntry {
    pub at: u64,
    pub permission: &'static str,
    pub scope: String,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Dossier ou projet couvert par une demande, si la permission peut être mémorisée.
pub fn scope_for(permission: Permission, rows: &[Row]) -> Option<String> {
    if !permission.rememberable() {
        return None;
    }
    match permission {
        Permission::FileWrite => parent_folder(&rows.iter().find(|row| row.key == "from")?.value),
        Permission::AgentRun => rows.iter().find(|row| row.key == "project").map(|row| row.value.clone()),
        _ => None,
    }
}

fn parent_folder(path: &str) -> Option<String> {
    Path::new(path).parent().and_then(|parent| parent.to_str()).filter(|parent| !parent.is_empty()).map(str::to_string)
}

/// Une règle couvre la demande si chaque chemin concerné est dans le dossier, sans remontée (`..`).
fn covers(permission: Permission, scope: &str, rows: &[Row]) -> bool {
    if scope.is_empty() {
        return false;
    }
    match permission {
        Permission::FileWrite => {
            let paths: Vec<&Row> = rows.iter().filter(|row| matches!(row.key.as_str(), "from" | "to" | "path")).collect();
            let inside = |value: &str| {
                let path = Path::new(value);
                !path.components().any(|part| part == Component::ParentDir) && path.starts_with(scope)
            };
            !paths.is_empty() && paths.iter().all(|row| inside(&row.value))
        }
        Permission::AgentRun => rows.iter().any(|row| row.key == "project" && row.value == scope),
        _ => false,
    }
}

#[derive(Clone)]
struct Pending {
    id: String,
    sender: Sender<bool>,
    permission: Permission,
    rows: Vec<Row>,
    deadline: Instant,
}

/// Courtier partagé : demandes en attente, règles mémorisées et journal des actions automatiques.
#[derive(Clone)]
pub struct Broker {
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    sequence: Arc<Mutex<u64>>,
    rules: Arc<Mutex<Vec<Rule>>>,
    audit: Arc<Mutex<Vec<AutoEntry>>>,
    file: Option<Arc<PathBuf>>,
}

impl Default for Broker {
    fn default() -> Self {
        Broker {
            pending: Arc::new(Mutex::new(HashMap::new())),
            sequence: Arc::new(Mutex::new(0)),
            rules: Arc::new(Mutex::new(Vec::new())),
            audit: Arc::new(Mutex::new(Vec::new())),
            file: None,
        }
    }
}

impl Broker {
    /// Courtier dont les règles sont lues et écrites dans `file`. Un fichier absent ou illisible donne « aucune règle ».
    pub fn load(file: PathBuf) -> Broker {
        let rules: Vec<Rule> = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        Broker { rules: Arc::new(Mutex::new(rules)), file: Some(Arc::new(file)), ..Broker::default() }
    }

    /// Poignée vers le même courtier, à passer à un thread de travail.
    pub fn clone_handle(&self) -> Broker {
        self.clone()
    }

    fn next_id(&self) -> String {
        let mut sequence = self.sequence.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *sequence += 1;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        format!("perm-{now}-{}", *sequence)
    }

    /// Réponse de l'utilisateur. Une demande déjà réglée, expirée ou inconnue est refusée.
    pub fn answer(&self, id: &str, approved: bool) -> Result<(), AdapterError> {
        self.answer_with(id, approved, false)
    }

    /// Réponse avec « toujours autoriser » : si la demande est approuvée et mémorisable, sa règle est enregistrée.
    pub fn answer_with(&self, id: &str, approved: bool, remember: bool) -> Result<(), AdapterError> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| AdapterError::TaskFailed("verrou des permissions".into()))?
            .remove(id)
            .ok_or(AdapterError::ConfirmationExpired)?;
        if approved && remember {
            if let Some(scope) = scope_for(pending.permission, &pending.rows) {
                self.add_rule(pending.permission, scope)?;
            }
        }
        pending.sender.send(approved).map_err(|_| AdapterError::ConfirmationExpired)
    }

    /// Demandes en attente. Utile pour l'affichage et les tests.
    pub fn pending_count(&self) -> usize {
        self.pending.lock().map(|pending| pending.len()).unwrap_or(0)
    }

    /// Demandes en attente, pour la fenêtre de confirmation : au chargement, elle reprend ce qui attend déjà.
    pub fn pending_requests(&self) -> Vec<PermissionRequest> {
        let now = Instant::now();
        let Ok(pending) = self.pending.lock() else { return Vec::new() };
        let mut requests: Vec<PermissionRequest> = pending
            .values()
            .map(|entry| {
                let left = entry.deadline.saturating_duration_since(now).as_secs();
                permission_request(entry.id.clone(), entry.permission, entry.rows.clone(), left)
            })
            .collect();
        requests.sort_by(|a, b| a.id.cmp(&b.id));
        requests
    }

    fn add_rule(&self, permission: Permission, scope: String) -> Result<(), AdapterError> {
        {
            let mut rules = self.rules.lock().map_err(|_| AdapterError::TaskFailed("verrou des règles".into()))?;
            if rules.iter().any(|rule| rule.permission == permission.id() && rule.scope == scope) {
                return Ok(());
            }
            rules.push(Rule { id: self.next_id(), permission: permission.id().into(), scope, created_at: now_secs() });
        }
        self.save()
    }

    pub fn rules(&self) -> Vec<Rule> {
        self.rules.lock().map(|rules| rules.clone()).unwrap_or_default()
    }

    /// Révoque une règle. Renvoie `false` si elle n'existe pas.
    pub fn revoke(&self, id: &str) -> Result<bool, AdapterError> {
        let removed = {
            let mut rules = self.rules.lock().map_err(|_| AdapterError::TaskFailed("verrou des règles".into()))?;
            let before = rules.len();
            rules.retain(|rule| rule.id != id);
            rules.len() != before
        };
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    /// Journal des actions approuvées automatiquement, les plus récentes d'abord.
    pub fn audit(&self) -> Vec<AutoEntry> {
        self.audit.lock().map(|entries| entries.iter().rev().cloned().collect()).unwrap_or_default()
    }

    /// Approuve sans demander si une règle couvre la demande. L'action est journalisée.
    pub fn auto_approve(&self, permission: Permission, rows: &[Row]) -> Option<AutoEntry> {
        if !permission.rememberable() {
            return None;
        }
        let rule = self.rules().into_iter().find(|rule| rule.permission == permission.id() && covers(permission, &rule.scope, rows))?;
        let entry = AutoEntry { at: now_secs(), permission: permission.id(), scope: rule.scope };
        if let Ok(mut audit) = self.audit.lock() {
            audit.push(entry.clone());
            if audit.len() > MAX_AUDIT {
                let excess = audit.len() - MAX_AUDIT;
                audit.drain(..excess);
            }
        }
        Some(entry)
    }

    fn save(&self) -> Result<(), AdapterError> {
        let Some(file) = &self.file else { return Ok(()) };
        let rules = self.rules();
        let text = serde_json::to_string_pretty(&rules).map_err(|error| AdapterError::Operation(error.to_string()))?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|error| AdapterError::Operation(error.to_string()))?;
        }
        let temporary = file.with_extension("json.tmp");
        std::fs::write(&temporary, text).map_err(|error| AdapterError::Operation(error.to_string()))?;
        std::fs::rename(&temporary, file.as_ref()).map_err(|error| AdapterError::Operation(error.to_string()))
    }
}

/// Demande l'accord de l'utilisateur pour une action de niveau « confirmation ».
///
/// Bloque le thread appelant jusqu'à la réponse ou l'expiration : à appeler depuis `spawn_blocking`.
/// `emit` transmet la demande à l'interface ; il est injecté pour pouvoir tester sans fenêtre.
pub fn confirm_with(
    emit: impl FnOnce(&str, Permission, &[Row], u64) -> Result<(), AdapterError>,
    broker: &Broker,
    permission: Permission,
    rows: &[Row],
    timeout: Duration,
) -> Result<(), AdapterError> {
    match permission.tier() {
        Tier::Automatic => return Ok(()),
        Tier::Restricted => return Err(AdapterError::PermissionRefused(permission.id().into())),
        Tier::Confirmation => {}
    }

    let id = broker.next_id();
    let (sender, receiver) = mpsc::channel::<bool>();
    broker
        .pending
        .lock()
        .map_err(|_| AdapterError::TaskFailed("verrou des permissions".into()))?
        .insert(id.clone(), Pending { id: id.clone(), sender, permission, rows: rows.to_vec(), deadline: Instant::now() + timeout });

    let outcome = match emit(&id, permission, rows, timeout.as_secs()) {
        Err(error) => Err(error),
        Ok(()) => match receiver.recv_timeout(timeout) {
            Ok(true) => Ok(()),
            Ok(false) => Err(AdapterError::ConfirmationRefused),
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => Err(AdapterError::ConfirmationExpired),
        },
    };
    if let Ok(mut pending) = broker.pending.lock() {
        pending.remove(&id);
    }
    outcome
}

/// Version Tauri : une règle couvrant la demande l'approuve sans question ; sinon la demande est affichée.
pub fn confirm(app: &AppHandle, broker: &Broker, permission: Permission, rows: &[Row]) -> Result<(), AdapterError> {
    if let Some(entry) = broker.auto_approve(permission, rows) {
        let _ = app.emit(AUTO_EVENT, &entry);
        return Ok(());
    }
    confirm_with(
        |id, permission, rows, expires_in_secs| {
            // Sans fenêtre de confirmation, la demande échoue : l'action n'a pas lieu.
            let request = permission_request(id.to_string(), permission, rows.to_vec(), expires_in_secs);
            show_confirmation_window(app);
            app.emit_to(CONFIRMATION_WINDOW, REQUEST_EVENT, &request).map_err(|error| AdapterError::TaskFailed(error.to_string()))?;
            let notice = ConfirmationNotice { id: id.to_string(), permission: permission.id(), expires_in_secs };
            app.emit_to(MAIN_WINDOW, NOTICE_EVENT, &notice).map_err(|error| AdapterError::TaskFailed(error.to_string()))
        },
        broker,
        permission,
        rows,
        CONFIRMATION_TIMEOUT,
    )
}

/// Fait apparaître la fenêtre de confirmation, sans la laisser se fermer : elle se cache seulement.
fn show_confirmation_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(CONFIRMATION_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Cache la fenêtre de confirmation quand plus rien n'attend.
pub fn hide_confirmation_window_when_idle(app: &AppHandle, broker: &Broker) {
    if broker.pending_count() == 0 {
        if let Some(window) = app.get_webview_window(CONFIRMATION_WINDOW) {
            let _ = window.hide();
        }
    }
}

/// Chaque permission et son niveau, pour l'affichage des réglages.
pub fn status() -> Vec<(&'static str, Tier)> {
    ALL.into_iter().map(|permission| (permission.id(), permission.tier())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn row(key: &str, value: &str) -> Row {
        Row { key: key.into(), value: value.into() }
    }

    fn rename_rows(from: &str, to: &str) -> Vec<Row> {
        vec![row("from", from), row("to", to), row("requester", "actions.file-operations")]
    }

    #[test]
    fn automatic_permissions_never_prompt() {
        let broker = Broker::default();
        let result = confirm_with(|_, _, _, _| panic!("aucune demande attendue"), &broker, Permission::FileRead, &[], Duration::from_secs(1));
        assert!(result.is_ok());
    }

    #[test]
    fn confirmation_proceeds_only_when_the_user_approves() {
        let broker = Arc::new(Broker::default());
        let answering = Arc::clone(&broker);
        let rows = [row("from", "C:\\Users\\Ana\\a.txt")];
        let result = confirm_with(
            |id, permission, shown, expires| {
                assert_eq!(permission, Permission::FileDelete);
                assert_eq!(shown, &rows);
                assert_eq!(expires, 5);
                let id = id.to_string();
                thread::spawn(move || answering.answer(&id, true).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileDelete,
            &rows,
            Duration::from_secs(5),
        );
        assert!(result.is_ok());
        assert_eq!(broker.pending_count(), 0);
    }

    #[test]
    fn refusal_is_reported_and_never_turns_into_approval() {
        let broker = Arc::new(Broker::default());
        let answering = Arc::clone(&broker);
        let result = confirm_with(
            |id, _, _, _| {
                let id = id.to_string();
                thread::spawn(move || answering.answer(&id, false).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileWrite,
            &[],
            Duration::from_secs(5),
        );
        assert!(matches!(result, Err(AdapterError::ConfirmationRefused)));
    }

    #[test]
    fn a_request_without_answer_expires_and_is_refused() {
        let broker = Broker::default();
        let started = std::time::Instant::now();
        let result = confirm_with(|_, _, _, _| Ok(()), &broker, Permission::AgentRun, &[], Duration::from_millis(100));
        assert!(matches!(result, Err(AdapterError::ConfirmationExpired)));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(broker.pending_count(), 0);
    }

    #[test]
    fn answering_an_unknown_or_settled_request_is_refused() {
        let broker = Broker::default();
        assert!(matches!(broker.answer("perm-absent", true), Err(AdapterError::ConfirmationExpired)));
    }

    #[test]
    fn tiers_match_the_documented_policy() {
        assert_eq!(Permission::FileRead.tier(), Tier::Automatic);
        assert_eq!(Permission::WindowRead.tier(), Tier::Automatic);
        assert_eq!(Permission::FileDelete.tier(), Tier::Confirmation);
        assert_eq!(Permission::AgentRun.tier(), Tier::Confirmation);
        assert_eq!(Permission::WindowControl.tier(), Tier::Confirmation);
        assert_eq!(Permission::ConnectorCall.tier(), Tier::Confirmation);
        assert_eq!(Permission::ConnectorInstall.tier(), Tier::Confirmation);
    }

    /// L'interface principale reçoit un avis : elle sait qu'une confirmation attend, pas ce qu'elle autorise.
    #[test]
    fn the_notice_for_the_main_window_carries_no_parameters() {
        let notice = ConfirmationNotice { id: "perm-1".into(), permission: "file.delete", expires_in_secs: 120 };
        let text = serde_json::to_string(&notice).unwrap();
        assert!(!text.contains("rows") && !text.contains("value"), "{text}");
        assert!(text.contains("\"expiresInSecs\":120"), "{text}");
    }

    /// La fenêtre de confirmation reprend ce qui attend : une demande reste visible tant que personne n'a répondu.
    #[test]
    fn a_waiting_request_is_listed_for_the_confirmation_window_until_answered() {
        let broker = Broker::default();
        let worker = broker.clone_handle();
        let rows = vec![row("path", "C:\\Users\\flore\\Documents\\devis.pdf")];
        let rows_for_thread = rows.clone();
        let waiting = thread::spawn(move || confirm_with(|_, _, _, _| Ok(()), &worker, Permission::FileDelete, &rows_for_thread, Duration::from_secs(10)));
        let started = std::time::Instant::now();
        while broker.pending_count() == 0 && started.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(5));
        }
        let listed = broker.pending_requests();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].permission, "file.delete");
        assert_eq!(listed[0].rows, rows);
        assert!(!listed[0].rememberable, "la suppression n'est jamais mémorisable");
        broker.answer(&listed[0].id, true).unwrap();
        assert!(waiting.join().unwrap().is_ok());
        assert!(broker.pending_requests().is_empty());
    }

    #[test]
    fn every_permission_round_trips_through_its_identifier() {
        for permission in ALL {
            assert_eq!(Permission::from_id(permission.id()), Some(permission));
        }
        assert_eq!(Permission::from_id("shell.run"), None);
    }

    #[test]
    fn deletion_window_closing_and_plugins_are_never_remembered() {
        for permission in [Permission::FileDelete, Permission::WindowControl, Permission::PluginManage, Permission::ConnectorCall, Permission::ConnectorInstall] {
            assert!(!permission.rememberable(), "{} ne doit jamais être mémorisée", permission.id());
        }
        assert!(Permission::FileWrite.rememberable());
        assert!(Permission::AgentRun.rememberable());
    }

    #[test]
    fn a_folder_rule_covers_renames_inside_that_folder_only() {
        let broker = Broker::default();
        let rows = rename_rows("/root/Documents/projet/a.txt", "/root/Documents/projet/b.txt");
        assert_eq!(scope_for(Permission::FileWrite, &rows).as_deref(), Some("/root/Documents/projet"));
        broker.add_rule(Permission::FileWrite, "/root/Documents/projet".into()).unwrap();

        assert!(broker.auto_approve(Permission::FileWrite, &rows).is_some());
        // Un dossier voisin au nom commençant pareil n'est pas couvert.
        let sibling = rename_rows("/root/Documents/projet2/a.txt", "/root/Documents/projet2/b.txt");
        assert!(broker.auto_approve(Permission::FileWrite, &sibling).is_none());
        // Un déplacement vers l'extérieur demande toujours l'accord.
        let outward = rename_rows("/root/Documents/projet/a.txt", "/root/Documents/autre/a.txt");
        assert!(broker.auto_approve(Permission::FileWrite, &outward).is_none());
        // Une remontée de chemin n'est jamais couverte.
        let escape = rename_rows("/root/Documents/projet/../autre/a.txt", "/root/Documents/projet/b.txt");
        assert!(broker.auto_approve(Permission::FileWrite, &escape).is_none());
    }

    #[test]
    fn a_project_rule_covers_only_that_project() {
        let broker = Broker::default();
        broker.add_rule(Permission::AgentRun, "/home/ana/projet".into()).unwrap();
        let same = vec![row("project", "/home/ana/projet"), row("prompt", "liste")];
        let other = vec![row("project", "/home/ana/autre"), row("prompt", "liste")];
        assert!(broker.auto_approve(Permission::AgentRun, &same).is_some());
        assert!(broker.auto_approve(Permission::AgentRun, &other).is_none());
    }

    #[test]
    fn remembering_during_an_answer_turns_the_next_request_automatic() {
        let broker = Arc::new(Broker::default());
        let answering = Arc::clone(&broker);
        let rows = rename_rows("/root/Documents/projet/a.txt", "/root/Documents/projet/b.txt");
        let shown = rows.clone();
        let result = confirm_with(
            |id, _, _, _| {
                let id = id.to_string();
                thread::spawn(move || answering.answer_with(&id, true, true).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileWrite,
            &shown,
            Duration::from_secs(5),
        );
        assert!(result.is_ok());
        assert_eq!(broker.rules().len(), 1);
        assert!(broker.auto_approve(Permission::FileWrite, &rows).is_some());
        assert_eq!(broker.audit().len(), 1);
    }

    #[test]
    fn refusing_never_stores_a_rule() {
        let broker = Arc::new(Broker::default());
        let answering = Arc::clone(&broker);
        let rows = rename_rows("/root/Documents/projet/a.txt", "/root/Documents/projet/b.txt");
        let _ = confirm_with(
            |id, _, _, _| {
                let id = id.to_string();
                thread::spawn(move || answering.answer_with(&id, false, true).unwrap());
                Ok(())
            },
            &broker,
            Permission::FileWrite,
            &rows,
            Duration::from_secs(5),
        );
        assert!(broker.rules().is_empty());
    }

    #[test]
    fn rules_survive_a_restart_and_can_be_revoked() {
        let file = std::env::temp_dir().join(format!("nexus-rules-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&file);
        let broker = Broker::load(file.clone());
        broker.add_rule(Permission::AgentRun, "/home/ana/projet".into()).unwrap();
        let reloaded = Broker::load(file.clone());
        assert_eq!(reloaded.rules().len(), 1);
        let id = reloaded.rules()[0].id.clone();
        assert!(reloaded.revoke(&id).unwrap());
        assert!(Broker::load(file.clone()).rules().is_empty());
        let _ = std::fs::remove_file(file);
    }
}
