//! SDK pour les plugins NEXUS écrits en Rust.
//!
//! Un plugin est une bibliothèque `cdylib` compilée pour `wasm32-unknown-unknown`. Il déclare ses commandes ainsi :
//!
//! ```ignore
//! use nexus_plugin_sdk::{export_commands, host, Input, Output};
//!
//! fn note(input: Input) -> Result<Output, String> {
//!     host::storage_set("note", &input.text)?;
//!     Ok(Output::text("Noté."))
//! }
//!
//! export_commands! {
//!     "memorise" => note,
//! }
//! ```
//!
//! Le module n'a accès qu'aux fonctions de [`host`]. Chacune est vérifiée par NEXUS contre les permissions que
//! l'utilisateur a approuvées dans `nexus.json`.

use serde::{Deserialize, Serialize};

// Réexporté pour que la macro `export_commands!` n'impose aucune dépendance supplémentaire au plugin.
#[doc(hidden)]
pub use serde_json as __serde_json;

/// Texte qui suit le déclencheur de la commande, p. ex. « 12 km en miles » pour « convertis 12 km en miles ».
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Input {
    #[serde(default)]
    pub text: String,
}

/// Réponse affichée par NEXUS : une phrase, et un tableau facultatif. Bornes : 500 caractères, 8 colonnes, 50 lignes.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Output {
    pub caption: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table: Option<Table>,
}

impl Output {
    pub fn text(caption: impl Into<String>) -> Output {
        Output { caption: caption.into(), table: None }
    }

    pub fn table(caption: impl Into<String>, table: Table) -> Output {
        Output { caption: caption.into(), table: Some(table) }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Table {
    pub title: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Fonctions que NEXUS met à disposition. Chaque appel est refusé si la permission correspondante n'a pas été approuvée.
pub mod host {
    use serde::Deserialize;
    use serde_json::{json, Value};

    #[link(wasm_import_module = "nexus")]
    extern "C" {
        fn host_call(ptr: i32, len: i32) -> i64;
    }

    /// Envoie une opération à NEXUS et renvoie sa réponse JSON.
    pub fn call(op: &str, args: Value) -> Value {
        let request = serde_json::to_vec(&json!({ "op": op, "args": args })).unwrap_or_default();
        let packed = unsafe { host_call(request.as_ptr() as i32, request.len() as i32) };
        let ptr = ((packed >> 32) & 0xffff_ffff) as usize;
        let len = (packed & 0xffff_ffff) as usize;
        if len == 0 {
            return json!({ "ok": false, "error": "pas de réponse" });
        }
        let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
        serde_json::from_slice(bytes).unwrap_or_else(|_| json!({ "ok": false, "error": "réponse illisible" }))
    }

    fn outcome(value: &Value) -> Result<(), String> {
        if value["ok"].as_bool() == Some(true) {
            Ok(())
        } else {
            Err(value["error"].as_str().unwrap_or("échec").to_string())
        }
    }

    /// Journal de diagnostic, visible par l'auteur. Ne s'affiche pas à l'utilisateur.
    pub fn log(text: &str) {
        let _ = call("log", json!({ "text": text }));
    }

    /// Lit une valeur gardée par le plugin (permission `storage.local`).
    pub fn storage_get(key: &str) -> Result<Option<String>, String> {
        let value = call("storage.get", json!({ "key": key }));
        outcome(&value)?;
        Ok(value["value"].as_str().map(str::to_string))
    }

    /// Écrit une valeur dans le stockage du plugin (permission `storage.local`, quota respecté).
    pub fn storage_set(key: &str, value: &str) -> Result<(), String> {
        outcome(&call("storage.set", json!({ "key": key, "value": value })))
    }

    #[derive(Debug, Clone, Deserialize, PartialEq)]
    pub struct HttpResponse {
        pub status: u16,
        pub body: String,
    }

    /// Requête HTTPS GET vers un hôte déclaré dans le manifeste (permission `network.fetch`). Pas de redirection.
    pub fn fetch(url: &str) -> Result<HttpResponse, String> {
        let value = call("fetch", json!({ "url": url }));
        outcome(&value)?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }
}

/// Dispatch interne : `run` choisit la fonction de la commande demandée. Utilisé par [`export_commands!`].
///
/// Le choix passe par un `match` et non par une table de pointeurs de fonction : les appels indirects laissent des
/// encodages LEB128 que certains moteurs WebAssembly refusent.
#[doc(hidden)]
pub fn __dispatch(request: &[u8], run: impl FnOnce(&str, Input) -> Option<Result<Output, String>>) -> Output {
    #[derive(Deserialize)]
    struct Request {
        command: String,
        #[serde(default)]
        input: Input,
    }
    let Ok(request) = serde_json::from_slice::<Request>(request) else {
        return Output::text("Requête illisible.");
    };
    match run(&request.command, request.input) {
        Some(Ok(output)) => output,
        Some(Err(error)) => Output::text(format!("Impossible : {error}")),
        None => Output::text("Commande inconnue."),
    }
}

/// Exporte `nexus_alloc` et `nexus_handle`, les deux points d'entrée que NEXUS attend, et relie chaque nom de commande
/// à sa fonction. Chaque fonction a la forme `fn(Input) -> Result<Output, String>`.
#[macro_export]
macro_rules! export_commands {
    ($($name:literal => $handler:path),* $(,)?) => {
        #[no_mangle]
        pub extern "C" fn nexus_alloc(len: i32) -> i32 {
            let buffer = vec![0u8; len.max(0) as usize].into_boxed_slice();
            Box::leak(buffer).as_mut_ptr() as i32
        }

        #[no_mangle]
        pub extern "C" fn nexus_handle(ptr: i32, len: i32) -> i64 {
            let request = unsafe { ::std::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
            let response = $crate::__dispatch(request, |command, input| match command {
                $($name => Some($handler(input)),)*
                _ => None,
            });
            let response = $crate::__serde_json::to_vec(&response).unwrap_or_default().into_boxed_slice();
            let len = response.len() as i64;
            let ptr = Box::leak(response).as_mut_ptr() as i64;
            (ptr << 32) | len
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn double(input: Input) -> Result<Output, String> {
        Ok(Output::text(format!("{}{}", input.text, input.text)))
    }

    fn run(command: &str, input: Input) -> Option<Result<Output, String>> {
        match command {
            "double" => Some(double(input)),
            _ => None,
        }
    }

    #[test]
    fn the_dispatcher_picks_the_command_and_reports_unknown_ones() {
        let found = __dispatch(br#"{"command":"double","input":{"text":"ab"}}"#, run);
        assert_eq!(found.caption, "abab");
        assert_eq!(__dispatch(br#"{"command":"absente","input":{}}"#, run).caption, "Commande inconnue.");
        assert_eq!(__dispatch(b"pas du json", run).caption, "Requête illisible.");
    }

    #[test]
    fn outputs_without_a_table_omit_the_field() {
        let json = serde_json::to_value(Output::text("ok")).unwrap();
        assert_eq!(json, serde_json::json!({ "caption": "ok" }));
    }
}
