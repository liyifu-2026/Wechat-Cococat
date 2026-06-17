//! Driver WebSocket → Tauri event bridge (single connection, health-coupled).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::driver_proxy;

static DRIVER_UP: AtomicBool = AtomicBool::new(false);

const SILENT_SLEEP_SECS: u64 = 3;
const MAX_BACKOFF_SECS: u64 = 16;

pub fn set_driver_up(up: bool) {
    DRIVER_UP.store(up, Ordering::Relaxed);
}

pub fn driver_up() -> bool {
    DRIVER_UP.load(Ordering::Relaxed)
}

pub fn driver_ws_events_url() -> String {
    let base = driver_proxy::driver_base_url();
    let ws_base = base
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    format!("{ws_base}/api/ws/events")
}

fn event_channel_for_type(event_type: &str) -> String {
    format!("driver://event/{event_type}")
}

fn emit_driver_payload(app: &AppHandle, json: Value) {
    let event_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("generic");

    let _ = app.emit(&event_channel_for_type(event_type), json.clone());
    let _ = app.emit("driver://event", json);
}

async fn run_bridge_loop(app: AppHandle) {
    let mut backoff_secs = 1u64;

    loop {
        if !driver_up() {
            backoff_secs = 1;
            sleep(Duration::from_secs(SILENT_SLEEP_SECS)).await;
            continue;
        }

        if !driver_proxy::has_cached_token() {
            sleep(Duration::from_secs(SILENT_SLEEP_SECS)).await;
            continue;
        }

        let url = driver_ws_events_url();
        match connect_async(&url).await {
            Ok((ws_stream, _)) => {
                backoff_secs = 1;
                let (_, mut read) = ws_stream.split();

                while driver_up() {
                    match read.next().await {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(json) = serde_json::from_str::<Value>(&text) {
                                emit_driver_payload(&app, json);
                            }
                        }
                        Some(Ok(Message::Binary(bytes))) => {
                            if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                if let Ok(json) = serde_json::from_str::<Value>(&text) {
                                    emit_driver_payload(&app, json);
                                }
                            }
                        }
                        Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                        Some(Ok(Message::Frame(_))) => {}
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    }
                }
            }
            Err(err) => {
                eprintln!("[event-bridge] ws connect failed: {err}");
            }
        }

        if !driver_up() {
            backoff_secs = 1;
            continue;
        }

        sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
    }
}

pub fn start(app_handle: AppHandle) {
    tauri::async_runtime::spawn(run_bridge_loop(app_handle));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_up_flag_roundtrip() {
        set_driver_up(true);
        assert!(driver_up());
        set_driver_up(false);
        assert!(!driver_up());
    }

    #[test]
    fn event_channel_uses_type_field() {
        assert_eq!(event_channel_for_type("new_messages"), "driver://event/new_messages");
    }

    #[test]
    fn ws_url_from_http_base() {
        std::env::set_var("AGENT_WECHAT_URL", "http://127.0.0.1:6174");
        assert_eq!(
            driver_ws_events_url(),
            "ws://127.0.0.1:6174/api/ws/events"
        );
    }
}
