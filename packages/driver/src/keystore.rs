//! KeyStore — single source of truth for WeChat DB key extraction.
//!
//! Replaces the 3 drifted call sites in `events.rs`, `context/session_ctx.rs`,
//! and `plans/login.rs` with two intent-clear entry points:
//!
//! - [`ensure_keys`] — regular path. Honours a shared per-account_dir cooldown
//!   so that `events` loop and `session_ctx` loader no longer race each other.
//! - [`force_extract_keys`] — login path. No cooldown: login success must yield
//!   fresh keys immediately. Still updates the cooldown map so a subsequent
//!   `ensure_keys` within the cooldown window won't re-extract.
//!
//! Cooldown is configurable via `KEYSTORE_EXTRACT_COOLDOWN_SECS` (default 30s).
//! 10s (old events.rs) was too aggressive — risks anti-cheat attention on WeChat.
//! 120s (old session_ctx.rs) was too conservative — transient extract failure
//! left the user in "unavailable" state for 2 minutes. 30s balances both.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::db::get_db;
use crate::tools::wechat_db::find_wechat_pid;
use crate::tools::wechat_keys::{
    extract_keys_async, get_image_keys, get_stored_keys, mark_unopenable_shards,
    needs_key_extraction, store_keys,
};

/// Result of a key extraction / lookup. Always carries both DB keys and image
/// keys so callers don't have to remember to fetch image_keys separately (the
/// old `events.rs` path forgot to, which was a latent bug).
#[derive(Clone, Debug)]
pub struct KeySnapshot {
    pub keys: HashMap<String, String>,
    pub image_keys: Option<(String, Option<u8>)>,
}

fn cooldown_duration() -> Duration {
    const DEFAULT_SECS: u64 = 30;
    let secs = std::env::var("KEYSTORE_EXTRACT_COOLDOWN_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_SECS);
    Duration::from_secs(secs.max(1))
}

/// Process-level shared cooldown map. Keyed by `account_dir` so that
/// `events` loop and `session_ctx` loader — which run in different tasks but
/// target the same WeChat account — share the same cooldown state.
static LAST_EXTRACT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn last_extract_map() -> &'static Mutex<HashMap<String, Instant>> {
    LAST_EXTRACT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_on_cooldown(account_dir: &str) -> bool {
    let guard = last_extract_map()
        .lock()
        .expect("LAST_EXTRACT mutex poisoned");
    guard
        .get(account_dir)
        .is_some_and(|t| t.elapsed() < cooldown_duration())
}

fn mark_extracted(account_dir: &str) {
    let mut guard = last_extract_map()
        .lock()
        .expect("LAST_EXTRACT mutex poisoned");
    guard.insert(account_dir.to_string(), Instant::now());
}

/// Read the current stored snapshot (no extraction). Performs the
/// `mark_unopenable_shards` side effect that all three old call sites did
/// after reading stored keys — internalised here so callers don't forget.
fn read_snapshot(session_id: &str, account_dir: &str) -> KeySnapshot {
    let db = get_db();
    let keys = get_stored_keys(&db, session_id, account_dir);
    mark_unopenable_shards(&db, session_id, account_dir, &keys);
    let image_keys = get_image_keys(&db, session_id, account_dir);
    KeySnapshot { keys, image_keys }
}

/// Internal: run the extract-then-store sequence. Does NOT consult cooldown.
/// Caller is responsible for cooldown gating (or intentional bypass).
async fn run_extract(session_id: &str, account_dir: &str) {
    // PID lookup is internal — callers never need to pass a pid. If we can't
    // find a WeChat process, there's nothing to extract.
    let Some(pid) = find_wechat_pid() else {
        return;
    };
    let extracted = extract_keys_async(pid).await;
    if extracted.is_empty() {
        tracing::warn!("[keystore] key extraction returned empty for {account_dir}");
        return;
    }
    let db = get_db();
    store_keys(&db, session_id, account_dir, &extracted);
    mark_extracted(account_dir);
    tracing::info!("[keystore] key extraction succeeded for {account_dir}");
}

/// Regular path: return a [`KeySnapshot`], extracting only if needed and not
/// on cooldown. Used by `events` loop and `session_ctx` loader.
///
/// Cooldown is per-`account_dir` and shared across all callers in this
/// process, so the events loop and session_ctx loader no longer race.
pub async fn ensure_keys(session_id: &str, account_dir: &str) -> KeySnapshot {
    // Always refresh shard markers first — cheap, and keeps stored_keys honest.
    {
        let db = get_db();
        let stored = get_stored_keys(&db, session_id, account_dir);
        mark_unopenable_shards(&db, session_id, account_dir, &stored);
    }

    let needs_extract = !is_on_cooldown(account_dir)
        && {
            let db = get_db();
            needs_key_extraction(&db, session_id, account_dir)
        };

    if needs_extract {
        tracing::info!("[keystore] keys needed for {account_dir}, extracting...");
        run_extract(session_id, account_dir).await;
    }

    read_snapshot(session_id, account_dir)
}

/// Force path: extract fresh keys immediately, bypassing cooldown. Used by
/// `login.rs` — after a successful login, we must have fresh keys; cooldown
/// would only hurt here. Still calls `mark_extracted` so a subsequent
/// `ensure_keys` within the cooldown window skips.
pub async fn force_extract_keys(session_id: &str, account_dir: &str) -> KeySnapshot {
    tracing::info!("[keystore] force-extracting keys for {account_dir}");
    run_extract(session_id, account_dir).await;
    read_snapshot(session_id, account_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooldown_duration_respects_env() {
        // Default when unset.
        std::env::remove_var("KEYSTORE_EXTRACT_COOLDOWN_SECS");
        assert_eq!(cooldown_duration(), Duration::from_secs(30));

        std::env::set_var("KEYSTORE_EXTRACT_COOLDOWN_SECS", "5");
        assert_eq!(cooldown_duration(), Duration::from_secs(5));

        // Clamped to >= 1.
        std::env::set_var("KEYSTORE_EXTRACT_COOLDOWN_SECS", "0");
        assert_eq!(cooldown_duration(), Duration::from_secs(1));

        std::env::remove_var("KEYSTORE_EXTRACT_COOLDOWN_SECS");
    }

    #[test]
    fn cooldown_duration_ignores_garbage() {
        std::env::set_var("KEYSTORE_EXTRACT_COOLDOWN_SECS", "not-a-number");
        assert_eq!(cooldown_duration(), Duration::from_secs(30));
        std::env::remove_var("KEYSTORE_EXTRACT_COOLDOWN_SECS");
    }

    #[test]
    fn mark_and_check_cooldown() {
        // Use a unique key to avoid collision with other tests.
        let key = "keystore-test-cooldown-marker";
        assert!(!is_on_cooldown(key));
        mark_extracted(key);
        assert!(is_on_cooldown(key));
    }
}
