use super::wechat_artifacts::{existing_artifact_ref, media_kind_for_msg_type};
use super::wechat_db::{get_db_path, query_wechat_db_params};
use crate::ia::types::{Message, ReplyInfo};
use md5::{Digest, Md5};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

/// ZSTD magic number (little-endian): 0xFD2FB528
const ZSTD_MAGIC: &str = "28b52ffd";

static MSG_DB_CACHE: LazyLock<Mutex<HashMap<String, (String, String)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Get the Msg table name for a given chat username.
/// WeChat uses MD5(username) as the table suffix.
pub fn get_msg_table_name(chat_id: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(chat_id.as_bytes());
    let hash = hasher.finalize();
    format!("Msg_{:x}", hash)
}

/// Decode hex-encoded message content, decompressing zstd if needed.
pub fn decode_message_content(hex: &str, is_compressed: bool) -> String {
    if hex.is_empty() {
        return String::new();
    }
    let bytes = match hex_decode(hex) {
        Some(b) => b,
        None => return String::new(),
    };
    if is_compressed && hex.len() >= 8 && hex[..8].eq_ignore_ascii_case(ZSTD_MAGIC) {
        match zstd::decode_all(bytes.as_slice()) {
            Ok(decompressed) => String::from_utf8_lossy(&decompressed).to_string(),
            Err(_) => "[compressed content - decompression failed]".to_string(),
        }
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    }
}

/// Decode a hex string to bytes.
pub fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[i..i + 2], 16).ok()?;
        bytes.push(byte);
    }
    Some(bytes)
}

/// Extract sender from group message content.
/// Group messages have format "sender_wxid:\nmessage_content".
fn extract_group_sender(content: &str) -> (Option<String>, String) {
    if let Some(idx) = content.find(":\n") {
        if idx < 80 {
            let sender = content[..idx].to_string();
            let msg = content[idx + 2..].to_string();
            return (Some(sender), msg);
        }
    }
    (None, content.to_string())
}

/// Normalize sysmsg / revoke display text (strip XML quotes).
fn normalize_sysmsg_text(text: &str) -> String {
    text.trim().replace('"', "")
}

/// Extract human-readable text from sysmsg / revokemsg XML.
fn extract_sysmsg_display(content: &str) -> String {
    if let Some(inner) = extract_xml_tag(content, "content") {
        return normalize_sysmsg_text(&inner);
    }
    normalize_sysmsg_text(content)
}

/// Clean message content for display based on message type.
/// Replaces verbose XML with concise summaries.
fn clean_content(content: &str, msg_type: i32) -> String {
    let base = msg_type & 0x7FFFFFFF;
    match base {
        // Revoke notice (type 10002)
        10002 if content.contains("revokemsg") || content.contains("<sysmsg") => {
            extract_sysmsg_display(content)
        }
        // Generic system notice (type 10000)
        10000 if content.contains("<sysmsg") => extract_sysmsg_display(content),
        // Image (type 3): replace XML with empty string
        3 if content.contains("<img") => String::new(),
        // Voice (type 34): strip XML payload — ops never need raw voicemsg attrs
        34 if content.contains("<voicemsg") || content.contains("<msg>") => String::new(),
        // Video (type 43): strip XML payload
        43 if content.contains("<videomsg") || content.contains("<msg>") => String::new(),
        // Emoji (type 47): show cdnurl or [emoji]
        47 if content.contains("<emoji") => extract_xml_attr(content, "cdnurl")
            .filter(|u| u.starts_with("http"))
            .unwrap_or_else(|| "[emoji]".to_string()),
        // Appmsg (type 49): handle subtypes
        49 if content.contains("<msg>") => {
            let title = extract_xml_tag(content, "title").unwrap_or_default();
            let appmsg_type = extract_xml_tag(content, "type")
                .and_then(|t| t.parse::<i32>().ok())
                .unwrap_or(0);
            match appmsg_type {
                // Link share (5), video link (4), music share (3)
                3 | 4 | 5 => {
                    let mut parts = Vec::new();
                    parts.push(format!("[Link] {title}"));
                    if let Some(des) = extract_xml_tag(content, "des") {
                        parts.push(des);
                    }
                    if let Some(url) = extract_xml_tag(content, "url") {
                        let url = url.replace("&amp;", "&");
                        parts.push(url);
                    }
                    parts.join("\n")
                }
                _ => {
                    if title.is_empty() {
                        content.to_string()
                    } else {
                        title
                    }
                }
            }
        }
        _ => content.to_string(),
    }
}

