use std::collections::HashMap;

use tokio::sync::broadcast;

use crate::db::get_db;
use crate::db::queries;
use crate::sessions::manager::get_session;
use crate::tools::wechat_chats;
use crate::tools::wechat_db::{find_account_dir, find_wechat_pid, resolve_account_dir};

static EVENT_TX: std::sync::OnceLock<broadcast::Sender<String>> = std::sync::OnceLock::new();
const CHANNEL_CAPACITY: usize = 1024;
const DEFAULT_EVENT_POLL_MS: u64 = 200;
const MIN_EVENT_POLL_MS: u64 = 50;
const MAX_EVENT_POLL_MS: u64 = 2_000;

pub fn init_event_broadcast() {
    let _ = get_sender();
}

pub fn get_sender() -> &'static broadcast::Sender<String> {
    EVENT_TX.get_or_init(|| {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        tx
    })
}

fn event_poll_interval() -> std::time::Duration {
    let ms = std::env::var("COCOCAT_DRIVER_EVENT_POLL_MS")
        .or_else(|_| std::env::var("DRIVER_EVENT_POLL_MS"))
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_EVENT_POLL_MS)
        .clamp(MIN_EVENT_POLL_MS, MAX_EVENT_POLL_MS);
    std::time::Duration::from_millis(ms)
}

pub fn emit_chat_changed(chat_id: &str) {
    let payload = serde_json::json!({
        "type": "new_messages",
        "chats": [{ "chatId": chat_id }],
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "source": "send",
    });
    let _ = get_sender().send(payload.to_string());
}

pub fn spawn_event_monitor() {
    tokio::spawn(async move {
        tracing::info!("[events] Event monitor started");
        let mut prev_state: HashMap<String, Option<i64>> = HashMap::new();

        loop {
            tokio::time::sleep(event_poll_interval()).await;

            let session = match get_session("default") {
                Some(s) if s.status == "running" => s,
                _ => continue,
            };

            let account_dir = match &session.logged_in_user {
                Some(u) => u.clone(),
                None => {
                    // Auto-detect account when WeChat is running but user is unknown
                    // (e.g. after container restart when WeChat was already logged in).
                    if let Some(pid) = find_wechat_pid() {
                        let dir = find_account_dir(pid).or_else(|| {
                            // Fallback: scan xwechat_files directory
                            resolve_account_dir("")
                        });
                        if let Some(dir) = dir {
                            tracing::info!("[events] auto-detected account_dir={dir} (was null)");
                            let db = get_db();
                            queries::update_session_logged_in_user(&db, &session.id, Some(&dir));
                            dir
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }
            };

            let snapshot = crate::keystore::ensure_keys(&session.id, &account_dir).await;
            let keys = snapshot.keys;

            if !keys.contains_key("session.db") || !keys.contains_key("contact.db") {
                continue;
            }

            let chats = wechat_chats::list_chats(&account_dir, &keys, 200, 0);

            let mut current: HashMap<String, Option<i64>> = HashMap::new();
            let mut changed: Vec<serde_json::Value> = Vec::new();

            for chat in &chats {
                current.insert(chat.id.clone(), chat.last_msg_local_id);

                let prev = prev_state.get(&chat.id);
                let changed_flag = match prev {
                    Some(prev_id) => *prev_id != chat.last_msg_local_id,
                    None => true,
                };

                if changed_flag {
                    changed.push(serde_json::json!({
                        "chatId": chat.id,
                        "name": chat.name,
                        "unreadCount": chat.unread_count,
                        "isGroup": chat.is_group,
                        "lastMsgTime": chat.last_activity_at,
                    }));
                }
            }

            prev_state = current;
            if !changed.is_empty() {
                tracing::info!(
                    "[events] Poll: {} chats, {} changed",
                    chats.len(),
                    changed.len()
                );

                let payload = serde_json::json!({
                    "type": "new_messages",
                    "chats": changed,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });

                match get_sender().send(payload.to_string()) {
                    Ok(n) => tracing::info!("[events] Broadcast to {} receivers", n),
                    Err(_) => {}
                }
            }
        }
    });
}
