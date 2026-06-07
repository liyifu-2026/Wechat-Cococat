use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::db::get_db;
use crate::ia::types::Session;
use crate::sessions::manager::get_session;
use crate::tools::wechat_db::find_wechat_pid;
use crate::tools::wechat_keys::{
    extract_keys_async, get_image_keys, get_stored_keys, mark_unopenable_shards,
    needs_key_extraction, store_keys,
};

static EXTRACT_COOLDOWN: Duration = Duration::from_secs(120);
static LAST_EXTRACT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn extract_on_cooldown(account_dir: &str) -> bool {
    let guard = LAST_EXTRACT
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    guard
        .get(account_dir)
        .is_some_and(|t| t.elapsed() < EXTRACT_COOLDOWN)
}

fn mark_extracted(account_dir: &str) {
    let mut guard = LAST_EXTRACT
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    guard.insert(account_dir.to_string(), Instant::now());
}

pub struct SessionCtx {
    pub session: Session,
    pub keys: HashMap<String, String>,
    pub image_keys: Option<(String, Option<u8>)>,
    pub account_dir: String,
}

impl SessionCtx {
    pub async fn load() -> Result<Self, String> {
        let session = get_session("default").ok_or("no session available")?;
        let account_dir = session
            .logged_in_user
            .as_ref()
            .ok_or("not logged in")?
            .clone();

        let session_id = session.id.clone();
        {
            let db = get_db();
            let stored = get_stored_keys(&db, &session_id, &account_dir);
            mark_unopenable_shards(&db, &session_id, &account_dir, &stored);
        }

        let needs_extract = !extract_on_cooldown(&account_dir)
            && {
                let db = get_db();
                needs_key_extraction(&db, &session_id, &account_dir)
            };

        if needs_extract {
            tracing::info!(
                "[session-ctx] Missing or stale keys for {}, re-extracting...",
                account_dir
            );
            if let Some(pid) = find_wechat_pid() {
                let extracted = extract_keys_async(pid).await;
                if !extracted.is_empty() {
                    let db = get_db();
                    store_keys(&db, &session_id, &account_dir, &extracted);
                    mark_extracted(&account_dir);
                }
            }
            let db = get_db();
            let keys = get_stored_keys(&db, &session_id, &account_dir);
            mark_unopenable_shards(&db, &session_id, &account_dir, &keys);
        }

        let keys = {
            let db = get_db();
            get_stored_keys(&db, &session_id, &account_dir)
        };

        let image_keys = {
            let db = get_db();
            get_image_keys(&db, &session_id, &account_dir)
        };

        Ok(Self {
            session,
            keys,
            image_keys,
            account_dir,
        })
    }

    pub fn is_logged_in(&self) -> bool {
        self.keys.contains_key("session.db") && self.keys.contains_key("contact.db")
    }

    pub fn get_image_decode_params(&self) -> Option<(&str, u8)> {
        self.image_keys
            .as_ref()
            .map(|(key, xor)| (key.as_str(), xor.unwrap_or(0x00)))
    }
}