/// Extract reply info from type 49 (appmsg) messages with <refermsg>.
fn extract_reply_info(content: &str, msg_type: i32) -> Option<ReplyInfo> {
    let base = msg_type & 0x7FFFFFFF;
    if base != 49 || !content.contains("<refermsg>") {
        return None;
    }
    // Extract the refermsg block
    let rm_start = content.find("<refermsg>")?;
    let rm_end = content.find("</refermsg>")? + "</refermsg>".len();
    let refermsg = &content[rm_start..rm_end];

    let sender = extract_xml_tag(refermsg, "displayname");
    let ref_content = extract_xml_tag(refermsg, "content").unwrap_or_default();

    // The referred content may be XML-escaped; unescape first
    let unescaped = ref_content
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"");

    // The referred content may itself be XML; clean it to a short text
    let clean = if unescaped.contains("<msg>") {
        extract_xml_tag(&unescaped, "title").unwrap_or(unescaped)
    } else {
        unescaped
    };
    Some(ReplyInfo {
        sender,
        content: clean,
    })
}

/// Extract an XML attribute value: attr="value"
fn extract_xml_attr(xml: &str, attr: &str) -> Option<String> {
    let pattern = format!("{attr}=\"");
    let start = xml.find(&pattern)? + pattern.len();
    let end = xml[start..].find('"')? + start;
    let val = xml[start..end].trim().to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

/// Extract text between XML tags: <tag>text</tag>
/// Also handles CDATA: <tag><![CDATA[text]]></tag>
pub(crate) fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let mut val = xml[start..end].trim().to_string();
    // Strip CDATA wrapper if present
    if val.starts_with("<![CDATA[") && val.ends_with("]]>") {
        val = val[9..val.len() - 3].to_string();
    }
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

/// Check if the source XML indicates the current user is @-mentioned.
fn check_is_mentioned(source: &str, account_dir: &str) -> bool {
    if let Some(at_list) = extract_xml_tag(source, "atuserlist") {
        for wxid in at_list.split(',') {
            let wxid = wxid.trim();
            if !wxid.is_empty() && wxid_matches_account(wxid, account_dir) {
                return true;
            }
        }
    }
    false
}

fn wxid_matches_account(wxid: &str, account_dir: &str) -> bool {
    if wxid == account_dir {
        return true;
    }
    if account_dir.starts_with(wxid) || wxid.starts_with(account_dir) {
        return true;
    }
    // Folder names may append a suffix, e.g. wxid_abc_404c vs wxid_abc.
    let base: String = account_dir
        .rsplit_once('_')
        .map(|(prefix, suffix)| {
            if suffix.chars().all(|c| c.is_ascii_digit()) {
                prefix.to_string()
            } else {
                account_dir.to_string()
            }
        })
        .unwrap_or_else(|| account_dir.to_string());
    wxid == base || base.starts_with(wxid) || wxid.starts_with(&base)
}

/// Find which message DB contains a chat and return (db_name, key).
fn find_message_db_uncached<'a>(
    keys: &'a HashMap<String, String>,
    chat_id: &str,
    mut table_exists: impl FnMut(&str, &str, &str) -> bool,
) -> Option<(String, &'a str)> {
    let table_name = get_msg_table_name(chat_id);
    let mut message_dbs: Vec<(&str, &str)> = keys
        .iter()
        .filter(|(k, _)| {
            k.starts_with("message_")
                && k.ends_with(".db")
                && !k.contains("fts")
                && !k.contains("resource")
        })
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    message_dbs.sort_by_key(|(k, _)| k.to_string());

    for (db_name, key) in &message_dbs {
        if table_exists(db_name, key, &table_name) {
            return Some((db_name.to_string(), key));
        }
    }
    None
}

fn message_table_exists(account_dir: &str, db_name: &str, key: &str, table_name: &str) -> bool {
    let db_path = get_db_path(account_dir, db_name);
    let check = query_wechat_db_params(
        &db_path,
        key,
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?1;",
        &[&table_name],
    );
    !check.is_empty()
}

fn message_db_cache_key(account_dir: &str, chat_id: &str) -> String {
    format!("{account_dir}:{chat_id}")
}

fn cached_message_db<'a>(
    account_dir: &str,
    keys: &'a HashMap<String, String>,
    chat_id: &str,
) -> Option<(String, &'a str)> {
    let cache_key = message_db_cache_key(account_dir, chat_id);
    let cached = MSG_DB_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&cache_key).cloned());
    let Some((db_name, cached_key)) = cached else {
        return None;
    };
    match keys.get(&db_name) {
        Some(current_key) if current_key == &cached_key => Some((db_name, current_key.as_str())),
        _ => {
            if let Ok(mut cache) = MSG_DB_CACHE.lock() {
                cache.remove(&cache_key);
            }
            None
        }
    }
}

