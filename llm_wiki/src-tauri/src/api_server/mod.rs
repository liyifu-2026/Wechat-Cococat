use std::sync::atomic::{AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

use tauri::AppHandle;
use tiny_http::Server;

mod infra;
mod routing;
mod projects;
mod files;
mod search;
mod graph;
mod rescan;

pub(super) const PORT: u16 = 19828;
pub(super) const API_PREFIX: &str = "/api/v1";
pub(super) const BIND_RETRY_DELAY_SECS: u64 = 2;
pub(super) const MAX_BIND_RETRIES: u32 = 3;
pub(super) const APP_STATE_CACHE_TTL: Duration = Duration::from_secs(5);

static API_STATUS: AtomicU8 = AtomicU8::new(0);

pub fn get_api_status() -> &'static str {
    match API_STATUS.load(Ordering::Relaxed) {
        0 => "starting",
        1 => "running",
        2 => "port_conflict",
        _ => "error",
    }
}

pub fn invalidate_config_cache() {
    infra::invalidate_config_cache();
}

pub fn start_api_server(app: AppHandle) {
    thread::spawn(move || loop {
        API_STATUS.store(0, Ordering::Relaxed);
        let server = match bind_server_with_retry() {
            Some(server) => server,
            None => {
                API_STATUS.store(2, Ordering::Relaxed);
                thread::sleep(Duration::from_secs(BIND_RETRY_DELAY_SECS));
                continue;
            }
        };

        API_STATUS.store(1, Ordering::Relaxed);
        eprintln!("[API Server] Listening on http://127.0.0.1:{PORT}{API_PREFIX}");

        for request in server.incoming_requests() {
            let method = request.method().clone();
            let url = request.url().to_string();
            if routing::should_rate_limit(&method, &url) && !infra::allow_request() {
                routing::respond_error(request, 429, "Too many requests");
                continue;
            }
            let Some(slot) = infra::try_acquire_request_slot() else {
                routing::respond_error(request, 503, "API server is busy");
                continue;
            };
            let app = app.clone();
            thread::spawn(move || {
                let _slot = slot;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    routing::process_request(app, request);
                }));
                if let Err(payload) = result {
                    eprintln!("[API Server] request handler panicked: {payload:?}");
                }
            });
        }

        API_STATUS.store(3, Ordering::Relaxed);
        eprintln!("[API Server] server loop exited; restarting");
        thread::sleep(Duration::from_secs(BIND_RETRY_DELAY_SECS));
    });
}

fn bind_server_with_retry() -> Option<Server> {
    for attempt in 1..=MAX_BIND_RETRIES {
        match Server::http(format!("127.0.0.1:{PORT}")) {
            Ok(server) => return Some(server),
            Err(err) => {
                eprintln!(
                    "[API Server] Failed to bind 127.0.0.1:{PORT} (attempt {attempt}/{MAX_BIND_RETRIES}): {err}"
                );
                if attempt < MAX_BIND_RETRIES {
                    thread::sleep(Duration::from_secs(BIND_RETRY_DELAY_SECS));
                }
            }
        }
    }
    None
}
