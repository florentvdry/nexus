//! NVIDIA NIM en option (API compatible OpenAI, quota gratuit avec une clé personnelle). Désactivé par défaut. Quand il est
//! activé, les demandes sont envoyées à NVIDIA : l'interface le dit, et Ollama reste le repli sur ce poste si NIM échoue
//! ou n'a plus de quota. La clé n'est jamais renvoyée à l'interface.

use std::time::Duration;

use serde_json::{json, Value};

use crate::error::AdapterError;
use crate::grants::require_core;

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

#[tauri::command]
pub async fn nim_classify(caller: String, key: String, model: String, text: String, context: Vec<String>) -> Result<Value, AdapterError> {
    require_core(&caller)?;
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
    fn a_bad_key_never_reaches_the_network() {
        assert!(classify_at("http://127.0.0.1:1", "bad key", "meta/llama", "x", &[]).is_err());
    }
}
