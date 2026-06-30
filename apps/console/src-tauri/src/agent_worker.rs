//! Long-lived Node Agent worker — framed stdio JSON-RPC with serialized requests.
//! Supports bidirectional RPC: Node may emit upstream `direction:"request"` frames
//! on stdout during nested work (e.g. wiki search) answered on stdin.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::Mutex as AsyncMutex;

use crate::stack;
use crate::wiki_internal;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const WORKER_WARMUP: Duration = Duration::from_millis(150);

struct WorkerInner {
    child: Child,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
}

impl WorkerInner {
    fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(None) => true,
            _ => false,
        }
    }
}

struct AgentWorkerState {
    inner: Option<WorkerInner>,
}

impl Default for AgentWorkerState {
    fn default() -> Self {
        Self { inner: None }
    }
}

static WORKER_STATE: LazyLock<Mutex<AgentWorkerState>> =
    LazyLock::new(|| Mutex::new(AgentWorkerState::default()));
static REQUEST_SERIAL: AsyncMutex<()> = AsyncMutex::const_new(());

fn worker_script_path() -> PathBuf {
    stack::monorepo_root().join("packages/agent/dist/worker-entry.js")
}

fn resolve_node_binary() -> String {
    std::env::var("COCOCAT_NODE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "node".to_string())
}

fn write_upstream_response(
    stdin: &Arc<Mutex<std::process::ChildStdin>>,
    id: u64,
    result: Value,
    error: Option<String>,
) {
    let line = json!({
        "id": id,
        "result": result,
        "error": error,
    })
    .to_string()
        + "\n";
    if let Ok(mut guard) = stdin.lock() {
        let _ = guard.write_all(line.as_bytes());
        let _ = guard.flush();
    }
}

fn handle_upstream_request(
    parsed: &Value,
    stdin: &Arc<Mutex<std::process::ChildStdin>>,
) {
    let id = parsed.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
    let method = parsed
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let params = parsed.get("params").cloned().unwrap_or(Value::Null);
    let (result, error) = wiki_internal::handle_upstream(method, params);
    write_upstream_response(stdin, id, result, error);
}

fn read_stdout_loop(
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<Value, String>>>>>,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let parsed: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(err) => {
                        eprintln!("[agent-worker] invalid stdout JSON: {err} — {trimmed}");
                        continue;
                    }
                };

                if parsed.get("direction").and_then(|v| v.as_str()) == Some("request") {
                    handle_upstream_request(&parsed, &stdin);
                    continue;
                }

                let Some(id) = parsed.get("id").and_then(|v| v.as_u64()) else {
                    eprintln!("[agent-worker] response missing id: {trimmed}");
                    continue;
                };
                let tx = pending.lock().ok().and_then(|mut map| map.remove(&id));
                let Some(tx) = tx else {
                    eprintln!("[agent-worker] orphan response id={id}");
                    continue;
                };
                if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
                    if !err.is_empty() {
                        let _ = tx.send(Err(err.to_string()));
                        continue;
                    }
                }
                let result = parsed.get("result").cloned().unwrap_or(Value::Null);
                let _ = tx.send(Ok(result));
            }
            Err(err) => {
                eprintln!("[agent-worker] stdout read failed: {err}");
                break;
            }
        }
    }

    if let Ok(mut map) = pending.lock() {
        for (_, tx) in map.drain() {
            let _ = tx.send(Err("Agent worker stdout closed".into()));
        }
    }
}

