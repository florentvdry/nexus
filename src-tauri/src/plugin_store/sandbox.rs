//! Bac à sable des plugins avec code : WebAssembly (wasmtime).
//!
//! Un plugin est un module WebAssembly. Il n'importe qu'une seule fonction, `nexus.host_call`, et n'exporte que
//! `memory`, `nexus_alloc` et `nexus_handle`. Toute action passe par `host_call` : NEXUS vérifie alors la permission
//! approuvée du plugin avant d'agir. Le module n'a ni système de fichiers, ni réseau, ni horloge propre.
//!
//! Limites : 32 Mo de mémoire, 10 secondes par appel, 256 Ko par message.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wasmtime::{Caller, Config, Engine, Extern, Linker, Memory, Module, Store, StoreLimits, StoreLimitsBuilder, TypedFunc};

use super::manifest::PermissionDecl;
use crate::error::AdapterError;

pub const HOST_MODULE: &str = "nexus";
pub const HOST_FUNCTION: &str = "host_call";
const MEMORY_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_LOG_LINES: usize = 50;
const MAX_LOG_CHARS: usize = 200;
const MAX_VALUE_BYTES: usize = 64 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const TICK: Duration = Duration::from_millis(10);

/// Permissions effectivement accordées à un plugin, lues dans le lock approuvé.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Grants {
    pub storage_quota_bytes: Option<u64>,
    pub fetch_hosts: Vec<String>,
}

impl Grants {
    pub fn from_decls(decls: &[PermissionDecl]) -> Grants {
        let mut grants = Grants::default();
        for decl in decls {
            match decl.id.as_str() {
                "storage.local" => grants.storage_quota_bytes = decl.quota_kb.map(|kb| kb * 1024),
                "network.fetch" => grants.fetch_hosts = decl.hosts.clone(),
                _ => {}
            }
        }
        grants
    }
}

/// Moteur partagé. Les erreurs de l'hôte sont renvoyées au module, qui décide quoi en faire.
#[derive(Clone)]
pub struct Sandbox {
    engine: Option<Engine>,
    timeout: Duration,
}

struct Host {
    limits: StoreLimits,
    grants: Grants,
    storage: PathBuf,
    logs: Vec<String>,
    http: Arc<ureq::Agent>,
}

impl Sandbox {
    pub fn new() -> Result<Sandbox, AdapterError> {
        Sandbox::with_timeout(Duration::from_secs(10))
    }