fn store_message_db_cache(account_dir: &str, chat_id: &str, db_name: &str, key: &str) {
    if let Ok(mut cache) = MSG_DB_CACHE.lock() {
        cache.insert(
            message_db_cache_key(account_dir, chat_id),
            (db_name.to_string(), key.to_string()),
        );
    }
}

fn find_message_db_cached_with_probe<'a>(
    account_dir: &str,
    keys: &'a HashMap<String, String>,
    chat_id: &str,
    table_exists: impl FnMut(&str, &str, &str) -> bool,
) -> Option<(String, &'a str)> {
    if let Some(cached) = cached_message_db(account_dir, keys, chat_id) {
        return Some(cached);
    }

    let found = find_message_db_uncached(keys, chat_id, table_exists);
    if let Some((db_name, key)) = found {
        store_message_db_cache(account_dir, chat_id, &db_name, key);
        return Some((db_name, key));
    }
    None
}

/// Find which message DB contains a chat and return (db_name, key).
pub fn find_message_db<'a>(
    account_dir: &str,
    keys: &'a HashMap<String, String>,
    chat_id: &str,
) -> Option<(String, &'a str)> {
    find_message_db_cached_with_probe(account_dir, keys, chat_id, |db_name, key, table_name| {
        message_table_exists(account_dir, db_name, key, table_name)
    })
}

fn message_select_sql(table_name: &str) -> String {
    format!(
        "SELECT m.local_id, m.server_id, m.local_type, m.create_time,
                hex(m.message_content) as hex_content,
                m.WCDB_CT_message_content as is_compressed,
                hex(m.source) as hex_source,
                m.WCDB_CT_source as source_compressed,
                n.user_name as sender_name
         FROM \"{table_name}\" m
         LEFT JOIN Name2Id n ON m.real_sender_id = n.rowid"
    )
}

