//! Sources publiques des fenêtres « une demande = une fenêtre » : Wikipédia (résumé d'un sujet) et Wikimedia Commons
//! (photo, avec son auteur et sa licence). L'image est téléchargée ici, bornée en taille, et renvoyée en data URL : la
//! politique de l'interface n'autorise que les images locales, et elle ne doit pas être élargie.
//!
//! Recherche générale : DuckDuckGo (version HTML, sans clé), puis lecture des pages trouvées, en HTTP(S), bornée, sans
//! suivre les adresses locales ou privées écrites dans la demande. Aucun compte, aucune clé.

use serde::Serialize;
use serde_json::Value;

use crate::error::AdapterError;
use crate::grants::require_main;

pub const WIKIPEDIA: &str = "https://fr.wikipedia.org";
pub const COMMONS: &str = "https://commons.wikimedia.org";
/// Google Actualités : recherche d'actualités sur tout le web, flux RSS public, sans clé (vérifié le 24/10/2026).
pub const GOOGLE_NEWS: &str = "https://news.google.com";
/// Flux RSS de France 24 (version française), vérifié le 24/10/2026 : 24 éléments datés.
pub const FRANCE24_RSS: &str = "https://www.france24.com/fr/rss";
pub const DUCKDUCKGO: &str = "https://html.duckduckgo.com";
const MAX_RSS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_HEADLINES: usize = 8;
const MAX_JSON_BYTES: u64 = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAX_QUERY_CHARS: usize = 100;
const MAX_NEWS: usize = 10;
const MAX_SEARCH_HITS: usize = 5;
const MAX_QUESTION_CHARS: usize = 200;
const MAX_PAGE_BYTES: u64 = 1024 * 1024;
const MAX_PAGE_CHARS: usize = 6000;
const USER_AGENT: &str = "NEXUS/0.1 (assistant personnel ; requêtes publiques)";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub title: String,
    pub extract: String,
    pub page: String,
}

/// Un élément de l'actualité du jour (Wikipédia fr, « à la une » du jour) et sa page de référence.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub text: String,
    pub page: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub title: String,
    /// Image téléchargée, en data URL (`data:image/jpeg;base64,…`).
    pub data_url: String,
    pub credit: String,
    pub license: String,
    pub page: String,
}

/// Requête acceptée : des mots, pas d'adresse, pas de chemin ni d'option.
pub fn valid_query(query: &str) -> bool {
    let trimmed = query.trim();
    (2..=MAX_QUERY_CHARS).contains(&trimmed.chars().count())
        && trimmed.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '\'' | '’' | '(' | ')'))
}

