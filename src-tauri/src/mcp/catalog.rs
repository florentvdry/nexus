//! Catalogue de confiance : le registre officiel des serveurs MCP (registry.modelcontextprotocol.io) est la seule source.
//! Seuls les paquets npm lancés en local (stdio) sont proposés, et seulement si leur dépôt GitHub a assez d'étoiles.
//! Le résultat d'une recherche est mémorisé : une installation ne peut viser qu'un connecteur que la recherche a trouvé.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AdapterError;

pub const REGISTRY: &str = "https://registry.modelcontextprotocol.io";
pub const GITHUB: &str = "https://api.github.com";
/// Popularité minimale du dépôt GitHub (étoiles) pour proposer un connecteur.
pub const MIN_STARS: u64 = 50;
/// Nombre d'entrées du registre examinées (chacune coûte une requête GitHub, limitée à 60 par heure sans jeton).
const SCANNED: usize = 8;
const SHOWN: usize = 5;
const REGISTRY_LIMIT: usize = 20;
const MAX_QUERY_CHARS: usize = 60;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY_BYTES: u64 = 2 * 1024 * 1024;
const USER_AGENT: &str = "NEXUS-connecteurs/0.1";
const OFFICIAL_KEY: &str = "io.modelcontextprotocol.registry/official";

/// Variable d'environnement attendue par un connecteur (jeton, identifiant de compte…).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvSpec {
    pub name: String,
    pub required: bool,
    pub secret: bool,
    pub description: String,
}

/// Connecteur proposé : d'où il vient, sa popularité et ce qu'il demande pour fonctionner.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub title: String,
    pub description: String,
    pub repository: String,
    pub stars: u64,
    pub package: String,
    pub version: String,
    pub env: Vec<EnvSpec>,
}

/// Cache de recherche : les étoiles déjà lues et les connecteurs déjà trouvés (un identifiant doit venir d'une recherche).
#[derive(Default)]
pub struct Catalog {
    stars: Mutex<HashMap<String, u64>>,
    found: Mutex<HashMap<String, Candidate>>,
}

impl Catalog {
    /// Cherche dans le registre, garde les dépôts assez populaires et les classe par étoiles.
    pub fn search(&self, registry: &str, github: &str, query: &str) -> Result<Vec<Candidate>, AdapterError> {
        if !valid_query(query) {
            return Err(AdapterError::InvalidTarget("recherche invalide : lettres, chiffres et espaces seulement".into()));
        }
        let body = get_json(&format!("{registry}/v0/servers?search={}&limit={REGISTRY_LIMIT}", query.trim().replace(' ', "%20")))?;
        let mut found = Vec::new();
        for entry in registry_candidates(&body).into_iter().take(SCANNED) {
            let Some((owner, repo)) = repository_slug(&entry.repository) else { continue };
            let Some(stars) = self.stars_of(github, &owner, &repo) else { continue };
            if stars >= MIN_STARS {
                found.push(Candidate { stars, ..entry });
            }
        }
        found.sort_by_key(|candidate| std::cmp::Reverse(candidate.stars));
        found.truncate(SHOWN);
        let mut known = self.found.lock().unwrap_or_else(|error| error.into_inner());
        for candidate in &found {
            known.insert(candidate.id.clone(), candidate.clone());
        }
        Ok(found)
    }

    /// Connecteur trouvé par la dernière recherche, s'il existe encore.
    pub fn get(&self, id: &str) -> Option<Candidate> {
        self.found.lock().unwrap_or_else(|error| error.into_inner()).get(id).cloned()
    }

    fn stars_of(&self, github: &str, owner: &str, repo: &str) -> Option<u64> {
        let key = format!("{owner}/{repo}");
        if let Some(stars) = self.stars.lock().unwrap_or_else(|error| error.into_inner()).get(&key) {
            return Some(*stars);
        }
        let stars = github_stars_at(github, owner, repo)?;
        self.stars.lock().unwrap_or_else(|error| error.into_inner()).insert(key, stars);
        Some(stars)
    }
}

/// Recherche acceptée : quelques mots simples. Rien qui ressemble à une adresse, une option ou un chemin.
pub fn valid_query(query: &str) -> bool {
    let trimmed = query.trim();
    (2..=MAX_QUERY_CHARS).contains(&trimmed.chars().count()) && trimmed.chars().all(|c| c.is_alphanumeric() || " -_.".contains(c))
}

