use std::collections::HashMap;

use crate::agent::llm::{
    build_assistant_message, build_user_message, ChatMessage, ContentBlock,
};

use super::{text_utils, HISTORY_KEEP_RECENT, MAX_CHAT_HISTORIES};

pub(super) async fn compact_history(
    agent: &crate::agent::agent_loop::AgentLoop,
    old: &[ChatMessage],
    chat_name: &str,
) -> Vec<ChatMessage> {
    let recent = &old[old.len().saturating_sub(HISTORY_KEEP_RECENT)..];
    let old_part = &old[..old.len().saturating_sub(HISTORY_KEEP_RECENT)];

    let conversation: String = old_part
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| {
            let text = match &m.content {
                Some(ContentBlock::Text(t)) => text_utils::truncate_to_char_boundary(t, 200),
                _ => "",
            };
            let role = if m.role == "user" { chat_name } else { "You" };
            format!("{role}: {text}")
        })
        .collect::<Vec<_>>()
        .join("\n");

    if conversation.is_empty() {
        return recent.to_vec();
    }

    let summary_prompt = format!(
        "Summarize this conversation in 3-5 short bullet points. Focus on key topics, decisions, and ongoing matters.\n\n{conversation}"
    );

    match agent.complete_plain(&summary_prompt).await {
        Ok(summary) => {
            let mut result = vec![
                build_user_message(&format!(
                    "[Earlier conversation summary]\n{summary}"
                )),
                build_assistant_message("Got it, I'll keep this context in mind."),
            ];
            result.extend_from_slice(recent);
            result
        }
        Err(e) => {
            tracing::warn!("History compaction failed, using local text fallback: {e}");
            let mut result = vec![
                build_user_message(&format!(
                    "[Earlier conversation summary]\n{}",
                    fallback_history_summary(old_part, chat_name)
                )),
                build_assistant_message("Got it, I'll keep this context in mind."),
            ];
            result.extend_from_slice(recent);
            result
        }
    }
}

fn fallback_history_summary(old: &[ChatMessage], chat_name: &str) -> String {
    let mut lines = old
        .iter()
        .rev()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .filter_map(|m| {
            let text = match &m.content {
                Some(ContentBlock::Text(t)) if !t.trim().is_empty() => {
                    text_utils::truncate_to_char_boundary(t.trim(), 240)
                }
                _ => return None,
            };
            let role = if m.role == "user" { chat_name } else { "You" };
            Some(format!("{role}: {text}"))
        })
        .take(20)
        .collect::<Vec<_>>();
    lines.reverse();

    if lines.is_empty() {
        "Earlier messages were present but could not be summarized.".to_string()
    } else {
        lines.join("\n")
    }
}

pub(super) fn prune_chat_histories(
    histories: &mut HashMap<String, Vec<ChatMessage>>,
    current_chat_id: &str,
) {
    while histories.len() > MAX_CHAT_HISTORIES {
        let stale = histories
            .keys()
            .find(|chat_id| chat_id.as_str() != current_chat_id)
            .cloned();
        match stale {
            Some(chat_id) => {
                histories.remove(&chat_id);
            }
            None => break,
        }
    }
}
