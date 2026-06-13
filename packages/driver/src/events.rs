use std::collections::HashMap;

use tokio::sync::broadcast;

use crate::db::get_db;
use crate::sessions::manager::get_session;
use crate::tools::wechat_chats;
use crate::tools::wechat_db::find_wechat_pid;
use crate::tools::wechat_keys::{
    extract_keys_async, get_stored_keys, mark_unopenable_shards, store_keys,
};

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
        let mut prev_state: HashMap<String, Option<i64>> = HashMap::new();

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

            {
                let db = get_db();
                let stored = get_stored_keys(&db, &session.id, &account_dir);
                mark_unopenable_shards(&db, &session.id, &account_dir, &stored);
            }

            let needs_extract = {
                let db = get_db();
                crate::tools::wechat_keys::needs_key_extraction(&db, &session.id, &account_dir)
            };

            if needs_extract {
                if let Some(pid) = find_wechat_pid() {
                    let extracted = extract_keys_async(pid).await;
                    if !extracted.is_empty() {
                        let db = get_db();
                        store_keys(&db, &session.id, &account_dir, &extracted);
                    }
                }
                let db = get_db();
                let keys_snapshot = get_stored_keys(&db, &session.id, &account_dir);
                mark_unopenable_shards(&db, &session.id, &account_dir, &keys_snapshot);
            }

            let keys = {
                let db = get_db();
                get_stored_keys(&db, &session.id, &account_dir)
            };

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
                tracing::info!("[events] Poll: {} chats, {} changed", chats.len(), changed.len());

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