/// Nom de paquet npm (éventuellement à portée `@scope/nom`), en minuscules.
pub fn valid_package(name: &str) -> bool {
    let bare = match name.strip_prefix('@') {
        Some(scoped) => match scoped.split_once('/') {
            Some((scope, package)) if valid_segment(scope) => package,
            _ => return false,
        },
        None => name,
    };
    valid_segment(bare) && name.len() <= 214
}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && segment.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn valid_version(version: &str) -> bool {
    !version.is_empty() && version.len() <= 40 && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
}

/// Propriétaire et dépôt d'une URL GitHub. Toute autre adresse est refusée.
pub fn repository_slug(url: &str) -> Option<(String, String)> {
    let path = url.trim().strip_prefix("https://github.com/")?;
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?.trim_end_matches(".git");
    let safe = |part: &str| !matches!(part, "" | "." | "..") && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    (safe(owner) && safe(repo)).then(|| (owner.to_string(), repo.to_string()))
}

/// Entrées du registre officiel utilisables : serveur actif, paquet npm lancé en stdio, dépôt GitHub connu.
/// Les étoiles ne sont pas encore lues : elles valent 0 et sont complétées par la recherche.
pub fn registry_candidates(body: &Value) -> Vec<Candidate> {
    let Some(servers) = body.get("servers").and_then(Value::as_array) else { return Vec::new() };
    servers.iter().filter_map(candidate_from_entry).collect()
}

fn candidate_from_entry(entry: &Value) -> Option<Candidate> {
    let status = entry.get("_meta")?.get(OFFICIAL_KEY)?.get("status").and_then(Value::as_str)?;
    if status != "active" {
        return None;
    }
    let server = entry.get("server")?;
    let id = server.get("name").and_then(Value::as_str)?.to_string();
    let repository = server.pointer("/repository/url").and_then(Value::as_str)?.to_string();
    let package = server.get("packages")?.as_array()?.iter().find(|item| {
        item.get("registryType").and_then(Value::as_str) == Some("npm") && item.pointer("/transport/type").and_then(Value::as_str) == Some("stdio")
    })?;
    let name = package.get("identifier").and_then(Value::as_str)?;
    let version = package.get("version").and_then(Value::as_str)?;
    if !valid_package(name) || !valid_version(version) {
        return None;
    }
    let title = server.get("title").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| id.rsplit('/').next().unwrap_or(&id).to_string());
    let env = package.get("environmentVariables").and_then(Value::as_array).map(|items| items.iter().filter_map(env_spec).collect()).unwrap_or_default();
    Some(Candidate {
        id,
        title,
        description: server.get("description").and_then(Value::as_str).unwrap_or_default().to_string(),
        repository,
        stars: 0,
        package: name.to_string(),
        version: version.to_string(),
        env,
    })
}

fn env_spec(item: &Value) -> Option<EnvSpec> {
    let name = item.get("name").and_then(Value::as_str)?;
    let valid = !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    valid.then(|| EnvSpec {
        name: name.to_string(),
        required: item.get("isRequired").and_then(Value::as_bool).unwrap_or(false),
        secret: item.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
        description: item.get("description").and_then(Value::as_str).unwrap_or_default().to_string(),
    })
}

/// Nombre d'étoiles d'un dépôt GitHub. `None` si GitHub ne répond pas : le connecteur est alors écarté.
fn github_stars_at(endpoint: &str, owner: &str, repo: &str) -> Option<u64> {
    let body = get_json(&format!("{endpoint}/repos/{owner}/{repo}")).ok()?;
    body.get("stargazers_count").and_then(Value::as_u64)
}

fn agent() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(NETWORK_TIMEOUT))
            .http_status_as_error(false)
            .user_agent(USER_AGENT)
            .build(),
    )
}

