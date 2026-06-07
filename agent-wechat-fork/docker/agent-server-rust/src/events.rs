use std::collections::HashMap;

use tokio::sync::broadcast;

use crate::db::get_db;
use crate::sessions::manager::get_session;
use crate::tools::wechat_chats;
use crate::tools::wechat_db::{find_wechat_pid, list_account_dbs};
use crate::tools::wechat_keys::{extract_keys_async, get_stored_keys, store_keys};

static EVENT_TX: std::sync::OnceLock<broadcast::Sender<String>> = std::sync::OnceLock::new();
const CHANNEL_CAPACITY: usize = 1024;

pub fn init_event_broadcast() {
    let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
    EVENT_TX.set(tx).ok();
}

pub fn get_sender() -> &'static broadcast::Sender<String> {
    EVENT_TX
        .get()
        .expect("Event broadcast not initialized; call init_event_broadcast first")
}

pub fn spawn_event_monitor() {
    tokio::spawn(async move {
        tracing::info!("[events] Event monitor started");
        let mut prev_state: HashMap<String, (i32, Option<String>)> = HashMap::new();

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let session = match get_session("default") {
                Some(s) if s.status == "running" => s,
                _ => continue,
            };

            let account_dir = match &session.logged_in_user {
                Some(u) => u.clone(),
                None => continue,
            };

            let mut keys = {
                let db = get_db();
                get_stored_keys(&db, &session.id, &account_dir)
            };

            if !keys.contains_key("session.db") || !keys.contains_key("contact.db") {
                let on_disk = list_account_dbs(&account_dir);
                let has_missing = on_disk.iter().any(|name| {
                    (name == "session.db" || name == "contact.db")
                        && !keys.contains_key(name.as_str())
                });
                if has_missing {
                    if let Some(pid) = find_wechat_pid() {
                        let extracted = extract_keys_async(pid).await;
                        if !extracted.is_empty() {
                            let db = get_db();
                            store_keys(&db, &session.id, &account_dir, &extracted);
                            keys = get_stored_keys(&db, &session.id, &account_dir);
                        }
                    }
                }
            }

            if !keys.contains_key("session.db") || !keys.contains_key("contact.db") {
                continue;
            }

            let chats = wechat_chats::list_chats(&account_dir, &keys, 200, 0);

            let mut current: HashMap<String, (i32, Option<String>)> = HashMap::new();
            let mut changed: Vec<serde_json::Value> = Vec::new();

            for chat in &chats {
                let current_key = (chat.unread_count, chat.last_activity_at.clone());
                current.insert(chat.id.clone(), current_key.clone());

                let prev = prev_state.get(&chat.id);
                let changed_flag = match prev {
                    Some(prev_key) => prev_key != &current_key,
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
            tracing::info!("[events] Poll: {} chats, {} changed", chats.len(), changed.len());

            if !changed.is_empty() {
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
