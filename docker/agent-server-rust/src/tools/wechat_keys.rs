use super::exec::{exec_command, ExecOptions};
use super::wechat_db::{get_db_path, list_account_dbs};
use crate::sessions::manager::get_session;
use rusqlite::{params, Connection, OpenFlags};
use std::collections::HashMap;
use std::path::Path;

/// Extract all WeChat DB credentials (async, non-blocking).
/// Calls the Python extract-keys script.
pub async fn extract_keys_async(wechat_pid: i64) -> HashMap<String, String> {
    let out_path = format!("/tmp/wechat_keys_{wechat_pid}.json");

    let exec_options = ExecOptions {
        session: get_session("default"),
        timeout_ms: 120_000,
    };

    let _ = exec_command(
        "python3",
        &[
            "/opt/tools/extract-keys.py",
            "--pid",
            &wechat_pid.to_string(),
            "--output",
            &out_path,
        ],
        &exec_options,
    )
    .await;

    let result = (|| -> Option<HashMap<String, String>> {
        let content = std::fs::read_to_string(&out_path).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
        let keys = parsed.get("keys")?.as_object()?;
        let map: HashMap<String, String> = keys
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
            .collect();

        let db_keys: Vec<_> = map.keys().filter(|k| !k.starts_with('_')).collect();
        let has_image_aes = map.contains_key("_image_aes");
        tracing::info!(
            "[wechat-keys] Extracted {} DB keys, image key: {}",
            db_keys.len(),
            if has_image_aes { "yes" } else { "no" }
        );
        Some(map)
    })();

    // Clean up temp file
    let _ = std::fs::remove_file(&out_path);

    result.unwrap_or_default()
}

/// Get stored keys for a session + account from the agent DB.
pub fn get_stored_keys(
    conn: &Connection,
    session_id: &str,
    account_dir: &str,
) -> HashMap<String, String> {
    let mut stmt = match conn.prepare(
        "SELECT db_name, hex_key FROM wechat_keys
         WHERE session_id = ?1 AND account_dir = ?2",
    ) {
        Ok(stmt) => stmt,
        Err(e) => {
            tracing::error!("[wechat-keys] failed to prepare key query: {e}");
            return HashMap::new();
        }
    };

    let rows = match stmt.query_map(params![session_id, account_dir], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("[wechat-keys] failed to query stored keys: {e}");
            return HashMap::new();
        }
    };

    let mut map = HashMap::new();
    for row in rows.flatten() {
        map.insert(row.0, row.1);
    }
    add_key_aliases(account_dir, &mut map);
    map
}

fn add_key_aliases(account_dir: &str, keys: &mut HashMap<String, String>) {
    let aliases: &[(&str, &[&str])] = &[
        ("session", &["session.db"]),
        ("contact", &["contact.db", "contact_fts.db"]),
        (
            "message",
            &[
                "message_0.db",
                "message_fts.db",
                "message_resource.db",
                "biz_message_0.db",
                "media_0.db",
            ],
        ),
        ("emoticon", &["emoticon.db"]),
        ("head_image", &["head_image.db"]),
        ("hardlink", &["hardlink.db"]),
        ("favorite", &["favorite.db", "favorite_fts.db"]),
        ("general", &["general.db"]),
        ("sns", &["sns.db"]),
        ("bizchat", &["bizchat.db"]),
    ];

    for (category, db_names) in aliases {
        if let Some(key) = keys.get(*category).cloned() {
            for db_name in *db_names {
                keys.entry((*db_name).to_string())
                    .or_insert_with(|| key.clone());
            }
        }
    }

    for db_name in list_account_dbs(account_dir) {
        if keys.contains_key(&db_name) {
            continue;
        }
        if let Some(category) = crate::tools::wechat_db::get_db_category(&db_name) {
            if let Some(key) = keys.get(category).cloned() {
                keys.insert(db_name, key);
            }
        }
    }
}

fn has_key_for_db(keys: &HashMap<String, String>, db_name: &str) -> bool {
    keys.contains_key(db_name)
        || crate::tools::wechat_db::get_db_category(db_name)
            .map(|category| keys.contains_key(category))
            .unwrap_or(false)
}

fn skipped_db_key(db_name: &str) -> String {
    format!("_skip:{db_name}")
}

pub fn is_db_skipped(keys: &HashMap<String, String>, db_name: &str) -> bool {
    keys.contains_key(&skipped_db_key(db_name))
}

pub fn mark_db_skipped(conn: &Connection, session_id: &str, account_dir: &str, db_name: &str) {
    let mut keys = HashMap::new();
    keys.insert(skipped_db_key(db_name), "1".to_string());
    store_keys(conn, session_id, account_dir, &keys);
    tracing::warn!("[wechat-keys] Marked unopenable DB as skipped: {db_name}");
}

fn resolve_key_for_db(keys: &HashMap<String, String>, db_name: &str) -> Option<String> {
    keys.get(db_name).cloned().or_else(|| {
        crate::tools::wechat_db::get_db_category(db_name)
            .and_then(|category| keys.get(category).cloned())
    })
}

/// Shard DBs that exist on disk but cannot be opened with stored keys (corrupt/wrong key).
pub fn mark_unopenable_shards(
    conn: &Connection,
    session_id: &str,
    account_dir: &str,
    keys: &HashMap<String, String>,
) {
    for db_name in list_account_dbs(account_dir) {
        if !(db_name.starts_with("message_") || db_name.starts_with("media_")) {
            continue;
        }
        if is_db_skipped(keys, &db_name) {
            continue;
        }
        let path = get_db_path(account_dir, &db_name);
        if !Path::new(&path).exists() {
            continue;
        }
        let Some(hex_key) = resolve_key_for_db(keys, &db_name) else {
            continue;
        };
        if !verify_key(&path, &hex_key) {
            mark_db_skipped(conn, session_id, account_dir, &db_name);
        }
    }
}

