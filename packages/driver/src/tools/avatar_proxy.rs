use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(3600);
const CACHE_MAX: usize = 256;

struct CacheEntry {
    bytes: Vec<u8>,
    content_type: String,
    fetched_at: Instant,
}

static AVATAR_CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

fn cache() -> std::sync::MutexGuard<'static, Option<HashMap<String, CacheEntry>>> {
    AVATAR_CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

fn is_allowed_avatar_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && (lower.contains("qlogo.cn")
            || lower.contains("weixin.qq.com")
            || lower.contains("wx.qq.com"))
}

pub async fn fetch_avatar(url: &str) -> Result<(Vec<u8>, String), String> {
    fetch_avatar_with_options(url, false).await
}

pub async fn fetch_avatar_with_options(
    url: &str,
    force_refresh: bool,
) -> Result<(Vec<u8>, String), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("empty url".to_string());
    }
    if !is_allowed_avatar_url(url) {
        return Err("avatar url not allowed".to_string());
    }

    if !force_refresh {
        let guard = cache();
        if let Some(map) = guard.as_ref() {
            if let Some(entry) = map.get(url) {
                if entry.fetched_at.elapsed() < CACHE_TTL {
                    return Ok((entry.bytes.clone(), entry.content_type.clone()));
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; CocoCat-Driver/1.0)")
        .timeout(Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("upstream HTTP {}", resp.status()));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body: {e}"))?
        .to_vec();

    if bytes.is_empty() {
        return Err("empty avatar body".to_string());
    }

    {
        let mut guard = cache();
        let map = guard.get_or_insert_with(HashMap::new);
        if map.len() >= CACHE_MAX {
            map.clear();
        }
        map.insert(
            url.to_string(),
            CacheEntry {
                bytes: bytes.clone(),
                content_type: content_type.clone(),
                fetched_at: Instant::now(),
            },
        );
    }

    Ok((bytes, content_type))
}
