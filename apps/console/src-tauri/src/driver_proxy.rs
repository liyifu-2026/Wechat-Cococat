//! Driver REST bridge — shared reqwest pool + in-memory token cache.
//! Hot inbox paths use `driver_fetch` instead of WebView → localhost HTTP.

use std::sync::{LazyLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::stack;

const DRIVER_TIMEOUT: Duration = Duration::from_secs(30);

static DRIVER_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .tcp_nodelay(true)
        .timeout(DRIVER_TIMEOUT)
        .build()
        .expect("driver reqwest client")
});

static TOKEN_CACHE: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));

pub fn driver_base_url() -> String {
    std::env::var("AGENT_WECHAT_URL")
        .or_else(|_| std::env::var("VITE_COCOCAT_DRIVER_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:6174".to_string())
        .trim_end_matches('/')
        .to_string()
}

pub fn driver_http_client() -> reqwest::Client {
    DRIVER_CLIENT.clone()
}

pub fn update_cached_token(token: String) {
    let trimmed = token.trim().to_string();
    if trimmed.is_empty() {
        invalidate_token_cache();
        return;
    }
    if let Ok(mut guard) = TOKEN_CACHE.write() {
        *guard = Some(trimmed);
    }
}

pub fn invalidate_token_cache() {
    if let Ok(mut guard) = TOKEN_CACHE.write() {
        *guard = None;
    }
}

fn cached_token() -> Option<String> {
    TOKEN_CACHE.read().ok()?.clone()
}

pub fn has_cached_token() -> bool {
    cached_token().is_some()
}

pub fn refresh_token_from_disk() -> Result<String, String> {
    let token = stack::read_cococat_token()?;
    update_cached_token(token.clone());
    Ok(token)
}

fn ensure_token() -> Result<String, String> {
    if let Some(token) = cached_token() {
        return Ok(token);
    }
    refresh_token_from_disk()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRequest {
    pub path: String,
    pub method: String,
    #[serde(default)]
    pub body: Option<Value>,
}

async fn execute_fetch(req: &ProxyRequest, token: &str) -> Result<(reqwest::StatusCode, Value), String> {
    let path = req.path.trim();
    if path.is_empty() || !path.starts_with('/') {
        return Err("driver_fetch: path must start with /".into());
    }

    let url = format!("{}{}", driver_base_url(), path);
    let method = req.method.to_uppercase();

    let mut builder = match method.as_str() {
        "GET" => DRIVER_CLIENT.get(&url),
        "POST" => DRIVER_CLIENT.post(&url),
        "PUT" => DRIVER_CLIENT.put(&url),
        "DELETE" => DRIVER_CLIENT.delete(&url),
        "PATCH" => DRIVER_CLIENT.patch(&url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    builder = builder.bearer_auth(token);

    if let Some(body) = &req.body {
        if !body.is_null() {
            builder = builder.json(body);
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Driver bridge network error: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Driver response read failed: {e}"))?;

    if text.trim().is_empty() {
        return Ok((status, Value::Null));
    }

    let json: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    Ok((status, json))
}

pub async fn driver_fetch_inner(req: ProxyRequest) -> Result<Value, String> {
    let token = ensure_token()?;
    let (status, json) = execute_fetch(&req, &token).await?;

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        invalidate_token_cache();
        let retry_token = refresh_token_from_disk()?;
        let (retry_status, retry_json) = execute_fetch(&req, &retry_token).await?;
        if retry_status.is_success() {
            return Ok(retry_json);
        }
        return Err(format_driver_api_error(retry_status, &retry_json));
    }

    if status.is_success() {
        Ok(json)
    } else {
        Err(format_driver_api_error(status, &json))
    }
}

fn format_driver_api_error(status: reqwest::StatusCode, body: &Value) -> String {
    format!("Driver API [{status}]: {body}")
}

#[tauri::command]
pub async fn driver_fetch(req: ProxyRequest) -> Result<Value, String> {
    driver_fetch_inner(req).await
}

#[tauri::command]
pub fn refresh_driver_token_cache() -> Result<String, String> {
    refresh_token_from_disk()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_cache_roundtrip() {
        invalidate_token_cache();
        update_cached_token("abc123".into());
        assert_eq!(cached_token().as_deref(), Some("abc123"));
        invalidate_token_cache();
        assert!(cached_token().is_none());
    }

    #[test]
    fn rejects_bad_path() {
        let req = ProxyRequest {
            path: "no-leading-slash".into(),
            method: "GET".into(),
            body: None,
        };
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let err = rt
            .block_on(execute_fetch(&req, "token"))
            .expect_err("bad path");
        assert!(err.contains("path must start with /"));
    }
}
