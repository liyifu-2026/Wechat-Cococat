//! Unified stack health snapshot — parallel HTTP/PID probes with TTL cache.
//! Replaces per-poll `bash cococat-stack.sh status` ×3 from the webview.

use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::driver_proxy;
use crate::event_bridge;
use crate::stack;

const CACHE_TTL: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackStatusLinesDto {
    pub driver: String,
    pub memory: String,
    pub agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackHealthSnapshotDto {
    pub driver: String,
    pub memory: String,
    pub agent: String,
    pub wechat_logged_in: bool,
    pub chats_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chats_ready_reason: Option<String>,
    pub wechat_auth_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wechat_logged_in_user: Option<String>,
    pub status_lines: StackStatusLinesDto,
}

#[derive(Debug, Deserialize)]
struct DriverSessionAuth {
    #[serde(default)]
    status: Option<String>,
    #[serde(default, rename = "loggedInUser")]
    logged_in_user: Option<String>,
    #[serde(default, rename = "chatsReady")]
    chats_ready: Option<bool>,
    #[serde(default, rename = "chatsReadyReason")]
    chats_ready_reason: Option<String>,
}

struct HealthCache {
    snapshot: Option<StackHealthSnapshotDto>,
    fetched_at: Option<Instant>,
}

impl Default for HealthCache {
    fn default() -> Self {
        Self {
            snapshot: None,
            fetched_at: None,
        }
    }
}

static HEALTH_CACHE: LazyLock<Mutex<HealthCache>> =
    LazyLock::new(|| Mutex::new(HealthCache::default()));

static HTTP_CLIENT: LazyLock<reqwest::Client> =
    LazyLock::new(|| driver_proxy::driver_http_client());

fn driver_base_url() -> String {
    driver_proxy::driver_base_url()
}

fn memory_base_url() -> String {
    std::env::var("TDAI_GATEWAY_URL")
        .or_else(|_| std::env::var("VITE_COCOCAT_MEMORY_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:8420".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn stack_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_DATA_DIR") {
        return PathBuf::from(dir).join("stack");
    }
    crate::paths::cococat_data_dir().join("stack")
}

fn pid_file(name: &str) -> PathBuf {
    stack_dir().join(format!("{name}.pid"))
}

fn pid_alive(pid_file: &PathBuf) -> bool {
    let Ok(raw) = std::fs::read_to_string(pid_file) else {
        return false;
    };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        return false;
    };
    crate::stack_orchestrator::pid_alive(pid)
}

async fn probe_driver(
    client: &reqwest::Client,
    base: &str,
    token: Option<&str>,
) -> (String, String, Option<DriverSessionAuth>) {
    let auth_header = token
        .filter(|s| !s.is_empty())
        .map(|t| format!("Bearer {t}"));

    async fn get_with_auth(
        client: &reqwest::Client,
        url: &str,
        auth_header: &Option<String>,
    ) -> Result<reqwest::Response, reqwest::Error> {
        let mut req = client.get(url).timeout(PROBE_TIMEOUT);
        if let Some(h) = auth_header {
            req = req.header("Authorization", h);
        }
        req.send().await
    }

    let session_url = format!("{base}/api/status/session");
    if let Ok(resp) = get_with_auth(client, &session_url, &auth_header).await {
        if resp.status().is_success() {
            let auth = resp.json::<DriverSessionAuth>().await.ok();
            return ("up".to_string(), format!("driver: up ({base})"), auth);
        }
    }

    let status_url = format!("{base}/api/status");
    match get_with_auth(client, &status_url, &auth_header).await {
        Ok(resp) if resp.status().is_success() => {
            ("up".to_string(), format!("driver: up ({base})"), None)
        }
        Ok(_) => (
            "degraded".to_string(),
            format!("driver: container running but API unreachable ({base})"),
            None,
        ),
        Err(_) => ("down".to_string(), "driver: down".to_string(), None),
    }
}

async fn probe_memory(client: &reqwest::Client, base: &str) -> (String, String) {
    let url = format!("{base}/health");
    match client.get(&url).timeout(PROBE_TIMEOUT).send().await {
        Ok(resp) if resp.status().is_success() => {
            ("up".to_string(), format!("memory: up ({base})"))
        }
        Ok(_) => {
            let pid = pid_file("memory");
            if pid_alive(&pid) {
                (
                    "degraded".to_string(),
                    format!(
                        "memory: pid {} but health failed",
                        std::fs::read_to_string(&pid).unwrap_or_default().trim()
                    ),
                )
            } else {
                ("down".to_string(), "memory: down".to_string())
            }
        }
        Err(_) => {
            let pid = pid_file("memory");
            if pid_alive(&pid) {
                (
                    "degraded".to_string(),
                    format!(
                        "memory: pid {} but health failed",
                        std::fs::read_to_string(&pid).unwrap_or_default().trim()
                    ),
                )
            } else {
                ("down".to_string(), "memory: down".to_string())
            }
        }
    }
}

async fn probe_agent() -> (String, String) {
    let pid_path = pid_file("agent");
    if pid_alive(&pid_path) {
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap_or_default()
            .trim()
            .to_string();
        return ("up".to_string(), format!("agent: up pid={pid}"));
    }
    ("down".to_string(), "agent: down".to_string())
}

fn apply_driver_auth(snapshot: &mut StackHealthSnapshotDto, auth: Option<DriverSessionAuth>) {
    let Some(auth) = auth else {
        snapshot.wechat_auth_status = "unknown".to_string();
        snapshot.wechat_logged_in = false;
        snapshot.chats_ready = false;
        snapshot.chats_ready_reason = None;
        snapshot.wechat_logged_in_user = None;
        return;
    };

    let status = auth.status.unwrap_or_else(|| "unknown".to_string());
    snapshot.wechat_auth_status = status.clone();
    snapshot.wechat_logged_in_user = auth.logged_in_user;
    snapshot.wechat_logged_in = status == "logged_in";
    snapshot.chats_ready = auth.chats_ready.unwrap_or(snapshot.wechat_logged_in);
    snapshot.chats_ready_reason = auth.chats_ready_reason;
}

pub async fn fetch_stack_health_snapshot(force: bool) -> Result<StackHealthSnapshotDto, String> {
    if !force {
        if let Ok(cache) = HEALTH_CACHE.lock() {
            if let (Some(snap), Some(at)) = (&cache.snapshot, cache.fetched_at) {
                if at.elapsed() < CACHE_TTL {
                    return Ok(snap.clone());
                }
            }
        }
    }

    let client = HTTP_CLIENT.clone();
    let driver_base = driver_base_url();
    let memory_base = memory_base_url();

    let token = stack::read_cococat_token().ok();
    if let Some(ref t) = token {
        driver_proxy::update_cached_token(t.clone());
    }

    let driver_fut = probe_driver(&client, &driver_base, token.as_deref());
    let memory_fut = probe_memory(&client, &memory_base);
    let agent_fut = probe_agent();

    let ((driver, driver_line, auth), (memory, memory_line), (agent, agent_line)) =
        tokio::join!(driver_fut, memory_fut, agent_fut);

    let mut snapshot = StackHealthSnapshotDto {
        driver: driver.clone(),
        memory,
        agent,
        wechat_logged_in: false,
        chats_ready: false,
        chats_ready_reason: None,
        wechat_auth_status: "unknown".to_string(),
        wechat_logged_in_user: None,
        status_lines: StackStatusLinesDto {
            driver: driver_line,
            memory: memory_line,
            agent: agent_line,
        },
    };

    if driver != "up" {
        driver_proxy::invalidate_token_cache();
    }

    if driver == "up" {
        apply_driver_auth(&mut snapshot, auth);
    } else {
        apply_driver_auth(&mut snapshot, None);
    }

    if let Ok(mut cache) = HEALTH_CACHE.lock() {
        cache.snapshot = Some(snapshot.clone());
        cache.fetched_at = Some(Instant::now());
    }

    event_bridge::set_driver_up(snapshot.driver == "up");

    Ok(snapshot)
}

#[tauri::command]
pub async fn get_stack_health_snapshot(
    force: Option<bool>,
) -> Result<StackHealthSnapshotDto, String> {
    fetch_stack_health_snapshot(force.unwrap_or(false)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_serializes_camel_case() {
        let dto = StackHealthSnapshotDto {
            driver: "up".into(),
            memory: "up".into(),
            agent: "down".into(),
            wechat_logged_in: true,
            chats_ready: true,
            chats_ready_reason: None,
            wechat_auth_status: "logged_in".into(),
            wechat_logged_in_user: Some("wxid".into()),
            status_lines: StackStatusLinesDto {
                driver: "driver: up".into(),
                memory: "memory: up".into(),
                agent: "agent: down".into(),
            },
        };
        let json = serde_json::to_string(&dto).expect("json");
        assert!(json.contains("\"wechatLoggedIn\":true"));
        assert!(json.contains("\"chatsReady\":true"));
        assert!(json.contains("\"statusLines\""));
    }
}