fn spawn_worker_locked(state: &mut AgentWorkerState) -> Result<(), String> {
    if let Some(inner) = state.inner.as_mut() {
        if inner.is_alive() {
            return Ok(());
        }
        let _ = inner.child.kill();
        let _ = inner.child.wait();
        state.inner = None;
    }

    let script = worker_script_path();
    if !script.is_file() {
        return Err(format!(
            "Agent worker script not found: {}. Run: pnpm --filter @cococat/agent build",
            script.display()
        ));
    }

    let node = resolve_node_binary();
    let repo = stack::monorepo_root();

    let mut child = Command::new(&node)
        .arg(&script)
        .arg("--worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env("COCOCAT_REPO_ROOT", repo.to_string_lossy().to_string())
        .env("COCOCAT_WIKI_INTERNAL", "1")
        .env("PATH", stack::node_path_env())
        .env("NO_PROXY", "localhost,127.0.0.0/8")
        .env("no_proxy", "localhost,127.0.0.0/8")
        .spawn()
        .map_err(|e| format!("Failed to spawn Agent worker ({node}): {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture worker stdout")?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to capture worker stdin")?;
    let stdin = Arc::new(Mutex::new(stdin));

    let pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<Value, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = pending.clone();
    let stdin_reader = stdin.clone();
    std::thread::spawn(move || read_stdout_loop(stdout, pending_reader, stdin_reader));

    state.inner = Some(WorkerInner {
        child,
        stdin,
        pending,
        next_id: AtomicU64::new(0),
    });

    std::thread::sleep(WORKER_WARMUP);
    eprintln!("[agent-worker] spawned {}", script.display());
    Ok(())
}

pub fn ensure_spawned() -> Result<(), String> {
    let mut state = WORKER_STATE
        .lock()
        .map_err(|e| format!("Agent worker lock poisoned: {e}"))?;

    if let Some(inner) = state.inner.as_mut() {
        if inner.is_alive() {
            return Ok(());
        }
        let _ = inner.child.kill();
        let _ = inner.child.wait();
        state.inner = None;
    }

    spawn_worker_locked(&mut state)
}

pub fn shutdown() {
    let mut state = match WORKER_STATE.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    if let Some(mut inner) = state.inner.take() {
        if inner.is_alive() {
            let _ = inner.child.kill();
        }
        let _ = inner.child.wait();
        eprintln!("[agent-worker] shutdown complete");
    }
}

fn dispatch_request_sync(method: &str, params: Value) -> Result<Value, String> {
    ensure_spawned()?;

    let mut state = WORKER_STATE
        .lock()
        .map_err(|e| format!("Agent worker lock poisoned: {e}"))?;
    let inner = state
        .inner
        .as_mut()
        .ok_or("Agent worker not running after spawn")?;

    if !inner.is_alive() {
        state.inner = None;
        drop(state);
        ensure_spawned()?;
        return dispatch_request_sync(method, params);
    }

    let req_id = inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = std::sync::mpsc::channel();

    inner
        .pending
        .lock()
        .map_err(|e| format!("Agent worker pending lock poisoned: {e}"))?
        .insert(req_id, tx);

    let rpc_line = json!({
        "id": req_id,
        "method": method,
        "params": params,
    })
    .to_string()
        + "\n";

    {
        let mut stdin = inner
            .stdin
            .lock()
            .map_err(|e| format!("Agent worker stdin lock poisoned: {e}"))?;
        stdin
            .write_all(rpc_line.as_bytes())
            .map_err(|e| format!("Agent worker stdin write failed: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("Agent worker stdin flush failed: {e}"))?;
    }

    drop(state);

    let started = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(result) => return result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if started.elapsed() > REQUEST_TIMEOUT {
                    return Err(format!("Agent worker RPC timeout ({REQUEST_TIMEOUT:?})"));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Agent worker response channel closed".into());
            }
        }
    }
}

pub async fn request(method: &str, params: Value) -> Result<Value, String> {
    let _serial = REQUEST_SERIAL.lock().await;
    let method = method.to_string();
    tauri::async_runtime::spawn_blocking(move || dispatch_request_sync(&method, params))
        .await
        .map_err(|e| format!("Agent worker task failed: {e}"))?
}

pub async fn request_preview_reply(query: &str, chat_id: Option<&str>) -> Result<Value, String> {
    let mut params = json!({ "query": query.trim() });
    if let Some(id) = chat_id.filter(|s| !s.trim().is_empty()) {
        params["chatId"] = json!(id.trim());
    }
    request("preview_reply", params).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_ping_rpc_when_built() {
        if !worker_script_path().is_file() {
            eprintln!("skip worker_ping_rpc_when_built: dist missing");
            return;
        }
        shutdown();
        ensure_spawned().expect("spawn worker");
        let result = dispatch_request_sync("ping", json!({})).expect("ping rpc");
        assert_eq!(result.get("ok"), Some(&json!(true)));
        shutdown();
    }
}
