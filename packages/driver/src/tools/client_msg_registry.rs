use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use crate::ia::types::Message;
use crate::tools::wechat_messages;

struct PendingSend {
    chat_id: String,
    text: String,
}

struct Registry {
    /// FIFO pending sends keyed by client_msg_id.
    pending: Vec<(String, PendingSend)>,
    /// (chat_id, local_id) -> client_msg_id
    resolved: HashMap<(String, i64), String>,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| {
    Mutex::new(Registry {
        pending: Vec::new(),
        resolved: HashMap::new(),
    })
});

fn normalize_content(text: &str) -> String {
    text.trim().to_string()
}

pub fn register_send(chat_id: &str, client_msg_id: &str, text: &str) {
    let mut reg = REGISTRY.lock().expect("client_msg_registry lock");
    reg.pending.retain(|(id, _)| id != client_msg_id);
    reg.pending.push((
        client_msg_id.to_string(),
        PendingSend {
            chat_id: chat_id.to_string(),
            text: text.to_string(),
        },
    ));
}

pub fn try_resolve_after_send(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
    client_msg_id: &str,
    text: &str,
) {
    register_send(chat_id, client_msg_id, text);
    resolve_pending_for_chat(account_dir, keys, chat_id);
}

pub fn resolve_pending_for_chat(
    account_dir: &str,
    keys: &HashMap<String, String>,
    chat_id: &str,
) {
    let messages = wechat_messages::list_messages(account_dir, keys, chat_id, 20, 0);
    let mut reg = REGISTRY.lock().expect("client_msg_registry lock");

    let mut resolved_ids: HashSet<String> = HashSet::new();
    let pending_snapshot: Vec<(String, PendingSend)> = reg
        .pending
        .iter()
        .filter(|(_, p)| p.chat_id == chat_id)
        .map(|(id, p)| (id.clone(), PendingSend {
            chat_id: p.chat_id.clone(),
            text: p.text.clone(),
        }))
        .collect();

    for (client_msg_id, pending) in pending_snapshot {
        let target = normalize_content(&pending.text);
        if target.is_empty() {
            continue;
        }
        for m in &messages {
            if m.is_self != Some(true) {
                continue;
            }
            if reg
                .resolved
                .contains_key(&(chat_id.to_string(), m.local_id))
            {
                continue;
            }
            if normalize_content(&m.content) == target {
                reg.resolved
                    .insert((chat_id.to_string(), m.local_id), client_msg_id.clone());
                resolved_ids.insert(client_msg_id);
                break;
            }
        }
    }

    if !resolved_ids.is_empty() {
        reg.pending
            .retain(|(id, _)| !resolved_ids.contains(id));
    }
}

pub fn attach_client_msg_ids(chat_id: &str, messages: &mut [Message]) {
    let reg = REGISTRY.lock().expect("client_msg_registry lock");
    for m in messages {
        if let Some(client_msg_id) = reg
            .resolved
            .get(&(chat_id.to_string(), m.local_id))
        {
            m.client_msg_id = Some(client_msg_id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_registry() {
        let mut reg = REGISTRY.lock().expect("client_msg_registry lock");
        reg.pending.clear();
        reg.resolved.clear();
    }

    #[test]
    fn attach_maps_local_id_to_client_msg_id() {
        fresh_registry();
        {
            let mut reg = REGISTRY.lock().expect("client_msg_registry lock");
            reg.resolved
                .insert(("chat-a".to_string(), 42), "client-1".to_string());
        }

        let mut messages = vec![Message {
            local_id: 42,
            server_id: 0,
            chat_id: "chat-a".to_string(),
            sender: None,
            sender_name: None,
            msg_type: 1,
            content: "hello".to_string(),
            timestamp: String::new(),
            is_mentioned: None,
            is_self: Some(true),
            reply: None,
            artifact_ref: None,
            media_kind: None,
            client_msg_id: None,
        }];

        attach_client_msg_ids("chat-a", &mut messages);
        assert_eq!(messages[0].client_msg_id.as_deref(), Some("client-1"));
    }

    #[test]
    fn resolved_ids_do_not_cross_between_client_msg_ids() {
        fresh_registry();
        {
            let mut reg = REGISTRY.lock().expect("client_msg_registry lock");
            reg.resolved.insert(
                ("chat-a".to_string(), 10),
                "client-a".to_string(),
            );
            reg.resolved.insert(
                ("chat-a".to_string(), 11),
                "client-b".to_string(),
            );
        }

        let mut messages = vec![
            Message {
                local_id: 10,
                server_id: 0,
                chat_id: "chat-a".to_string(),
                sender: None,
                sender_name: None,
                msg_type: 1,
                content: "same".to_string(),
                timestamp: String::new(),
                is_mentioned: None,
                is_self: Some(true),
                reply: None,
                artifact_ref: None,
                media_kind: None,
                client_msg_id: None,
            },
            Message {
                local_id: 11,
                server_id: 0,
                chat_id: "chat-a".to_string(),
                sender: None,
                sender_name: None,
                msg_type: 1,
                content: "same".to_string(),
                timestamp: String::new(),
                is_mentioned: None,
                is_self: Some(true),
                reply: None,
                artifact_ref: None,
                media_kind: None,
                client_msg_id: None,
            },
        ];

        attach_client_msg_ids("chat-a", &mut messages);
        assert_eq!(messages[0].client_msg_id.as_deref(), Some("client-a"));
        assert_eq!(messages[1].client_msg_id.as_deref(), Some("client-b"));
    }
}