    pub fn with_timeout(timeout: Duration) -> Result<Sandbox, AdapterError> {
        let mut config = Config::new();
        config.epoch_interruption(true);
        let engine = Engine::new(&config).map_err(|error| AdapterError::Operation(format!("moteur WebAssembly : {error}")))?;
        // Horloge de délai : incrémentée en continu, elle interrompt un module qui dépasse son temps.
        let clock = engine.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(TICK);
            clock.increment_epoch();
        });
        Ok(Sandbox { engine: Some(engine), timeout })
    }

    fn engine(&self) -> Result<&Engine, AdapterError> {
        self.engine.as_ref().ok_or_else(|| AdapterError::Operation("bac à sable indisponible".into()))
    }

    /// Compile un module. Ne l'exécute pas.
    pub fn compile(&self, bytes: &[u8]) -> Result<Module, AdapterError> {
        Module::new(self.engine()?, bytes).map_err(|error| AdapterError::PluginInvalid(format!("module WebAssembly invalide : {error}")))
    }

    /// Problèmes d'un module : imports interdits, exports manquants. Liste vide : module acceptable.
    pub fn check_module(&self, bytes: &[u8]) -> Vec<String> {
        let module = match self.compile(bytes) {
            Ok(module) => module,
            Err(error) => return vec![error.to_string()],
        };
        let mut problems = Vec::new();
        for import in module.imports() {
            if import.module() != HOST_MODULE || import.name() != HOST_FUNCTION {
                problems.push(format!("import « {}.{} » interdit : seul « {HOST_MODULE}.{HOST_FUNCTION} » est autorisé", import.module(), import.name()));
            }
        }
        for export in ["memory", "nexus_alloc", "nexus_handle"] {
            if module.get_export(export).is_none() {
                problems.push(format!("export « {export} » manquant"));
            }
        }
        problems
    }

    /// Exécute une commande du module et renvoie sa réponse JSON.
    pub fn run(&self, module: &Module, grants: Grants, storage: PathBuf, command: &str, input: &Value) -> Result<Value, AdapterError> {
        let request = serde_json::to_vec(&json!({ "command": command, "input": input }))
            .map_err(|error| AdapterError::Operation(error.to_string()))?;
        if request.len() > MAX_MESSAGE_BYTES {
            return Err(AdapterError::Operation("message trop long pour le plugin".into()));
        }
        let engine = self.engine()?;
        let host = Host {
            limits: StoreLimitsBuilder::new().memory_size(MEMORY_BYTES).build(),
            grants,
            storage,
            logs: Vec::new(),
            http: Arc::new(http_agent()),
        };
        let mut store = Store::new(engine, host);
        store.limiter(|host| &mut host.limits);
        let ticks = (self.timeout.as_millis() / TICK.as_millis()).max(1) as u64;
        store.set_epoch_deadline(ticks);

        let mut linker: Linker<Host> = Linker::new(engine);
        linker.func_wrap(HOST_MODULE, HOST_FUNCTION, host_call).map_err(plugin_error)?;
        let instance = linker.instantiate(&mut store, module).map_err(plugin_error)?;
        let memory = instance.get_memory(&mut store, "memory").ok_or_else(|| plugin_error_text("mémoire absente"))?;
        let alloc: TypedFunc<i32, i32> = instance.get_typed_func(&mut store, "nexus_alloc").map_err(plugin_error)?;
        let handle: TypedFunc<(i32, i32), i64> = instance.get_typed_func(&mut store, "nexus_handle").map_err(plugin_error)?;

        let ptr = alloc.call(&mut store, request.len() as i32).map_err(plugin_error)?;
        memory.write(&mut store, ptr as usize, &request).map_err(plugin_error)?;
        let packed = handle.call(&mut store, (ptr, request.len() as i32)).map_err(plugin_error)?;
        let (out_ptr, out_len) = unpack(packed);
        if out_len > MAX_MESSAGE_BYTES {
            return Err(plugin_error_text("réponse trop longue"));
        }
        let mut bytes = vec![0u8; out_len];
        memory.read(&store, out_ptr, &mut bytes).map_err(plugin_error)?;
        serde_json::from_slice(&bytes).map_err(|error| plugin_error_text(&format!("réponse illisible : {error}")))
    }
}

fn plugin_error(error: impl std::fmt::Display) -> AdapterError {
    plugin_error_text(&error.to_string())
}

fn plugin_error_text(text: &str) -> AdapterError {
    AdapterError::Operation(format!("plugin : {text}"))
}

fn pack(ptr: i32, len: i32) -> i64 {
    ((ptr as i64) << 32) | (len as u32 as i64)
}

fn unpack(packed: i64) -> (usize, usize) {
    (((packed >> 32) & 0xffff_ffff) as usize, (packed & 0xffff_ffff) as usize)
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(FETCH_TIMEOUT))
            .max_redirects(0)
            .http_status_as_error(false)
            .user_agent("NEXUS-plugin/0.1")
            .build(),
    )
}

