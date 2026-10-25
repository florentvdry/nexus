//! NVIDIA NIM en option (API compatible OpenAI, quota gratuit avec une clé personnelle). Désactivé par défaut. Quand il est
//! activé, les demandes sont envoyées à NVIDIA : l'interface le dit, et Ollama reste le repli sur ce poste si NIM échoue
//! ou n'a plus de quota. La clé n'est jamais renvoyée à l'interface.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::State;

use crate::error::AdapterError;
use crate::grants::require_main;
use crate::secrets;

/// Seul hôte interrogé pour ce service.
pub const ENDPOINT: &str = "https://integrate.api.nvidia.com/v1";
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_KEY_CHARS: usize = 200;

/// Clé acceptée : des caractères imprimables, sans espace ni guillemet, qui ne peuvent rien casser dans l'en-tête.
pub fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.chars().count() <= MAX_KEY_CHARS && key.chars().all(|c| c.is_ascii_graphic() && c != '"' && c != '\'')
}

/// Nom de modèle : identifiant NIM (« éditeur/modèle »), sans espace ni option.
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 120
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_' | ':'))
}

/// Contenu texte d'une réponse de chat, décodé en JSON. Les balises de code autour du JSON sont retirées.
pub fn parse_chat_content(body: &Value) -> Result<Value, AdapterError> {
    let content = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| AdapterError::Inference("réponse NIM sans texte".into()))?;
    let cleaned = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    serde_json::from_str(cleaned).map_err(|_| AdapterError::Inference("NIM n'a pas répondu en JSON".into()))
}

/// Classement d'une demande par NIM : même consigne et même sortie que le modèle local.
pub fn classify_at(endpoint: &str, key: &str, model: &str, text: &str, context: &[String]) -> Result<Value, AdapterError> {
    if !valid_key(key) {
        return Err(AdapterError::InvalidTarget("clé NVIDIA invalide".into()));
    }
    if !valid_model(model) {
        return Err(AdapterError::InvalidTarget("nom de modèle NVIDIA invalide".into()));
    }
    let agent = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .http_status_as_error(false)
            .user_agent("NEXUS-nim/0.1")
            .build(),
    );
    let body = json!({
        "model": model,
        "temperature": 0,
        "max_tokens": 300,
        "messages": [
            { "role": "system", "content": crate::ollama::system_prompt(context) },
            { "role": "user", "content": text }
        ]
    });
    let mut response = agent
        .post(&format!("{endpoint}/chat/completions"))
        .header("Authorization", &format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .send(body.to_string())
        .map_err(|error| AdapterError::Operation(format!("NVIDIA injoignable ({error})")))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(AdapterError::Operation(format!("NVIDIA a refusé la demande (statut HTTP {status}, quota ou clé)")));
    }
    let text_body = response
        .body_mut()
        .with_config()
        .limit(512 * 1024)
        .read_to_string()
        .map_err(|error| AdapterError::Operation(format!("réponse NVIDIA illisible ({error})")))?;
    let value: Value = serde_json::from_str(&text_body).map_err(|error| AdapterError::Inference(error.to_string()))?;
    parse_chat_content(&value)
}

/// Clé NVIDIA gardée sur ce poste, chiffrée avec DPAPI (`secrets.rs`). Elle n'est jamais renvoyée à l'interface : seul
/// son état (enregistrée ou non) l'est, et `nim_classify` la lit ici, côté natif.
pub struct KeyStore {
    path: Option<PathBuf>,
}

impl KeyStore {
    /// Dossier de données de NEXUS. Sans dossier, aucune clé ne peut être enregistrée.
    pub fn open(directory: Option<PathBuf>) -> Self {
        KeyStore { path: directory.map(|directory| directory.join("nim.key")) }
    }

    pub fn status(&self) -> bool {
        self.path.as_ref().is_some_and(|path| path.is_file())
    }