/// Valeur d'une balise simple dans un fragment XML (CDATA et entités courantes décodés).
fn tag_text(fragment: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = fragment.find(&open)? + open.len();
    let end = fragment[start..].find(&close)? + start;
    let raw = fragment[start..end].trim();
    let inner = raw.strip_prefix("<![CDATA[").and_then(|value| value.strip_suffix("]]>")).unwrap_or(raw);
    let decoded = inner
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'");
    let cleaned = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

/// Titres et liens d'un flux RSS. Un élément sans titre ou sans lien est ignoré.
pub fn rss_headlines(xml: &str) -> Vec<NewsItem> {
    xml.split("<item>")
        .skip(1)
        .filter_map(|part| {
            let item = part.split("</item>").next().unwrap_or(part);
            let text = tag_text(item, "title")?;
            let page = tag_text(item, "link")?;
            (page.starts_with("https://") || page.starts_with("http://")).then_some(NewsItem { text, page })
        })
        .take(MAX_HEADLINES)
        .collect()
}

/// URL du flux d'actualités : la recherche sur un sujet, ou les titres du moment sans sujet. Le sujet est validé.
pub fn news_url(endpoint: &str, topic: Option<&str>) -> Result<String, AdapterError> {
    match topic.map(str::trim).filter(|value| !value.is_empty()) {
        Some(query) if valid_query(query) => Ok(format!("{endpoint}/rss/search?q={}&hl=fr&gl=FR&ceid=FR:fr", percent_encode(query))),
        Some(_) => Err(AdapterError::InvalidTarget("sujet d'actualité invalide : quelques mots, sans symboles".into())),
        None => Ok(format!("{endpoint}/rss?hl=fr&gl=FR&ceid=FR:fr")),
    }
}

/// Actualités d'un sujet, ou du moment, par Google Actualités. Aucun résultat : liste vide, sans erreur.
pub fn news_search_at(endpoint: &str, topic: Option<&str>) -> Result<Vec<NewsItem>, AdapterError> {
    let (status, _, bytes) = fetch(&news_url(endpoint, topic)?, MAX_RSS_BYTES)?;
    if status != 200 {
        return Err(AdapterError::Operation(format!("actualités : réponse HTTP {status}")));
    }
    Ok(rss_headlines(&String::from_utf8_lossy(&bytes)))
}

#[tauri::command]
pub async fn web_news_search(webview: tauri::Webview, topic: Option<String>) -> Result<Vec<NewsItem>, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || news_search_at(GOOGLE_NEWS, topic.as_deref()))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Titres du jour de France 24 (fr), depuis son flux RSS officiel.
pub fn france24_at(endpoint: &str) -> Result<Vec<NewsItem>, AdapterError> {
    let (status, _, bytes) = fetch(endpoint, MAX_RSS_BYTES)?;
    if status != 200 {
        return Err(AdapterError::Operation(format!("France 24 : réponse HTTP {status}")));
    }
    Ok(rss_headlines(&String::from_utf8_lossy(&bytes)))
}

#[tauri::command]
pub async fn web_headlines(webview: tauri::Webview) -> Result<Vec<NewsItem>, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(|| france24_at(FRANCE24_RSS))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Date au format AAAA-MM-JJ, avec des chiffres seulement : elle entre dans une URL.
pub fn valid_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(index, byte)| if index == 4 || index == 7 { *byte == b'-' } else { byte.is_ascii_digit() })
        && date[5..7].parse::<u8>().is_ok_and(|month| (1..=12).contains(&month))
        && date[8..10].parse::<u8>().is_ok_and(|day| (1..=31).contains(&day))
}

/// Encodage d'un segment d'URL : tout sauf les lettres ASCII, chiffres et `-_.~` est encodé en pour-cent.
pub fn percent_encode(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Encodage base64 standard (avec remplissage), sans dépendance supplémentaire.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(triple >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[triple as usize & 63] as char } else { '=' });
    }
    out
}

/// Résolution DNS qui ne garde que les adresses publiques. Elle s'applique à chaque connexion, donc aussi à chaque
/// redirection : un nom qui pointe vers une adresse locale ou privée est refusé, et seules les adresses retenues ici
/// sont utilisées pour se connecter (pas de seconde résolution, donc pas de rebinding entre contrôle et connexion).
#[derive(Debug)]
struct PublicResolver;

impl ureq::unversioned::resolver::Resolver for PublicResolver {
    fn resolve(
        &self,
        uri: &ureq::http::Uri,
        config: &ureq::config::Config,
        timeout: ureq::unversioned::transport::NextTimeout,
    ) -> Result<ureq::unversioned::resolver::ResolvedSocketAddrs, ureq::Error> {
        let found = ureq::unversioned::resolver::DefaultResolver::default().resolve(uri, config, timeout)?;
        let addresses: Vec<std::net::SocketAddr> = found.iter().copied().collect();
        public_addresses(&addresses).ok_or_else(|| ureq::Error::Io(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "adresse non publique refusée")))
    }
}

/// Adresses publiques parmi celles qu'un nom a donné, ou `None` si aucune ne l'est.
fn public_addresses(found: &[std::net::SocketAddr]) -> Option<ureq::unversioned::resolver::ResolvedSocketAddrs> {
    let placeholder = std::net::SocketAddr::from(([0, 0, 0, 0], 0));
    let mut public = ureq::unversioned::resolver::ResolvedSocketAddrs::from_fn(|_| placeholder);
    for address in found.iter().filter(|address| is_public_ip(address.ip())) {
        let _ = public.try_push(*address);
    }
    (!public.is_empty()).then_some(public)
}

