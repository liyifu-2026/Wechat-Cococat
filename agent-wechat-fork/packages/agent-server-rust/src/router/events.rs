use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
};
use tokio::sync::broadcast;

use crate::events::get_sender;

pub async fn events_ws(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_events_ws)
}

async fn handle_events_ws(mut socket: WebSocket) {
    tracing::info!("[ws/events] Client connected");

    // Send immediate snapshot of current chat state on connect
    send_current_snapshot(&mut socket).await;

    let mut rx = get_sender().subscribe();

    loop {
        let msg = tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(text) => text,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!("[ws/events] Client lagged, skipped {skipped} messages — closing to trigger reconnect + snapshot");
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(_)) => continue,
                    _ => break,
                }
            }
        };

        if socket.send(Message::Text(msg.into())).await.is_err() {
            break;
        }
    }

    tracing::info!("[ws/events] Client disconnected");
}

async fn send_current_snapshot(socket: &mut WebSocket) {
    use crate::db::get_db;
    use crate::sessions::manager::get_session;
    use crate::tools::wechat_chats;
    use crate::tools::wechat_keys::get_stored_keys;

    let session = match get_session("default") {
        Some(s) if s.status == "running" => s,
        _ => return,
    };

    let account_dir = match &session.logged_in_user {
        Some(u) => u.clone(),
        None => return,
    };

    let keys = {
        let db = get_db();
        get_stored_keys(&db, &session.id, &account_dir)
    };

    if !keys.contains_key("session.db") || !keys.contains_key("contact.db") {
        return;
    }

    let chats = wechat_chats::list_chats(&account_dir, &keys, 200, 0);
    let snapshot: Vec<serde_json::Value> = chats
        .iter()
        .map(|c| {
            serde_json::json!({
                "chatId": c.id,
                "name": c.name,
                "unreadCount": c.unread_count,
                "isGroup": c.is_group,
                "lastMsgTime": c.last_activity_at,
            })
        })
        .collect();

    let payload = serde_json::json!({
        "type": "new_messages",
        "chats": snapshot,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    let _ = socket.send(Message::Text(payload.to_string().into())).await;
    tracing::info!("[ws/events] Snapshoted {} chats to new client", chats.len());
}