fn get_json(url: &str) -> Result<Value, AdapterError> {
    let mut response = agent()
        .get(url)
        .header("Accept", "application/json")
        .call()
        .map_err(|error| AdapterError::Operation(format!("catalogue injoignable ({error})")))?;
    if response.status().as_u16() != 200 {
        return Err(AdapterError::Operation(format!("catalogue : réponse HTTP {}", response.status().as_u16())));
    }
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY_BYTES)
        .read_to_string()
        .map_err(|error| AdapterError::Operation(format!("catalogue illisible ({error})")))?;
    serde_json::from_str(&text).map_err(|error| AdapterError::Operation(format!("catalogue invalide ({error})")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Faux serveur : répond à chaque requête selon le début de son chemin. Renvoie son adresse.
    fn serve(routes: Vec<(&'static str, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("port libre");
        let address = listener.local_addr().expect("adresse");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buffer = [0u8; 4096];
                let read = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, body) = routes
                    .iter()
                    .find(|(prefix, _)| path.starts_with(prefix))
                    .map(|(_, body)| ("200 OK", *body))
                    .unwrap_or(("404 Not Found", "{}"));
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        format!("http://{address}")
    }

    const REGISTRY_BODY: &str = r#"{"servers":[
        {"server":{"name":"app.example/discord","description":"Discord","repository":{"url":"https://github.com/acme/discord-mcp"},
          "packages":[{"registryType":"npm","identifier":"@acme/discord-mcp","version":"1.2.0","transport":{"type":"stdio"},
            "environmentVariables":[{"name":"DISCORD_BOT_TOKEN","isRequired":true,"isSecret":true,"description":"Jeton du bot"}]}]},
         "_meta":{"io.modelcontextprotocol.registry/official":{"status":"active"}}},
        {"server":{"name":"app.example/oci-only","description":"Image seulement","repository":{"url":"https://github.com/acme/oci"},
          "packages":[{"registryType":"oci","identifier":"ghcr.io/acme/oci:1","transport":{"type":"stdio"}}]},
         "_meta":{"io.modelcontextprotocol.registry/official":{"status":"active"}}},
        {"server":{"name":"app.example/retired","description":"Retiré","repository":{"url":"https://github.com/acme/old"},
          "packages":[{"registryType":"npm","identifier":"old-mcp","version":"0.1.0","transport":{"type":"stdio"}}]},
         "_meta":{"io.modelcontextprotocol.registry/official":{"status":"deleted"}}},
        {"server":{"name":"app.example/bad-name","description":"Nom dangereux","repository":{"url":"https://github.com/acme/bad"},
          "packages":[{"registryType":"npm","identifier":"../../evil","version":"1.0.0","transport":{"type":"stdio"}}]},
         "_meta":{"io.modelcontextprotocol.registry/official":{"status":"active"}}}
    ]}"#;

    #[test]
    fn only_active_npm_stdio_packages_with_safe_names_are_kept() {
        let body: Value = serde_json::from_str(REGISTRY_BODY).unwrap();
        let candidates = registry_candidates(&body);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].package, "@acme/discord-mcp");
        assert_eq!(candidates[0].title, "discord");
        assert_eq!(candidates[0].env, vec![EnvSpec { name: "DISCORD_BOT_TOKEN".into(), required: true, secret: true, description: "Jeton du bot".into() }]);
    }

    #[test]
    fn only_github_repositories_are_accepted_as_proof_of_popularity() {
        assert_eq!(repository_slug("https://github.com/acme/discord-mcp.git"), Some(("acme".into(), "discord-mcp".into())));
        assert_eq!(repository_slug("https://gitlab.com/acme/discord-mcp"), None);
        assert_eq!(repository_slug("https://github.com/acme/../x"), None);
    }

    #[test]
    fn queries_with_symbols_never_reach_the_network() {
        assert!(valid_query("discord"));
        assert!(valid_query("google drive"));
        assert!(!valid_query("x"));
        assert!(!valid_query("discord?limit=999"));
        assert!(!valid_query("../secret"));
    }

    #[test]
    fn search_keeps_popular_repositories_sorted_by_stars() {
        let registry = serve(vec![("/v0/servers", REGISTRY_BODY)]);
        let github = serve(vec![("/repos/acme/discord-mcp", r#"{"stargazers_count": 120}"#), ("/repos/acme/oci", r#"{"stargazers_count": 900}"#)]);
        let catalog = Catalog::default();
        let found = catalog.search(&registry, &github, "discord").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].stars, 120);
        assert!(catalog.get("app.example/discord").is_some());
        assert!(catalog.get("app.example/oci-only").is_none());
    }

    #[test]
    fn a_repository_under_the_threshold_is_not_proposed() {
        let registry = serve(vec![("/v0/servers", REGISTRY_BODY)]);
        let github = serve(vec![("/repos/acme/discord-mcp", r#"{"stargazers_count": 3}"#)]);
        let found = Catalog::default().search(&registry, &github, "discord").unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn an_unreachable_registry_is_reported_not_hidden() {
        let error = Catalog::default().search("http://127.0.0.1:9", "http://127.0.0.1:9", "discord").unwrap_err();
        assert!(error.to_string().contains("catalogue"), "{error}");
    }
}
