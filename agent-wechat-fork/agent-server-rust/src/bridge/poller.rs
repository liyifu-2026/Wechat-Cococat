use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::agent::agent_loop::AgentLoop;
use crate::tools::wechat_chats;
use crate::agent::tools::ToolContext;

use super::chat_processor::process_chat;
use super::message_utils::poll_should_process;
use super::scheduler::ChatScheduler;
use super::{BridgeState, ProcessChatResult, POLL_INTERVAL_SECS};

pub(super) async fn run_poller(
    agent: Arc<AgentLoop>,
    state: Arc<Mutex<BridgeState>>,
    scheduler: Arc<ChatScheduler>,
) {
    let mut prev_unread: HashMap<String, i32> = HashMap::new();
    tracing::debug!("[poll] Polling fallback started");
    loop {
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        tracing::debug!("[poll] Checking unread counts...");

        let ctx = ToolContext::load_async().await;
        if !ctx.is_logged_in() {
            continue;
        }
        let dir = match ctx.account_dir() {
            Some(d) => d.to_string(),
            None => continue,
        };

        let chats = wechat_chats::list_chats(&dir, &ctx.keys, 200, 0);
        for chat in &chats {
            let current = chat.unread_count;
            let prev = prev_unread.get(&chat.id).copied().unwrap_or(0);
            if poll_should_process(current, prev) {
                tracing::info!(
                    "[poll] Queueing {} (unread={current}, prev={prev})",
                    chat.name
                );
                let agent = agent.clone();
                let state = state.clone();
                let scheduler = scheduler.clone();
                let chat_id = chat.id.clone();
                let chat_name = chat.name.clone();
                let is_group = chat.is_group;
                tokio::spawn(async move {
                    match process_chat(&agent, &state, &chat_id, &chat_name, is_group).await {
                        Ok(ProcessChatResult::Ok) => {}
                        Ok(ProcessChatResult::Busy) => {
                            scheduler
                                .schedule_retry(chat_id, chat_name, is_group)
                                .await;
                        }
                        Err(e) => tracing::error!("Poll chat {chat_name}: {e}"),
                    }
                });
            }
            prev_unread.insert(chat.id.clone(), current);
        }
        let active: std::collections::HashSet<String> =
            chats.iter().map(|c| c.id.clone()).collect();
        prev_unread.retain(|id, _| active.contains(id));
    }
}
