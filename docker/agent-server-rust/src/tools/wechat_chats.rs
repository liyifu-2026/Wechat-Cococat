use super::wechat_contacts::contact_select_projection;
use super::wechat_db::{get_db_path, query_wechat_db_params};
use crate::ia::types::Chat;
use std::collections::HashMap;

fn small_head_url_from_contact(contact: Option<&serde_json::Value>) -> Option<String> {
    contact
        .and_then(|c| c.get("small_head_url"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// List chats by querying WeChat's session.db and contact.db.
pub fn list_chats(
    account_dir: &str,
    keys: &HashMap<String, String>,
    limit: i64,
    offset: i64,
) -> Vec<Chat> {
    let session_key = match keys.get("session.db") {
        Some(k) => k,
        None => return Vec::new(),
    };
    let contact_key = match keys.get("contact.db") {
        Some(k) => k,
        None => return Vec::new(),
    };

    let session_db = get_db_path(account_dir, "session.db");
    let contact_db = get_db_path(account_dir, "contact.db");

    let sessions = query_wechat_db_params(
        &session_db,
        session_key,
        "SELECT username, type, unread_count, summary, draft, last_timestamp,
                sort_timestamp, last_msg_sender, last_sender_display_name, is_hidden,
                last_msg_locald_id
         FROM SessionTable
         WHERE is_hidden = 0
         ORDER BY sort_timestamp DESC
         LIMIT ?1 OFFSET ?2;",
        &[&limit, &offset],
    );

    if sessions.is_empty() {
        return Vec::new();
    }

    // Batch lookup contacts
    let usernames: Vec<String> = sessions
        .iter()
        .filter_map(|s| s.get("username").and_then(|v| v.as_str()).map(String::from))
        .collect();

    let mut contact_map: HashMap<String, serde_json::Value> = HashMap::new();
    for chunk in usernames.chunks(50) {
        let placeholders: String = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let params: Vec<&dyn rusqlite::types::ToSql> = chunk
            .iter()
            .map(|u| u as &dyn rusqlite::types::ToSql)
            .collect();

        let contacts = query_wechat_db_params(
            &contact_db,
            contact_key,
            &format!(
                "SELECT {}
                 FROM contact
                 WHERE username IN ({placeholders});",
                contact_select_projection(account_dir, contact_key),
            ),
            &params,
        );

        for c in contacts {
            if let Some(u) = c.get("username").and_then(|v| v.as_str()) {
                contact_map.insert(u.to_string(), c);
            }
        }
    }

    sessions
        .iter()
        .filter_map(|session| {
            let username = session.get("username")?.as_str()?.to_string();
            let contact = contact_map.get(&username);
            let is_group = username.contains("@chatroom");

            let name = contact
                .and_then(|c| {
                    c.get("remark")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                })
                .or_else(|| {
                    contact.and_then(|c| {
                        c.get("nick_name")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                    })
                })
                .unwrap_or(&username)
                .to_string();

            let remark = contact
                .and_then(|c| {
                    c.get("remark")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                })
                .map(String::from);

            let unread_count = session
                .get("unread_count")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;

            let last_message_preview = session
                .get("summary")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);

            let last_message_sender = session
                .get("last_sender_display_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    session
                        .get("last_msg_sender")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                })
                .map(String::from);

            let last_activity_at = session
                .get("last_timestamp")
                .and_then(|v| v.as_i64())
                .filter(|&t| t > 0)
                .map(|t| {
                    chrono::DateTime::from_timestamp(t, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                });

            let last_msg_local_id = session.get("last_msg_locald_id").and_then(|v| v.as_i64());

            Some(Chat {
                id: username.clone(),
                username,
                name,
                remark,
                unread_count,
                is_group,
                small_head_url: small_head_url_from_contact(contact),
                last_message_preview,
                last_message_sender,
                last_activity_at,
                last_msg_local_id,
            })
        })
        .collect()
}

/// Find a chat by WeChat username (exact match).
pub fn get_chat_by_username(
    account_dir: &str,
    keys: &HashMap<String, String>,
    username: &str,
) -> Option<Chat> {
    let session_key = keys.get("session.db")?;
    let contact_key = keys.get("contact.db")?;

    let session_db = get_db_path(account_dir, "session.db");
    let contact_db = get_db_path(account_dir, "contact.db");

    let sessions = query_wechat_db_params(
        &session_db,
        session_key,
        "SELECT username, type, unread_count, summary, draft, last_timestamp,
                sort_timestamp, last_msg_sender, last_sender_display_name, is_hidden,
                last_msg_locald_id
         FROM SessionTable
         WHERE username = ?1;",
        &[&username],
    );

    let session = sessions.first()?;
    let is_group = username.contains("@chatroom");

    let contacts = query_wechat_db_params(
        &contact_db,
        contact_key,
        &format!(
            "SELECT {}
             FROM contact
             WHERE username = ?1;",
            contact_select_projection(account_dir, contact_key),
        ),
        &[&username],
    );
    let contact = contacts.first();

    let name = contact
        .and_then(|c| {
            c.get("remark")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            contact.and_then(|c| {
                c.get("nick_name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
        })
        .unwrap_or(username)
        .to_string();

    let remark = contact
        .and_then(|c| {
            c.get("remark")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .map(String::from);

    let unread_count = session
        .get("unread_count")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    Some(Chat {
        id: username.to_string(),
        username: username.to_string(),
        name,
        remark,
        unread_count,
        is_group,
        small_head_url: small_head_url_from_contact(contact),
        last_message_preview: session
            .get("summary")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        last_message_sender: session
            .get("last_sender_display_name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        last_activity_at: session
            .get("last_timestamp")
            .and_then(|v| v.as_i64())
            .filter(|&t| t > 0)
            .map(|t| {
                chrono::DateTime::from_timestamp(t, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            }),
        last_msg_local_id: session.get("last_msg_locald_id").and_then(|v| v.as_i64()),
    })
}

/// Find chats by name (partial match).
pub fn find_chats_by_name(
    account_dir: &str,
    keys: &HashMap<String, String>,
    query: &str,
) -> Vec<Chat> {
    let contact_key = match keys.get("contact.db") {
        Some(k) => k,
        None => return Vec::new(),
    };
    let session_key = match keys.get("session.db") {
        Some(k) => k,
        None => return Vec::new(),
    };

    let contact_db = get_db_path(account_dir, "contact.db");
    let session_db = get_db_path(account_dir, "session.db");
    let like_pattern = format!("%{}%", query);

    let contacts = query_wechat_db_params(
        &contact_db,
        contact_key,
        &format!(
            "SELECT {}
             FROM contact
             WHERE nick_name LIKE ?1
                OR remark LIKE ?1
                OR username LIKE ?1
             LIMIT 20;",
            contact_select_projection(account_dir, contact_key),
        ),
        &[&like_pattern],
    );

    if contacts.is_empty() {
        return Vec::new();
    }

    let contact_usernames: Vec<&str> = contacts
        .iter()
        .filter_map(|c| c.get("username").and_then(|v| v.as_str()))
        .collect();
    let placeholders: String = contact_usernames
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let params: Vec<&dyn rusqlite::types::ToSql> = contact_usernames
        .iter()
        .map(|u| &*u as &dyn rusqlite::types::ToSql)
        .collect();

    let sessions = query_wechat_db_params(
        &session_db,
        session_key,
        &format!(
            "SELECT username, type, unread_count, summary, draft, last_timestamp,
                    sort_timestamp, last_msg_sender, last_sender_display_name, is_hidden,
                    last_msg_locald_id
             FROM SessionTable
             WHERE username IN ({placeholders})
             ORDER BY sort_timestamp DESC;"
        ),
        &params,
    );

    let session_map: HashMap<String, &serde_json::Value> = sessions
        .iter()
        .filter_map(|s| {
            s.get("username")
                .and_then(|v| v.as_str())
                .map(|u| (u.to_string(), s))
        })
        .collect();

    contacts
        .iter()
        .filter_map(|contact| {
            let username = contact.get("username")?.as_str()?;
            let session = session_map.get(username)?;
            let is_group = username.contains("@chatroom");

            let name = contact
                .get("remark")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    contact
                        .get("nick_name")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                })
                .unwrap_or(username)
                .to_string();

            Some(Chat {
                id: username.to_string(),
                username: username.to_string(),
                name,
                remark: contact
                    .get("remark")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
                unread_count: session
                    .get("unread_count")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32,
                is_group,
                small_head_url: small_head_url_from_contact(Some(contact)),
                last_message_preview: session
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
                last_message_sender: session
                    .get("last_sender_display_name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
                last_activity_at: session
                    .get("last_timestamp")
                    .and_then(|v| v.as_i64())
                    .filter(|&t| t > 0)
                    .map(|t| {
                        chrono::DateTime::from_timestamp(t, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    }),
                last_msg_local_id: session.get("last_msg_locald_id").and_then(|v| v.as_i64()),
            })
        })
        .collect()
}
