//! Sources publiques des fenêtres « une demande = une fenêtre » : Wikipédia (résumé d'un sujet) et Wikimedia Commons
//! (photo, avec son auteur et sa licence). Seuls ces hôtes sont interrogés, en HTTPS, sans compte ni clé. L'image est
//! téléchargée ici, bornée en taille, et renvoyée en data URL : la politique de l'interface n'autorise que les images
//! locales, et elle ne doit pas être élargie.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::AdapterError;
use crate::grants::require_core;

pub const WIKIPEDIA: &str = "https://fr.wikipedia.org";
pub const COMMONS: &str = "https://commons.wikimedia.org";
/// Google Actualités : recherche d'actualités sur tout le web, flux RSS public, sans clé (vérifié le 24/10/2026).
pub const GOOGLE_NEWS: &str = "https://news.google.com";
/// Flux RSS de France 24 (version française), vérifié le 24/10/2026 : 24 éléments datés.
pub const FRANCE24_RSS: &str = "https://www.france24.com/fr/rss";
const MAX_RSS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_HEADLINES: usize = 8;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_JSON_BYTES: u64 = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAX_QUERY_CHARS: usize = 100;
const MAX_NEWS: usize = 10;
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
pub async fn web_news_search(caller: String, topic: Option<String>) -> Result<Vec<NewsItem>, AdapterError> {
    require_core(&caller)?;
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
pub async fn web_headlines(caller: String) -> Result<Vec<NewsItem>, AdapterError> {
    require_core(&caller)?;
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

fn agent() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(NETWORK_TIMEOUT))
            .http_status_as_error(false)
            .user_agent(USER_AGENT)
            .build(),
    )
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
pub async fn web_news(caller: String, date: String) -> Result<Vec<NewsItem>, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || news_at(WIKIPEDIA, &date))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub async fn web_summary(caller: String, query: String) -> Result<Summary, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || summary_at(WIKIPEDIA, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[tauri::command]
pub async fn web_photo(caller: String, query: String) -> Result<Photo, AdapterError> {
    require_core(&caller)?;
    tauri::async_runtime::spawn_blocking(move || photo_at(COMMONS, &query))
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

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