    pub fn save(&self, key: &str) -> Result<(), AdapterError> {
        let key = key.trim();
        if !valid_key(key) {
            return Err(AdapterError::InvalidTarget("clé NVIDIA invalide".into()));
        }
        let path = self.path.as_ref().ok_or_else(|| AdapterError::Operation("dossier de données indisponible".into()))?;
        let sealed = secrets::to_hex(&secrets::protect(key.as_bytes())?);
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|error| AdapterError::Operation(format!("dossier de données : {error}")))?;
        }
        std::fs::write(path, sealed).map_err(|error| AdapterError::Operation(format!("enregistrement de la clé : {error}")))
    }

    pub fn load(&self) -> Result<String, AdapterError> {
        let path = self.path.as_ref().ok_or_else(|| AdapterError::Operation("dossier de données indisponible".into()))?;
        let sealed = std::fs::read_to_string(path).map_err(|_| AdapterError::InvalidTarget("aucune clé NVIDIA enregistrée".into()))?;
        let cipher = secrets::from_hex(sealed.trim()).ok_or_else(|| AdapterError::Operation("clé NVIDIA illisible".into()))?;
        let plain = secrets::unprotect(&cipher)?;
        String::from_utf8(plain).map_err(|_| AdapterError::Operation("clé NVIDIA illisible".into()))
    }

    pub fn clear(&self) -> Result<(), AdapterError> {
        match self.path.as_ref() {
            Some(path) if path.is_file() => std::fs::remove_file(path).map_err(|error| AdapterError::Operation(format!("suppression de la clé : {error}"))),
            _ => Ok(()),
        }
    }
}

#[tauri::command]
pub fn nim_key_status(webview: tauri::Webview, store: State<'_, KeyStore>) -> Result<bool, AdapterError> {
    require_main(&webview)?;
    Ok(store.status())
}

#[tauri::command]
pub fn nim_key_save(webview: tauri::Webview, store: State<'_, KeyStore>, key: String) -> Result<(), AdapterError> {
    require_main(&webview)?;
    store.save(&key)
}

#[tauri::command]
pub fn nim_key_clear(webview: tauri::Webview, store: State<'_, KeyStore>) -> Result<(), AdapterError> {
    require_main(&webview)?;
    store.clear()
}

/// Classement par NIM avec la clé enregistrée. Sans clé, la commande échoue et le modèle local prend le relais.
#[tauri::command]
pub async fn nim_classify(webview: tauri::Webview, store: State<'_, KeyStore>, model: String, text: String, context: Vec<String>) -> Result<Value, AdapterError> {
    require_main(&webview)?;
    let key = store.load()?;
    tauri::async_runtime::spawn_blocking(move || classify_at(ENDPOINT, &key, &model, &text, &context))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_model_names_cannot_break_the_request() {
        assert!(valid_key("nvapi-abc123"));
        assert!(!valid_key("nvapi abc"));
        assert!(!valid_key("a\"b"));
        assert!(!valid_key(""));
        assert!(valid_model("meta/llama-3.1-8b-instruct"));
        assert!(!valid_model("x --help"));
    }

    #[test]
    fn the_answer_is_read_even_inside_code_fences() {
        let body = json!({ "choices": [{ "message": { "content": "```json\n{\"type\": \"HELP\"}\n```" } }] });
        assert_eq!(parse_chat_content(&body).unwrap(), json!({ "type": "HELP" }));
    }

    #[test]
    fn an_answer_that_is_not_json_is_refused() {
        let body = json!({ "choices": [{ "message": { "content": "bonjour" } }] });
        assert!(parse_chat_content(&body).is_err());
    }

    #[test]
    fn the_key_is_kept_encrypted_and_read_back_only_natively() {
        let directory = std::env::temp_dir().join(format!("nexus-nim-key-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let store = KeyStore::open(Some(directory.clone()));
        assert!(!store.status());
        store.save("nvapi-cle-de-test-123").unwrap();
        assert!(store.status());
        let on_disk = std::fs::read_to_string(directory.join("nim.key")).unwrap();
        assert!(!on_disk.contains("nvapi-cle-de-test-123"), "la clé ne doit pas être écrite en clair");
        if cfg!(windows) {
            assert_eq!(store.load().unwrap(), "nvapi-cle-de-test-123");
        }
        store.clear().unwrap();
        assert!(!store.status());
        assert!(store.load().is_err());
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn an_invalid_key_or_a_missing_folder_is_never_saved() {
        assert!(KeyStore::open(None).save("nvapi-abc").is_err());
        let directory = std::env::temp_dir().join(format!("nexus-nim-bad-{}", std::process::id()));
        let store = KeyStore::open(Some(directory.clone()));
        assert!(store.save("cle avec espace").is_err());
        assert!(!store.status());
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_bad_key_never_reaches_the_network() {
        assert!(classify_at("http://127.0.0.1:1", "bad key", "meta/llama", "x", &[]).is_err());
    }
}