/// Vrai pour une adresse routable sur Internet. Les adresses IPv4 mappées en IPv6 sont jugées comme IPv4 ; les
/// préfixes de transition (6to4, NAT64) sont refusés par prudence, car ils peuvent embarquer une adresse privée.
pub fn is_public_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(v4) => is_public_v4(v4),
        std::net::IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(address: std::net::Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_unspecified()
        || address.is_broadcast()
        || address.is_multicast()
        || address.is_documentation()
        || first == 0
        || (first == 100 && (second & 0xc0) == 64) // 100.64.0.0/10, partage d'adresse opérateur
        || (first == 192 && second == 0 && third == 0) // 192.0.0.0/24, affectations IETF
        || (first == 198 && (second & 0xfe) == 18) // 198.18.0.0/15, tests de performance
        || first >= 240) // 240.0.0.0/4, réservé
}

fn is_public_v6(address: std::net::Ipv6Addr) -> bool {
    let segments = address.segments();
    let first = segments[0];
    let unicast_prefix_zero = segments[..6].iter().all(|segment| *segment == 0); // ::/96, dont ::1
    !(address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        || unicast_prefix_zero
        || (first & 0xfe00) == 0xfc00 // fc00::/7, adresses locales uniques
        || (first & 0xffc0) == 0xfe80 // fe80::/10, lien local
        || (first & 0xffc0) == 0xfec0 // fec0::/10, site local (obsolète)
        || (first == 0x2001 && segments[1] == 0x0db8) // 2001:db8::/32, documentation
        || first == 0x2002 // 2002::/16, 6to4
        || (first == 0x0064 && segments[1] == 0xff9b)) // 64:ff9b::/96, NAT64
}

/// Agent HTTP : une seule adresse publique par connexion, pas de proxy (il résoudrait la cible à sa place).
fn agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(crate::resilience::delay_for(crate::resilience::Budget::Web)))
        .http_status_as_error(false)
        .user_agent(USER_AGENT)
        .proxy(None)
        .build();
    ureq::Agent::with_parts(config, ureq::unversioned::transport::DefaultConnector::new(), PublicResolver)
}

/// Corps d'une réponse, borné. Un statut autre que 200 est une erreur, sauf pour le 404 que l'appelant traite.
fn fetch(url: &str, limit: u64) -> Result<(u16, String, Vec<u8>), AdapterError> {
    let mut response = agent().get(url).call().map_err(|error| AdapterError::Operation(format!("source injoignable ({error})")))?;
    let status = response.status().as_u16();
    let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    let bytes = response
        .body_mut()
        .with_config()
        .limit(limit)
        .read_to_vec()
        .map_err(|error| AdapterError::Operation(format!("réponse illisible ({error})")))?;
    Ok((status, content_type, bytes))
}

fn json(url: &str) -> Result<Option<Value>, AdapterError> {
    let (status, _, bytes) = fetch(url, MAX_JSON_BYTES)?;
    if status == 404 {
        return Ok(None);
    }
    if status != 200 {
        return Err(AdapterError::Operation(format!("source : réponse HTTP {status}")));
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|error| AdapterError::Operation(format!("source invalide ({error})")))
}

/// Résumé d'un sujet dans Wikipédia (fr). Aucune page trouvée : une erreur qui le dit.
pub fn summary_at(endpoint: &str, query: &str) -> Result<Summary, AdapterError> {
    if !valid_query(query) {
        return Err(AdapterError::InvalidTarget("sujet invalide : quelques mots, sans symboles".into()));
    }
    let url = format!("{endpoint}/api/rest_v1/page/summary/{}", percent_encode(query.trim()));
    let value = json(&url)?.ok_or_else(|| AdapterError::Operation(format!("aucune page trouvée pour « {} »", query.trim())))?;
    let extract = value.get("extract").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if extract.is_empty() {
        return Err(AdapterError::Operation(format!("la page de « {} » n'a pas de résumé", query.trim())));
    }
    Ok(Summary {
        title: value.get("title").and_then(Value::as_str).unwrap_or(query.trim()).to_string(),
        extract,
        page: value.pointer("/content_urls/desktop/page").and_then(Value::as_str).unwrap_or_default().to_string(),
    })
}