fn rows_into_messages(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    is_group: bool,
    rows: Vec<Value>,
) -> Vec<Message> {
    let contact_names: HashMap<String, String> = {
        let mut map = HashMap::new();
        if let Some(contact_key) = keys.get("contact.db") {
            let senders: Vec<String> = rows
                .iter()
                .filter_map(|row| {
                    row.get("sender_name")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                })
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            if !senders.is_empty() {
                let contact_db = get_db_path(account_dir, "contact.db");
                let placeholders = senders.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                let params: Vec<&dyn rusqlite::types::ToSql> = senders
                    .iter()
                    .map(|s| s as &dyn rusqlite::types::ToSql)
                    .collect();
                let contacts = query_wechat_db_params(
                    &contact_db,
                    contact_key,
                    &format!(
                        "SELECT username, nick_name, remark, alias FROM contact WHERE username IN ({placeholders});"
                    ),
                    &params,
                );
                for c in contacts {
                    if let Some(username) = c.get("username").and_then(|v| v.as_str()) {
                        let nick = c
                            .get("nick_name")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty());
                        let remark = c
                            .get("remark")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty());
                        let alias = c
                            .get("alias")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty());
                        let name = if is_group {
                            alias.or(nick).or(remark).unwrap_or(username)
                        } else {
                            remark.or(nick).unwrap_or(username)
                        };
                        map.insert(username.to_string(), name.to_string());
                    }
                }
            }
        }
        map
    };

    rows.iter()
        .filter_map(|row| {
            let local_id = row.get("local_id")?.as_i64()?;
            let server_id = row.get("server_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let msg_type = row.get("local_type").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

            let hex_content = row
                .get("hex_content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let is_compressed = row
                .get("is_compressed")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                != 0;

            let raw_content = decode_message_content(hex_content, is_compressed);

            let sender = row
                .get("sender_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            let body = if is_group {
                extract_group_sender(&raw_content).1
            } else {
                raw_content
            };

            let reply = extract_reply_info(&body, msg_type);
            let content = clean_content(&body, msg_type);

            let timestamp = row
                .get("create_time")
                .and_then(|v| v.as_i64())
                .map(|t| {
                    chrono::DateTime::from_timestamp(t, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let is_mentioned = if is_group {
                let hex_source = row.get("hex_source").and_then(|v| v.as_str()).unwrap_or("");
                let source_compressed = row
                    .get("source_compressed")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0)
                    != 0;
                let from_source = if !hex_source.is_empty() {
                    let source_xml = decode_message_content(hex_source, source_compressed);
                    check_is_mentioned(&source_xml, account_dir)
                } else {
                    false
                };

                let from_content = if !from_source && (msg_type & 0x7FFFFFFF) == 49 {
                    check_is_mentioned(&body, account_dir)
                } else {
                    false
                };

                if from_source || from_content {
                    Some(true)
                } else {
                    None
                }
            } else {
                None
            };

            let is_self = sender.as_ref().map(|s| account_dir.starts_with(s.as_str()));

            let sender_name = sender.as_ref().and_then(|wxid| {
                contact_names.get(wxid).cloned().or_else(|| {
                    let hex_source = row
                        .get("hex_source")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())?;
                    let source_compressed = row
                        .get("source_compressed")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        != 0;
                    let source_xml = decode_message_content(hex_source, source_compressed);
                    extract_xml_tag(&source_xml, "fromnickname")
                        .or_else(|| extract_xml_tag(&source_xml, "displayname"))
                        .filter(|name| !name.starts_with("wxid_"))
                })
            });

            Some(Message {
                local_id,
                server_id,
                chat_id: chat_id.to_string(),
                sender,
                sender_name,
                msg_type,
                content,
                timestamp,
                is_mentioned,
                is_self,
                reply,
                media_kind: media_kind_for_msg_type(msg_type).map(str::to_string),
                artifact_ref: existing_artifact_ref(chat_id, local_id, msg_type),
                client_msg_id: None,
            })
        })
        .collect()
}

fn query_messages_sql(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Vec<Message> {
    let is_group = chat_id.contains("@chatroom");
    let (db_name, key) = match find_message_db(account_dir, keys, chat_id) {
        Some(dk) => dk,
        None => return Vec::new(),
    };
    let db_path = get_db_path(account_dir, &db_name);
    let rows = query_wechat_db_params(&db_path, key, sql, params);
    rows_into_messages(account_dir, keys, chat_id, is_group, rows)
}

fn message_create_time(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    local_id: i64,
) -> Option<i64> {
    let table_name = get_msg_table_name(chat_id);
    let (db_name, key) = find_message_db(account_dir, keys, chat_id)?;
    let db_path = get_db_path(account_dir, &db_name);
    let rows = query_wechat_db_params(
        &db_path,
        key,
        &format!("SELECT create_time FROM \"{table_name}\" WHERE local_id = ?1 LIMIT 1;"),
        &[&local_id],
    );
    rows.first()?.get("create_time")?.as_i64()
}

fn dedupe_messages_desc(messages: Vec<Message>) -> Vec<Message> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(messages.len());
    for msg in messages {
        if seen.insert(msg.local_id) {
            out.push(msg);
        }
    }
    out
}

/// List messages for a specific chat.
///
/// Messages may be spread across message_0.db, message_1.db, etc.
/// Each chat's messages are in a `Msg_{MD5(username)}` table.
pub fn list_messages(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    limit: i64,
    offset: i64,
) -> Vec<Message> {
    let table_name = get_msg_table_name(chat_id);
    let sql = format!(
        "{} ORDER BY m.create_time DESC LIMIT ?1 OFFSET ?2;",
        message_select_sql(&table_name)
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = vec![&limit, &offset];
    query_messages_sql(account_dir, keys, chat_id, &sql, &params)
}

/// Messages strictly older than `before_time` (unix seconds), newest-first.
pub fn list_messages_before_time(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    before_time: i64,
    limit: i64,
) -> Vec<Message> {
    let table_name = get_msg_table_name(chat_id);
    let sql = format!(
        "{} WHERE m.create_time < ?1 ORDER BY m.create_time DESC LIMIT ?2;",
        message_select_sql(&table_name)
    );
    query_messages_sql(account_dir, keys, chat_id, &sql, &[&before_time, &limit])
}

/// Messages strictly newer than `after_time` (unix seconds), returned newest-first.
pub fn list_messages_after_time(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    after_time: i64,
    limit: i64,
) -> Vec<Message> {
    let table_name = get_msg_table_name(chat_id);
    let sql = format!(
        "{} WHERE m.create_time > ?1 ORDER BY m.create_time ASC LIMIT ?2;",
        message_select_sql(&table_name)
    );
    let mut messages = query_messages_sql(account_dir, keys, chat_id, &sql, &[&after_time, &limit]);
    messages.reverse();
    messages
}

/// Window of messages centered on `local_id` (≈ half limit on each side).
pub fn list_messages_around(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    local_id: i64,
    limit: i64,
) -> Vec<Message> {
    let Some(target_time) = message_create_time(account_dir, keys, chat_id, local_id) else {
        return Vec::new();
    };
    let table_name = get_msg_table_name(chat_id);
    let half = limit.max(2) / 2;
    let newer_limit = half + 1;
    let older_limit = half;

    let newer_sql = format!(
        "{} WHERE m.create_time >= ?1 ORDER BY m.create_time ASC LIMIT ?2;",
        message_select_sql(&table_name)
    );
    let older_sql = format!(
        "{} WHERE m.create_time < ?1 ORDER BY m.create_time DESC LIMIT ?2;",
        message_select_sql(&table_name)
    );

    let mut newer = query_messages_sql(
        account_dir,
        keys,
        chat_id,
        &newer_sql,
        &[&target_time, &newer_limit],
    );
    newer.reverse();
    let older = query_messages_sql(
        account_dir,
        keys,
        chat_id,
        &older_sql,
        &[&target_time, &older_limit],
    );

    let mut merged = newer;
    merged.extend(older);
    dedupe_messages_desc(merged)
}

#[cfg(test)]
mod tests {
    use super::{
        clean_content, find_message_db_cached_with_probe, message_db_cache_key, MSG_DB_CACHE,
    };
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn clean_content_strips_voice_xml() {
        let xml = r#"<msg><voicemsg endflag="1" voicelength="2699" voiceurl="abc" /></msg>"#;
        assert_eq!(clean_content(xml, 34), "");
    }

    #[test]
    fn clean_content_strips_video_xml() {
        let xml = r#"<msg><videomsg length="123" /></msg>"#;
        assert_eq!(clean_content(xml, 43), "");
    }

    #[test]
    fn clean_content_strips_image_xml() {
        let xml = r#"<msg><img hdlength="1" /></msg>"#;
        assert_eq!(clean_content(xml, 3), "");
    }

    #[test]
    fn clean_content_keeps_plain_text() {
        assert_eq!(clean_content("你好", 1), "你好");
    }

    #[test]
    fn clean_content_revoke_sysmsg() {
        let xml = r#"<sysmsg type="revokemsg"><revokemsg><content>"Leaif" 撤回了一条消息</content></revokemsg></sysmsg>"#;
        assert_eq!(clean_content(xml, 10002), "Leaif 撤回了一条消息");
    }

    #[test]
    fn message_db_lookup_caches_chat_shard() {
        let account = "acct-cache";
        let chat = "wxid_cache";
        let cache_key = message_db_cache_key(account, chat);
        MSG_DB_CACHE.lock().unwrap().remove(&cache_key);

        let keys = HashMap::from([
            ("message_0.db".to_string(), "k0".to_string()),
            ("message_1.db".to_string(), "k1".to_string()),
        ]);
        let probes = AtomicUsize::new(0);

        let first = find_message_db_cached_with_probe(account, &keys, chat, |db_name, _, _| {
            probes.fetch_add(1, Ordering::SeqCst);
            db_name == "message_1.db"
        });
        assert_eq!(first, Some(("message_1.db".to_string(), "k1")));
        assert_eq!(probes.load(Ordering::SeqCst), 2);

        let second = find_message_db_cached_with_probe(account, &keys, chat, |_, _, _| {
            probes.fetch_add(1, Ordering::SeqCst);
            false
        });
        assert_eq!(second, Some(("message_1.db".to_string(), "k1")));
        assert_eq!(probes.load(Ordering::SeqCst), 2);

        MSG_DB_CACHE.lock().unwrap().remove(&cache_key);
    }

    #[test]
    fn message_db_cache_invalidates_when_key_changes() {
        let account = "acct-rotate";
        let chat = "wxid_rotate";
        let cache_key = message_db_cache_key(account, chat);
        MSG_DB_CACHE.lock().unwrap().remove(&cache_key);

        let keys = HashMap::from([("message_0.db".to_string(), "old".to_string())]);
        let first = find_message_db_cached_with_probe(account, &keys, chat, |db_name, _, _| {
            db_name == "message_0.db"
        });
        assert_eq!(first, Some(("message_0.db".to_string(), "old")));

        let rotated = HashMap::from([("message_0.db".to_string(), "new".to_string())]);
        let probes = AtomicUsize::new(0);
        let second = find_message_db_cached_with_probe(account, &rotated, chat, |db_name, _, _| {
            probes.fetch_add(1, Ordering::SeqCst);
            db_name == "message_0.db"
        });
        assert_eq!(second, Some(("message_0.db".to_string(), "new")));
        assert_eq!(probes.load(Ordering::SeqCst), 1);

        MSG_DB_CACHE.lock().unwrap().remove(&cache_key);
    }
}