/// Store extracted keys in the agent DB.
pub fn store_keys(
    conn: &Connection,
    session_id: &str,
    account_dir: &str,
    keys: &HashMap<String, String>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    for (db_name, hex_key) in keys {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO wechat_keys (id, session_id, account_dir, db_name, hex_key, verified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(session_id, account_dir, db_name) DO UPDATE SET
               hex_key = excluded.hex_key,
               verified_at = excluded.verified_at",
            params![id, session_id, account_dir, db_name, hex_key, now],
        )
        .ok();
    }
}

/// Store a single key.
pub fn store_single_key(
    conn: &Connection,
    session_id: &str,
    account_dir: &str,
    db_name: &str,
    hex_key: &str,
) {
    let mut keys = HashMap::new();
    keys.insert(db_name.to_string(), hex_key.to_string());
    store_keys(conn, session_id, account_dir, &keys);
}

/// Verify a single key against a database file.
/// Opens with immutable=1 to avoid acquiring any locks that could interfere
/// with WeChat's own writes/checkpoints.
pub fn verify_key(db_path: &str, hex_key: &str) -> bool {
    let uri = format!("file:{}?immutable=1", db_path);
    let conn = match Connection::open_with_flags(
        &uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(_) => return false,
    };

    if conn
        .execute_batch(&format!(
            "PRAGMA key = \"x'{hex_key}'\"; PRAGMA cipher_compatibility = 4;"
        ))
        .is_err()
    {
        return false;
    }

    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .is_ok()
}

/// Check if credential setup is needed.
///
/// 1. Check that all required DB keys exist in stored_keys
/// 2. Scan disk for additional required DBs (message_N, media_N) without keys
/// 3. Spot-check one key for validity
pub fn needs_key_extraction(conn: &Connection, session_id: &str, account_dir: &str) -> bool {
    let stored_keys = get_stored_keys(conn, session_id, account_dir);

    if stored_keys.is_empty() {
        tracing::info!("[wechat-keys] No stored keys, extraction needed");
        return true;
    }

    let required_exact: &[&str] = &[
        "session.db",
        "contact.db",
        "emoticon.db",
        "head_image.db",
        "hardlink.db",
    ];
    let required_prefixes: &[&str] = &["message_", "media_"];

    // Check required exact keys are present (regardless of disk scan)
    let missing_required: Vec<&str> = required_exact
        .iter()
        .filter(|name| !has_key_for_db(&stored_keys, name))
        .copied()
        .collect();

    if !missing_required.is_empty() {
        tracing::info!(
            "[wechat-keys] Missing required keys: {}",
            missing_required.join(", ")
        );
        return true;
    }

    // Scan disk for sharded DBs (message_N.db, media_N.db) missing keys.
    // Note: extract keys are stored by category (e.g. "message"), not individual file names.
    // Map DB names to their key categories before checking.
    let existing_dbs = list_account_dbs(account_dir);

    let missing_on_disk: Vec<_> = existing_dbs
        .iter()
        .filter(|name| required_prefixes.iter().any(|p| name.starts_with(p)))
        .filter(|name| !is_db_skipped(&stored_keys, name))
        .filter(|name| {
            let path = get_db_path(account_dir, name);
            if !Path::new(&path).exists() {
                return false;
            }
            if let Some(hex_key) = resolve_key_for_db(&stored_keys, name) {
                if verify_key(&path, &hex_key) {
                    return false;
                }
                mark_db_skipped(conn, session_id, account_dir, name);
                return false;
            }
            let category = crate::tools::wechat_db::get_db_category(name);
            category.map_or(true, |cat| !stored_keys.contains_key(cat))
        })
        .collect();

    if !missing_on_disk.is_empty() {
        tracing::info!(
            "[wechat-keys] Missing keys for on-disk DBs: {}",
            missing_on_disk
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        return true;
    }

    // Spot-check one key
    let check_db = "session.db";
    if let Some(check_key) = stored_keys
        .get(check_db)
        .or_else(|| stored_keys.get("session"))
    {
        let check_path = get_db_path(account_dir, check_db);
        if !verify_key(&check_path, check_key) {
            tracing::info!("[wechat-keys] Spot-check failed for {check_db}, re-extraction needed");
            return true;
        }
    }

    let db_key_count = stored_keys.keys().filter(|k| !k.starts_with('_')).count();
    tracing::debug!(
        "[wechat-keys] {db_key_count} DB keys stored, spot-check passed, image_aes={}",
        stored_keys.contains_key("_image_aes")
    );
    false
}

/// Get stored image keys.
pub fn get_image_keys(
    conn: &Connection,
    session_id: &str,
    account_dir: &str,
) -> Option<(String, Option<u8>)> {
    let keys = get_stored_keys(conn, session_id, account_dir);
    let aes_hex = keys.get("_image_aes")?;
    let xor_byte = keys
        .get("_image_xor")
        .and_then(|h| u8::from_str_radix(h, 16).ok());
    Some((aes_hex.clone(), xor_byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skipped_db_key_format() {
        let mut keys = HashMap::new();
        keys.insert(skipped_db_key("message_0.db"), "1".into());
        assert!(is_db_skipped(&keys, "message_0.db"));
        assert!(!is_db_skipped(&keys, "message_1.db"));
    }

    #[test]
    fn has_key_for_db_uses_category_alias() {
        let mut keys = HashMap::new();
        keys.insert("message".into(), "deadbeef".into());
        assert!(has_key_for_db(&keys, "message_0.db"));
    }
}
