use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::agent::agent_loop::AgentLoop;

use super::chat_processor::process_chat;
use super::scheduler::ChatScheduler;
use super::{BridgeState, ProcessChatResult};

pub(super) async fn run_coordinator(
    agent: Arc<AgentLoop>,
    state: Arc<Mutex<BridgeState>>,
    scheduler: Arc<ChatScheduler>,
    mut rx: tokio::sync::broadcast::Receiver<String>,
) {
    let idle_deadline = tokio::time::Instant::now() + Duration::from_secs(365 * 86400);
    let mut debounce_sleep: Pin<Box<tokio::time::Sleep>> =
        Box::pin(tokio::time::sleep_until(idle_deadline));

    loop {
        let deadline = scheduler.next_deadline(idle_deadline).await;
        debounce_sleep.as_mut().reset(deadline);

        tokio::select! {
            () = scheduler.notified() => {}
            event = rx.recv() => {
                let event = match event {
                    Ok(text) => text,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Bridge event lagged by {n}, skipping");
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };

                let payload: serde_json::Value = match serde_json::from_str(&event) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if payload["type"].as_str() != Some("new_messages") {
                    continue;
                }

                let chats = match payload["chats"].as_array() {
                    Some(c) => c.clone(),
                    None => continue,
                };

                for chat_info in chats {
                    let chat_id = chat_info["chatId"].as_str().unwrap_or("").to_string();
                    if chat_id.is_empty() {
                        continue;
                    }
                    scheduler.schedule_debounce(
                        chat_id,
                        chat_info["name"].as_str().unwrap_or("").to_string(),
                        chat_info["isGroup"].as_bool().unwrap_or(false),
                    ).await;
                }
            }
            _ = debounce_sleep.as_mut() => {
                let due = scheduler.drain_due().await;
                for (chat_id, chat_name, is_group) in due {
                    match process_chat(
                        &agent,
                        &state,
                        &chat_id,
                        &chat_name,
                        is_group,
                    ).await {
                        Ok(ProcessChatResult::Ok) => {}
                        Ok(ProcessChatResult::Busy) => {
                            scheduler.schedule_retry(
                                chat_id,
                                chat_name,
                                is_group,
                            ).await;
                        }
                        Err(e) => tracing::error!("Process chat {chat_name}: {e}"),
                    }
                }
            }
        }
    }
}
