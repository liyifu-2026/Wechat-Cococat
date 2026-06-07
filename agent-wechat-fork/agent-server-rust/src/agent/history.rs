use crate::agent::llm::ChatMessage;
use crate::db::get_db;
use rusqlite::params;

pub struct HistoryStore;

impl HistoryStore {
    pub fn load_seen_messages(&self) -> std::collections::HashSet<String> {
        let db = get_db();
        let mut stmt = match db.prepare("SELECT message_id FROM bridge_seen_messages") {
            Ok(s) => s,
            Err(_) => return std::collections::HashSet::new(),
        };
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .ok();
        match rows {
            Some(iter) => iter.filter_map(|r| r.ok()).collect(),
            None => std::collections::HashSet::new(),
        }
    }

    pub fn save_seen_message(&self, message_id: &str) {
        Self::save_seen_messages_batch(&[message_id.to_string()]);
    }

    pub fn save_seen_messages_batch(message_ids: &[String]) {
        if message_ids.is_empty() {
            return;
        }
        let db = get_db();
        let mut stmt = match db.prepare(
            "INSERT OR IGNORE INTO bridge_seen_messages (message_id) VALUES (?1)",
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        for message_id in message_ids {
            let _ = stmt.execute(params![message_id]);
        }
    }

    pub fn clear_seen_messages(&self, keep_recent: usize) {
        let db = get_db();
        let _ = db.execute(
            "DELETE FROM bridge_seen_messages WHERE message_id NOT IN (SELECT message_id FROM bridge_seen_messages ORDER BY seen_at DESC LIMIT ?1)",
            params![keep_recent as i64],
        );
    }

    pub fn load_history(&self, chat_id: &str) -> Vec<ChatMessage> {
        let db = get_db();
        let result = db.query_row(
            "SELECT messages FROM bridge_chat_histories WHERE chat_id = ?1",
            params![chat_id],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub fn save_history(&self, chat_id: &str, messages: &[ChatMessage]) {
        let db = get_db();
        let json = serde_json::to_string(messages).unwrap_or_default();
        let _ = db.execute(
            "INSERT INTO bridge_chat_histories (chat_id, messages, updated_at) VALUES (?1, ?2, unixepoch() * 1000) ON CONFLICT(chat_id) DO UPDATE SET messages = ?2, updated_at = unixepoch() * 1000",
            params![chat_id, json],
        );
    }

    pub fn prune_stale_histories(&self, max_age_ms: i64) {
        let db = get_db();
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
            - max_age_ms;
        let _ = db.execute(
            "DELETE FROM bridge_chat_histories WHERE updated_at < ?1",
            params![cutoff],
        );
    }
}
