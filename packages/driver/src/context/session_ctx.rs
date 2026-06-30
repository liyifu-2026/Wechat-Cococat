use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::db::get_db;
use crate::db::queries;
use crate::ia::types::Session;
use crate::sessions::manager::get_session;
use crate::tools::wechat_db::{
    find_account_dir, find_wechat_pid, get_db_path, resolve_account_dir,
};
use crate::tools::wechat_keys::{get_stored_keys, verify_key};

static SESSION_CTX_TTL: Duration = Duration::from_secs(5);
static SESSION_CTX_CACHE: OnceLock<Mutex<Option<CachedSessionCtx>>> = OnceLock::new();

#[derive(Clone)]
struct CachedSessionCtx {
    loaded_at: Instant,
    session_id: String,
    logged_in_user: Option<String>,
    ctx: SessionCtx,
}

#[derive(Clone)]
pub struct SessionCtx {
    pub session: Session,
    pub keys: HashMap<String, String>,
    pub image_keys: Option<(String, Option<u8>)>,
    pub account_dir: String,
}

fn heal_logged_in_user(session: &Session, account_dir: &str) {
    if session.logged_in_user.as_deref() == Some(account_dir) {
        return;
    }
    tracing::warn!(
        "[session-ctx] Correcting stale logged_in_user {:?} -> {}",
        session.logged_in_user,
        account_dir
    );
    let db = get_db();
    queries::update_session_logged_in_user(&db, &session.id, Some(account_dir));
}

/// Whether inbox/chat APIs can decrypt session.db right now.
pub fn chats_ready_for_session(session: &Session) -> (bool, Option<&'static str>) {
    if session.login_state != "logged_in" {
        return (false, None);
    }
    let stored = match session.logged_in_user.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return (false, Some("no_account")),
    };
    let account_dir = match resolve_account_dir(stored) {
        Some(dir) => dir,
        None => return (false, Some("account_dir_not_found")),
    };

    let db = get_db();
    let keys = get_stored_keys(&db, &session.id, &account_dir);
    if !keys.contains_key("session.db") || !keys.contains_key("contact.db") {
        return (false, Some("missing_db_keys"));
    }

    let session_path = get_db_path(&account_dir, "session.db");
    let session_key = keys
        .get("session.db")
        .or_else(|| keys.get("session"))
        .map(String::as_str);
    if let Some(key) = session_key {
        if verify_key(&session_path, key) {
            return (true, None);
        }
    }

    (false, Some("invalid_db_keys"))
}

impl SessionCtx {
    pub async fn load() -> Result<Self, String> {
        let session = get_session("default").ok_or("no session available")?;
        if let Some(ctx) = cached_session_ctx(&session) {
            return Ok(ctx);
        }
        let mut stored_owned: Option<String> = None;
        let stored = session
            .logged_in_user
            .as_deref()
            .or_else(|| {
                // Auto-detect if not yet known (container restart, etc.)
                if let Some(dir) = find_wechat_pid().and_then(find_account_dir) {
                    tracing::info!("[session-ctx] auto-detected account_dir={dir} (was None)");
                    let db = get_db();
                    queries::update_session_logged_in_user(&db, &session.id, Some(&dir));
                    stored_owned = Some(dir);
                    stored_owned.as_deref()
                } else {
                    None
                }
            })
            .ok_or("not logged in")?;
        let account_dir = resolve_account_dir(stored)
            .ok_or_else(|| format!("cannot resolve account dir for {stored}"))?;
        heal_logged_in_user(&session, &account_dir);

        let session_id = session.id.clone();
        let snapshot = crate::keystore::ensure_keys(&session_id, &account_dir).await;
        let keys = snapshot.keys;
        let image_keys = snapshot.image_keys;

        let ctx = Self {
            session,
            keys,
            image_keys,
            account_dir,
        };
        store_session_ctx_cache(&ctx);
        Ok(ctx)
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

fn cached_session_ctx(session: &Session) -> Option<SessionCtx> {
    let guard = SESSION_CTX_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()?;
    let cached = guard.as_ref()?;
    if cached.loaded_at.elapsed() >= SESSION_CTX_TTL {
        return None;
    }
    if cached.session_id != session.id {
        return None;
    }
    if cached.logged_in_user != session.logged_in_user {
        return None;
    }
    Some(cached.ctx.clone())
}

fn store_session_ctx_cache(ctx: &SessionCtx) {
    if let Ok(mut guard) = SESSION_CTX_CACHE.get_or_init(|| Mutex::new(None)).lock() {
        *guard = Some(CachedSessionCtx {
            loaded_at: Instant::now(),
            session_id: ctx.session.id.clone(),
            logged_in_user: ctx.session.logged_in_user.clone(),
            ctx: ctx.clone(),
        });
    }
}