/// Point d'entrée appelé par le module. Toute erreur devient une réponse `{ok: false}`, jamais un plantage.
fn host_call(mut caller: Caller<'_, Host>, ptr: i32, len: i32) -> i64 {
    let response = match read_request(&mut caller, ptr, len) {
        Ok(request) => dispatch(caller.data_mut(), &request),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    write_response(&mut caller, &response).unwrap_or(0)
}

fn read_request(caller: &mut Caller<'_, Host>, ptr: i32, len: i32) -> Result<Value, String> {
    let memory = memory_of(caller)?;
    if len < 0 || len as usize > MAX_MESSAGE_BYTES {
        return Err("message trop long".into());
    }
    let mut bytes = vec![0u8; len as usize];
    memory.read(&*caller, ptr as usize, &mut bytes).map_err(|_| "lecture impossible".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "message illisible".to_string())
}

fn write_response(caller: &mut Caller<'_, Host>, response: &Value) -> Result<i64, String> {
    let bytes = serde_json::to_vec(response).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err("réponse trop longue".into());
    }
    let memory = memory_of(caller)?;
    let alloc = match caller.get_export("nexus_alloc") {
        Some(Extern::Func(func)) => func.typed::<i32, i32>(&*caller).map_err(|error| error.to_string())?,
        _ => return Err("nexus_alloc absent".into()),
    };
    let ptr = alloc.call(&mut *caller, bytes.len() as i32).map_err(|error| error.to_string())?;
    memory.write(&mut *caller, ptr as usize, &bytes).map_err(|error| error.to_string())?;
    Ok(pack(ptr, bytes.len() as i32))
}

fn memory_of(caller: &mut Caller<'_, Host>) -> Result<Memory, String> {
    match caller.get_export("memory") {
        Some(Extern::Memory(memory)) => Ok(memory),
        _ => Err("mémoire absente".into()),
    }
}

fn refused(permission: &str) -> Value {
    json!({ "ok": false, "error": "permission-refused", "permission": permission })
}