/// Retire les balises HTML qui accompagnent l'auteur dans Commons, et les espaces superflus.
fn plain(text: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for character in text.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Premier candidat photo d'une réponse Commons : une image JPEG, PNG ou WebP, avec sa miniature.
pub fn photo_candidate(value: &Value) -> Option<(String, String, String, String, String)> {
    let pages = value.pointer("/query/pages")?.as_object()?;
    let mut ranked: Vec<&Value> = pages.values().collect();
    ranked.sort_by_key(|page| page.get("index").and_then(Value::as_u64).unwrap_or(u64::MAX));
    ranked.iter().find_map(|page| {
        let info = page.pointer("/imageinfo/0")?;
        let mime = info.get("mime").and_then(Value::as_str)?;
        if !matches!(mime, "image/jpeg" | "image/png" | "image/webp") {
            return None;
        }
        let thumb = info.get("thumburl").and_then(Value::as_str)?.to_string();
        let title = page.get("title").and_then(Value::as_str).unwrap_or_default().trim_start_matches("File:").to_string();
        let credit = plain(info.pointer("/extmetadata/Artist/value").and_then(Value::as_str).unwrap_or("auteur inconnu"));
        let license = plain(info.pointer("/extmetadata/LicenseShortName/value").and_then(Value::as_str).unwrap_or("licence non précisée"));
        let page_url = info.get("descriptionurl").and_then(Value::as_str).unwrap_or_default().to_string();
        Some((title, thumb, credit, license, page_url))
    })
}

/// Seules les images hébergées par Wikimedia sont téléchargées.
pub fn trusted_image_url(url: &str) -> bool {
    url.starts_with("https://upload.wikimedia.org/") || url.starts_with("https://thumb.wikimedia.org/")
}

/// Une photo de Commons pour le sujet demandé, avec son auteur et sa licence.
pub fn photo_at(endpoint: &str, query: &str) -> Result<Photo, AdapterError> {
    if !valid_query(query) {
        return Err(AdapterError::InvalidTarget("sujet invalide : quelques mots, sans symboles".into()));
    }
    let url = format!(
        "{endpoint}/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=960&format=json&gsrsearch={}",
        percent_encode(query.trim())
    );
    let value = json(&url)?.ok_or_else(|| AdapterError::Operation("Wikimedia Commons n'a pas répondu".into()))?;
    let (title, thumb, credit, license, page) =
        photo_candidate(&value).ok_or_else(|| AdapterError::Operation(format!("aucune photo libre trouvée pour « {} »", query.trim())))?;
    if !trusted_image_url(&thumb) {
        return Err(AdapterError::Operation("image refusée : hôte non Wikimedia".into()));
    }
    let (status, content_type, bytes) = fetch(&thumb, MAX_IMAGE_BYTES)?;
    if status != 200 || !content_type.starts_with("image/") {
        return Err(AdapterError::Operation("image indisponible".into()));
    }
    Ok(Photo {
        title,
        data_url: format!("data:{};base64,{}", content_type.split(';').next().unwrap_or("image/jpeg"), base64(&bytes)),
        credit,
        license,
        page,
    })
}

/// Actualités d'une date (AAAA-MM-JJ) : le flux « à la une » de Wikipédia fr. Une date sans publication est une erreur.
pub fn news_at(endpoint: &str, date: &str) -> Result<Vec<NewsItem>, AdapterError> {
    if !valid_date(date) {
        return Err(AdapterError::InvalidTarget("date invalide".into()));
    }
    let url = format!("{endpoint}/api/rest_v1/feed/featured/{}/{}/{}", &date[0..4], &date[5..7], &date[8..10]);
    let value = json(&url)?.ok_or_else(|| AdapterError::Operation(format!("aucune actualité publiée pour le {date}")))?;
    let items = value.get("news").and_then(Value::as_array).map(|news| {
        news.iter()
            .filter_map(|entry| {
                let text = plain(entry.get("story").and_then(Value::as_str)?);
                let page = entry.pointer("/links/0/content_urls/desktop/page").and_then(Value::as_str)?.to_string();
                (!text.is_empty()).then_some(NewsItem { text, page })
            })
            .take(MAX_NEWS)
            .collect::<Vec<_>>()
    });
    Ok(items.unwrap_or_default())
}

#[tauri::command]
pub async fn web_news(webview: tauri::Webview, date: String) -> Result<Vec<NewsItem>, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || news_at(WIKIPEDIA, &date))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub async fn web_summary(webview: tauri::Webview, query: String) -> Result<Summary, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || summary_at(WIKIPEDIA, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub async fn web_photo(webview: tauri::Webview, query: String) -> Result<Photo, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || photo_at(COMMONS, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

/// Un résultat de recherche : titre, adresse de la page, extrait.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Texte lisible d'une page web, avec son adresse.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PageText {
    pub url: String,
    pub text: String,
}

/// Texte d'un fragment HTML : balises remplacées par des espaces, entités décodées, espaces réduits.
fn html_text(fragment: &str) -> String {
    let mut spaced = String::with_capacity(fragment.len());
    let mut inside = false;
    for character in fragment.chars() {
        match character {
            '<' => {
                inside = true;
                spaced.push(' ');
            }
            '>' if inside => {
                inside = false;
                spaced.push(' ');
            }
            _ if !inside => spaced.push(character),
            _ => {}
        }
    }
    // « &amp; » en dernier : « &amp;lt; » doit donner « &lt; », pas « < ».
    let decoded = spaced
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Décodage des séquences %XX d'une adresse de redirection.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let decoded = (bytes[index] == b'%' && index + 2 < bytes.len())
            .then(|| std::str::from_utf8(&bytes[index + 1..index + 3]).ok().and_then(|hex| u8::from_str_radix(hex, 16).ok()))
            .flatten();
        match decoded {
            Some(value) => {
                out.push(value);
                index += 3;
            }
            None => {
                out.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Adresse réelle d'un résultat : DuckDuckGo l'enveloppe dans un paramètre `uddg`.
fn destination(href: &str) -> String {
    let raw = match href.find("uddg=") {
        Some(at) => percent_decode(href[at + 5..].split('&').next().unwrap_or_default()),
        None => href.to_string(),
    };
    if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw
    }
}

/// Résultats d'une page de recherche DuckDuckGo (version HTML). Un résultat sans titre ou sans adresse web est ignoré.
pub fn search_hits(html: &str) -> Vec<SearchHit> {
    html.split("class=\"result__a\"")
        .skip(1)
        .filter_map(|part| {
            let href_start = part.find("href=\"")? + 6;
            let href_end = part[href_start..].find('"')? + href_start;
            let url = destination(&part[href_start..href_end]);
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return None;
            }
            let title_start = part[href_end..].find('>')? + href_end + 1;
            let title_end = part[title_start..].find("</a>")? + title_start;
            let title = html_text(&part[title_start..title_end]);
            let snippet = part
                .find("result__snippet")
                .and_then(|at| {
                    let rest = &part[at..];
                    let start = rest.find('>')? + 1;
                    let end = rest[start..].find("</a>")? + start;
                    Some(html_text(&rest[start..end]))
                })
                .unwrap_or_default();
            (!title.is_empty()).then_some(SearchHit { title, url, snippet })
        })
        .take(MAX_SEARCH_HITS)
        .collect()
}

/// Recherche web générale, sans clé : DuckDuckGo (version HTML). La question est transmise telle quelle, bornée.
pub fn search_at(endpoint: &str, question: &str) -> Result<Vec<SearchHit>, AdapterError> {
    let question = question.trim();
    if question.is_empty() || question.chars().count() > MAX_QUESTION_CHARS || question.contains(['\n', '\r']) {
        return Err(AdapterError::InvalidTarget("question trop longue ou vide".into()));
    }
    let (status, _, bytes) = fetch(&format!("{endpoint}/html/?q={}", percent_encode(question)), MAX_PAGE_BYTES)?;
    if status != 200 {
        return Err(AdapterError::Operation(format!("recherche : réponse HTTP {status}")));
    }
    Ok(search_hits(&String::from_utf8_lossy(&bytes)))
}

/// Adresse acceptable pour la lecture : http(s), sans identifiants ni port, hors machines locales et réseaux privés.
/// Contrôle sur le texte seulement : la destination réelle (nom résolu, redirections) est filtrée par `PublicResolver`.
pub fn public_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains(['@', ':', '[', ' ']) {
        return false;
    }
    let host = authority.to_ascii_lowercase();
    if let Ok(address) = host.parse::<std::net::Ipv4Addr>() {
        return !(address.is_private() || address.is_loopback() || address.is_link_local() || address.is_unspecified() || address.is_broadcast());
    }
    let blocked = ["localhost", ".localhost", ".local", ".internal", ".lan"].iter().any(|suffix| host == *suffix || host.ends_with(suffix));
    host.contains('.') && !blocked && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// Retire le contenu d'un élément (scripts, styles) avant d'extraire le texte.
fn remove_elements(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(start) = lower[cursor..].find(&open).map(|at| at + cursor) {
        out.push_str(&html[cursor..start]);
        match lower[start..].find(&close) {
            Some(end) => cursor = start + end + close.len(),
            None => {
                cursor = html.len();
                break;
            }
        }
    }
    out.push_str(&html[cursor..]);
    out
}

/// Texte lisible d'une page HTML, borné en longueur.
pub fn page_text(html: &str) -> String {
    let visible = ["script", "style", "noscript"].iter().fold(html.to_string(), |text, tag| remove_elements(&text, tag));
    html_text(&visible).chars().take(MAX_PAGE_CHARS).collect()
}

/// Lecture d'une page publique : son texte, borné. Seuls les textes HTML ou brut sont acceptés.
pub fn read_page_at(url: &str) -> Result<PageText, AdapterError> {
    if !public_url(url) {
        return Err(AdapterError::InvalidTarget("adresse refusée : seules les pages publiques sont lues".into()));
    }
    let (status, content_type, bytes) = fetch(url, MAX_PAGE_BYTES)?;
    if status != 200 {
        return Err(AdapterError::Operation(format!("page : réponse HTTP {status}")));
    }
    if !(content_type.starts_with("text/html") || content_type.starts_with("text/plain")) {
        return Err(AdapterError::Operation("page non textuelle".into()));
    }
    let text = page_text(&String::from_utf8_lossy(&bytes));
    if text.is_empty() {
        return Err(AdapterError::Operation("page sans texte lisible".into()));
    }
    Ok(PageText { url: url.to_string(), text })
}

#[tauri::command]
pub async fn web_search(webview: tauri::Webview, question: String) -> Result<Vec<SearchHit>, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || search_at(DUCKDUCKGO, &question))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub async fn web_read(webview: tauri::Webview, url: String) -> Result<PageText, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || read_page_at(&url))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_results_are_read_from_the_redirect_and_cleaned() {
        let html = r#"<div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FGTA_RP&amp;rut=abc">GTA <b>RP</b> &amp; co</a></h2><a class="result__snippet" href="x">Un serveur <b>RP</b> de GTA.</a></div>
<div class="result"><a class="result__a" href="https://example.org/page">Autre</a><a class="result__snippet" href="y">Texte.</a></div>"#;
        let hits = search_hits(html);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "GTA RP & co");
        assert_eq!(hits[0].url, "https://fr.wikipedia.org/wiki/GTA_RP");
        assert_eq!(hits[0].snippet, "Un serveur RP de GTA.");
        assert_eq!(hits[1].url, "https://example.org/page");
    }

    #[test]
    fn only_public_web_addresses_are_read() {
        assert!(public_url("https://example.org/page"));
        assert!(public_url("http://fr.wikipedia.org/wiki/GTA"));
        assert!(!public_url("ftp://example.org/file"));
        assert!(!public_url("http://localhost/admin"));
        assert!(!public_url("http://intranet/page"));
        assert!(!public_url("http://192.168.1.1/"));
        assert!(!public_url("https://10.0.0.5/"));
        assert!(!public_url("http://127.0.0.1:8080/"));
        assert!(!public_url("https://user@example.org/"));
        assert!(!public_url("https://example.org:8443/"));
    }

    #[test]
    fn private_loopback_and_reserved_addresses_are_not_public() {
        use std::net::IpAddr;
        for address in ["10.1.2.3", "172.16.0.9", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "240.0.0.1", "224.0.0.1"] {
            assert!(!is_public_ip(address.parse::<IpAddr>().unwrap()), "{address} doit être refusée");
        }
        for address in ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2002:c0a8:101::1", "64:ff9b::808:808"] {
            assert!(!is_public_ip(address.parse::<IpAddr>().unwrap()), "{address} doit être refusée");
        }
        for address in ["::ffff:10.0.0.5", "::ffff:127.0.0.1", "::ffff:169.254.169.254"] {
            assert!(!is_public_ip(address.parse::<IpAddr>().unwrap()), "IPv4 mappée {address} doit être refusée");
        }
        for address in ["8.8.8.8", "1.1.1.1", "151.101.1.140", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"] {
            assert!(is_public_ip(address.parse::<IpAddr>().unwrap()), "{address} doit être acceptée");
        }
    }

    #[test]
    fn a_name_that_resolves_to_a_private_address_is_refused_before_connecting() {
        // Le nom « localhost » est une adresse locale : la connexion doit être refusée sans jamais atteindre le port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let error = fetch(&format!("http://localhost:{port}/page"), 1024).unwrap_err();
        assert!(error.to_string().contains("non publique"), "refus attendu par le résolveur : {error}");
        assert!(listener.accept().is_err(), "aucune connexion ne doit atteindre une adresse privée");
    }

    #[test]
    fn the_public_addresses_of_a_name_are_kept_and_private_ones_dropped() {
        use std::net::SocketAddr;
        let found: Vec<SocketAddr> = ["10.0.0.4:443", "8.8.4.4:443", "127.0.0.1:443"].iter().map(|a| a.parse().unwrap()).collect();
        let kept: Vec<SocketAddr> = public_addresses(&found).unwrap().iter().copied().collect();
        assert_eq!(kept, vec!["8.8.4.4:443".parse::<SocketAddr>().unwrap()]);
        let only_private: Vec<SocketAddr> = vec!["192.168.0.1:80".parse().unwrap()];
        assert!(public_addresses(&only_private).is_none());
    }

    #[test]
    fn page_text_drops_scripts_and_markup() {
        let html = "<html><script>var x = 1;</script><p>Bonjour&nbsp;<b>le</b> monde &amp;lt; toi</p><style>p{}</style></html>";
        assert_eq!(page_text(html), "Bonjour le monde &lt; toi");
    }

    #[test]
    fn base64_matches_the_standard_encoding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn queries_are_words_only() {
        assert!(valid_query("Emmanuel Macron"));
        assert!(valid_query("Marie Curie"));
        assert!(!valid_query("x"));
        assert!(!valid_query("https://evil.example/"));
        assert!(!valid_query("../../etc"));
        assert!(!valid_query("a?b=c"));
    }

    #[test]
    fn spaces_and_accents_are_percent_encoded() {
        assert_eq!(percent_encode("Marie Curie"), "Marie%20Curie");
        assert_eq!(percent_encode("Élysée"), "%C3%89lys%C3%A9e");
    }

    #[test]
    fn only_wikimedia_images_are_downloaded() {
        assert!(trusted_image_url("https://upload.wikimedia.org/wikipedia/commons/a.jpg"));
        assert!(trusted_image_url("https://thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg"));
        assert!(!trusted_image_url("https://evil.example/a.jpg"));
        assert!(!trusted_image_url("http://upload.wikimedia.org/a.jpg"));
    }

    #[test]
    fn the_first_free_photo_comes_with_its_author_and_licence() {
        let value: Value = serde_json::from_str(
            r#"{"query":{"pages":{
                "2":{"title":"File:Doc.svg","index":2,"imageinfo":[{"mime":"image/svg+xml","thumburl":"x"}]},
                "1":{"title":"File:Macron.jpg","index":1,"imageinfo":[{"mime":"image/jpeg","thumburl":"https://thumb.wikimedia.org/a.jpg",
                  "descriptionurl":"https://commons.wikimedia.org/wiki/File:Macron.jpg",
                  "extmetadata":{"Artist":{"value":"<a href=\"x\">Simon Dawson</a>"},"LicenseShortName":{"value":"CC BY 2.0"}}}]}
            }}}"#,
        )
        .unwrap();
        let (title, thumb, credit, license, page) = photo_candidate(&value).unwrap();
        assert_eq!(title, "Macron.jpg");
        assert_eq!(thumb, "https://thumb.wikimedia.org/a.jpg");
        assert_eq!(credit, "Simon Dawson");
        assert_eq!(license, "CC BY 2.0");
        assert!(page.ends_with("File:Macron.jpg"));
    }

    #[test]
    fn dates_must_be_year_month_day() {
        assert!(valid_date("2026-10-24"));
        assert!(!valid_date("2026-13-01"));
        assert!(!valid_date("2026/10/24"));
        assert!(!valid_date("../2026-10-24"));
    }

    #[test]
    fn the_day_news_keeps_its_text_and_its_page() {
        let value: Value = serde_json::from_str(
            r#"{"news":[
                {"story":"<b>17 octobre</b> : manifestations.","links":[{"content_urls":{"desktop":{"page":"https://fr.wikipedia.org/wiki/Manifestations"}}}]},
                {"story":"Sans lien.","links":[]}
            ]}"#,
        )
        .unwrap();
        let items: Vec<NewsItem> = value
            .get("news")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|entry| {
                let text = plain(entry.get("story").and_then(Value::as_str)?);
                let page = entry.pointer("/links/0/content_urls/desktop/page").and_then(Value::as_str)?.to_string();
                Some(NewsItem { text, page })
            })
            .collect();
        assert_eq!(items, vec![NewsItem { text: "17 octobre : manifestations.".into(), page: "https://fr.wikipedia.org/wiki/Manifestations".into() }]);
    }

    #[test]
    fn rss_titles_and_links_are_read_and_entities_decoded() {
        let xml = r#"<rss><channel>
            <item><title><![CDATA[Ukraine &amp; Europe : sommet]]></title><link>https://www.france24.com/fr/a</link></item>
            <item><title>Sans lien</title></item>
            <item><title>Second titre</title><link>https://www.france24.com/fr/b</link></item>
        </channel></rss>"#;
        let items = rss_headlines(xml);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], NewsItem { text: "Ukraine & Europe : sommet".into(), page: "https://www.france24.com/fr/a".into() });
        assert_eq!(items[1].text, "Second titre");
    }

    #[test]
    fn the_news_url_searches_the_topic_or_the_top_stories() {
        assert_eq!(news_url(GOOGLE_NEWS, None).unwrap(), "https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr");
        assert_eq!(news_url(GOOGLE_NEWS, Some("Emmanuel Macron")).unwrap(), "https://news.google.com/rss/search?q=Emmanuel%20Macron&hl=fr&gl=FR&ceid=FR:fr");
        assert!(news_url(GOOGLE_NEWS, Some("x&hl=en")).is_err());
    }

    #[test]
    fn a_link_that_is_not_web_is_dropped() {
        let xml = "<item><title>x</title><link>javascript:alert(1)</link></item>";
        assert!(rss_headlines(xml).is_empty());
    }

    #[test]
    fn a_result_without_a_free_photo_is_none() {
        let value: Value = serde_json::from_str(r#"{"query":{"pages":{"1":{"title":"File:a.svg","imageinfo":[{"mime":"image/svg+xml","thumburl":"x"}]}}}}"#).unwrap();
        assert!(photo_candidate(&value).is_none());
    }
}