/// Opérations de l'hôte. Chacune exige la permission correspondante, approuvée à l'installation.
fn dispatch(host: &mut Host, request: &Value) -> Value {
    let args = &request["args"];
    match request["op"].as_str().unwrap_or("") {
        "log" => {
            let text: String = args["text"].as_str().unwrap_or("").chars().take(MAX_LOG_CHARS).collect();
            if host.logs.len() < MAX_LOG_LINES {
                host.logs.push(text);
            }
            json!({ "ok": true })
        }
        "storage.get" => {
            if host.grants.storage_quota_bytes.is_none() {
                return refused("storage.local");
            }
            match storage_key(args) {
                Ok(name) => match std::fs::read_to_string(host.storage.join(name)) {
                    Ok(value) => json!({ "ok": true, "value": value }),
                    Err(_) => json!({ "ok": true, "value": null }),
                },
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        "storage.set" => {
            let Some(quota) = host.grants.storage_quota_bytes else {
                return refused("storage.local");
            };
            let value = args["value"].as_str().unwrap_or("");
            if value.len() > MAX_VALUE_BYTES {
                return json!({ "ok": false, "error": "valeur trop grande" });
            }
            match storage_key(args) {
                Ok(name) => match store_value(&host.storage, &name, value, quota) {
                    Ok(()) => json!({ "ok": true }),
                    Err(error) => json!({ "ok": false, "error": error }),
                },
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        "fetch" => {
            if host.grants.fetch_hosts.is_empty() {
                return refused("network.fetch");
            }
            let url = args["url"].as_str().unwrap_or("");
            match check_url(url, &host.grants.fetch_hosts) {
                Ok(()) => fetch(&host.http, url),
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        _ => json!({ "ok": false, "error": "opération inconnue" }),
    }
}

/// Clé de stockage : lettres minuscules, chiffres, `-` et `_`. Aucun chemin n'est jamais construit à partir d'un texte libre.
fn storage_key(args: &Value) -> Result<String, String> {
    let key = args["key"].as_str().unwrap_or("");
    let valid = (1..=64).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if !valid {
        return Err("clé refusée".into());
    }
    Ok(format!("{key}.txt"))
}

fn store_value(dir: &Path, name: &str, value: &str, quota: u64) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let target = dir.join(name);
    let previous = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    let used: u64 = std::fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum();
    if used - previous + value.len() as u64 > quota {
        return Err("quota de stockage dépassé".into());
    }
    std::fs::write(target, value).map_err(|error| error.to_string())
}

/// Adresse HTTPS, sans identifiants, sans port, dont l'hôte figure dans la liste déclarée.
fn check_url(url: &str, allowed: &[String]) -> Result<(), String> {
    let rest = url.strip_prefix("https://").ok_or("seul HTTPS est autorisé")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') || authority.contains(':') || authority.is_empty() {
        return Err("adresse refusée".into());
    }
    if !allowed.iter().any(|host| host == &authority.to_ascii_lowercase()) {
        return Err("hôte non déclaré dans le manifeste".into());
    }
    Ok(())
}

fn fetch(agent: &ureq::Agent, url: &str) -> Value {
    match agent.get(url).call() {
        Ok(mut response) => {
            let status = response.status().as_u16();
            match response.body_mut().with_config().limit(MAX_VALUE_BYTES as u64).read_to_string() {
                Ok(body) => json!({ "ok": true, "status": status, "body": body }),
                Err(_) => json!({ "ok": false, "error": "réponse illisible ou trop grande" }),
            }
        }
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

/// Résultat renvoyé à l'interface : une phrase et, facultativement, un tableau. Bornés pour rester lisibles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionOutput {
    pub caption: String,
    #[serde(default)]
    pub table: Option<ActionTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionTable {
    pub title: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl ActionOutput {
    /// Contrôle les bornes de la réponse. Une réponse hors bornes est refusée, jamais tronquée en silence.
    pub fn validated(self) -> Result<ActionOutput, AdapterError> {
        let fail = |message: &str| Err(plugin_error_text(message));
        if self.caption.trim().is_empty() || self.caption.chars().count() > 500 {
            return fail("légende vide ou trop longue");
        }
        if let Some(table) = &self.table {
            if table.columns.is_empty() || table.columns.len() > 8 || table.rows.len() > 50 {
                return fail("tableau hors bornes");
            }
            for row in &table.rows {
                if row.len() != table.columns.len() || row.iter().any(|cell| cell.chars().count() > 200) {
                    return fail("ligne de tableau invalide");
                }
            }
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Module de test : `nexus_handle` appelle `host_call` avec la requête fixée en mémoire, puis renvoie la réponse.
    fn module_calling_host(request: &str) -> Vec<u8> {
        let escaped = request.replace('\\', "\\\\").replace('"', "\\\"");
        let length = request.len();
        wat::parse_str(format!(
            r#"(module
                (import "nexus" "host_call" (func $host (param i32 i32) (result i64)))
                (memory (export "memory") 2)
                (data (i32.const 4096) "{escaped}")
                (func (export "nexus_alloc") (param i32) (result i32) (i32.const 8192))
                (func (export "nexus_handle") (param i32 i32) (result i64)
                    (call $host (i32.const 4096) (i32.const {length}))))"#
        ))
        .unwrap()
    }

    /// Module qui renvoie sa requête telle quelle : vérifie l'aller-retour mémoire.
    fn echo_module() -> Vec<u8> {
        wat::parse_str(
            r#"(module
                (memory (export "memory") 2)
                (func (export "nexus_alloc") (param i32) (result i32) (i32.const 8192))
                (func (export "nexus_handle") (param i32 i32) (result i64)
                    (i64.or (i64.shl (i64.extend_i32_u (local.get 0)) (i64.const 32)) (i64.extend_i32_u (local.get 1)))))"#,
        )
        .unwrap()
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexus-sandbox-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn grants_with_storage(quota_kb: u64) -> Grants {
        Grants { storage_quota_bytes: Some(quota_kb * 1024), fetch_hosts: vec![] }
    }

    #[test]
    fn a_module_round_trips_its_request_through_shared_memory() {
        let sandbox = Sandbox::new().unwrap();
        let module = sandbox.compile(&echo_module()).unwrap();
        let output = sandbox.run(&module, Grants::default(), scratch("echo"), "convertit", &json!({"text": "12 km"})).unwrap();
        assert_eq!(output["command"], "convertit");
        assert_eq!(output["input"]["text"], "12 km");
    }

    #[test]
    fn a_module_may_only_import_the_host_function() {
        let sandbox = Sandbox::new().unwrap();
        let bad = wat::parse_str(
            r#"(module
                (import "wasi_snapshot_preview1" "fd_write" (func (param i32 i32 i32 i32) (result i32)))
                (memory (export "memory") 1)
                (func (export "nexus_alloc") (param i32) (result i32) (i32.const 0))
                (func (export "nexus_handle") (param i32 i32) (result i64) (i64.const 0)))"#,
        )
        .unwrap();
        let problems = sandbox.check_module(&bad);
        assert!(problems.iter().any(|p| p.contains("interdit")), "{problems:?}");
        assert!(sandbox.check_module(&echo_module()).is_empty());
    }

    #[test]
    fn a_module_without_the_required_exports_is_refused() {
        let sandbox = Sandbox::new().unwrap();
        let bare = wat::parse_str("(module (memory (export \"memory\") 1))").unwrap();
        assert!(sandbox.check_module(&bare).iter().any(|p| p.contains("nexus_handle")));
    }

    #[test]
    fn storage_is_refused_without_the_approved_permission() {
        let sandbox = Sandbox::new().unwrap();
        let module = sandbox.compile(&module_calling_host(r#"{"op":"storage.set","args":{"key":"memo","value":"x"}}"#)).unwrap();
        let output = sandbox.run(&module, Grants::default(), scratch("refused"), "memo", &json!({})).unwrap();
        assert_eq!(output["ok"], false);
        assert_eq!(output["error"], "permission-refused");
        assert!(!scratch("refused").exists(), "rien n'est écrit sans permission");
    }

    #[test]
    fn storage_is_confined_to_the_plugin_folder_and_its_quota() {
        let sandbox = Sandbox::new().unwrap();
        let dir = scratch("quota");
        let write = |key: &str, value: &str| -> Value {
            let module = sandbox.compile(&module_calling_host(&format!(r#"{{"op":"storage.set","args":{{"key":"{key}","value":"{value}"}}}}"#))).unwrap();
            sandbox.run(&module, grants_with_storage(1), dir.clone(), "memo", &json!({})).unwrap()
        };
        assert_eq!(write("memo", "bonjour")["ok"], true);
        assert_eq!(write("../evasion", "x")["ok"], false, "une clé ne peut pas sortir du dossier");
        assert!(dir.join("memo.txt").exists());
        let big = "a".repeat(1500);
        assert_eq!(write("gros", &big)["error"], "quota de stockage dépassé");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn network_is_limited_to_declared_https_hosts() {
        let allowed = vec!["api.exemple.org".to_string()];
        assert!(check_url("https://api.exemple.org/v1?x=1", &allowed).is_ok());
        assert!(check_url("http://api.exemple.org/", &allowed).is_err());
        assert!(check_url("https://evil.example.net/", &allowed).is_err());
        assert!(check_url("https://api.exemple.org@evil.example.net/", &allowed).is_err());
        assert!(check_url("https://api.exemple.org:8443/", &allowed).is_err());
    }

    #[test]
    fn a_module_that_never_returns_is_interrupted() {
        let sandbox = Sandbox::with_timeout(Duration::from_millis(300)).unwrap();
        let looping = wat::parse_str(
            r#"(module
                (memory (export "memory") 1)
                (func (export "nexus_alloc") (param i32) (result i32) (i32.const 0))
                (func (export "nexus_handle") (param i32 i32) (result i64)
                    (loop $spin (br $spin))
                    (i64.const 0)))"#,
        )
        .unwrap();
        let module = sandbox.compile(&looping).unwrap();
        let started = std::time::Instant::now();
        assert!(sandbox.run(&module, Grants::default(), scratch("loop"), "boucle", &json!({})).is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn answers_are_bounded_before_they_reach_the_interface() {
        let ok = ActionOutput { caption: "12 km = 7,46 mi".into(), table: None };
        assert!(ok.clone().validated().is_ok());
        assert!(ActionOutput { caption: " ".into(), table: None }.validated().is_err());
        let ragged = ActionOutput {
            caption: "x".into(),
            table: Some(ActionTable { title: "t".into(), columns: vec!["a".into(), "b".into()], rows: vec![vec!["1".into()]] }),
        };
        assert!(ragged.validated().is_err());
    }
}
