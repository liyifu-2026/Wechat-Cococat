use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::agent::agent_loop::AgentLoop;
use crate::agent::history::HistoryStore;
use crate::agent::llm::{
    build_assistant_message, build_user_message,
};
use crate::agent::tools::{send_wechat_message, ToolContext};
use crate::db::get_db;
use crate::execution::rate_limiter::get_rate_limiter;
use crate::sessions::manager::get_session;
use crate::tools::wechat_chats;
use crate::tools::wechat_keys::{get_image_keys, get_stored_keys};
use crate::tools::wechat_media::get_message_media;
use crate::tools::wechat_messages;

use super::config::GroupPolicy;
use super::group_buffer::{clear_buffer, drain_buffer, push_buffer};
use super::media::{
    describe_video, is_file_msg, is_image_msg, is_voice_msg, is_video_msg,
    transcribe_voice,
};
use super::mention_names;
use super::message_utils::{bridge_message_id, is_safety_rejection};
use super::history::{compact_history, prune_chat_histories};
use super::policy::{resolve_reply_mentions, should_skip_group_message, MentionSegment};
use super::text_utils::{smart_truncate, split_reply, truncate_to_char_boundary};
use super::{BridgeState, ProcessChatResult, HISTORY_COMPRESS_AT, KEEP_SEEN_MESSAGES,
            MAX_SEEN_MESSAGES, PROCESS_RETRY_SECS};

pub(super) async fn process_chat(
    agent: &Arc<AgentLoop>,
    state: &Arc<Mutex<BridgeState>>,
    chat_id: &str,
    chat_name: &str,
    is_group: bool,
) -> Result<ProcessChatResult, String> {
    if get_rate_limiter().lock().unwrap().is_cooling_down() {
        tracing::info!(
            "Chat {chat_name}: rate limiter active - deferring"
        );
        return Ok(ProcessChatResult::Busy);
    }

    {
        let mut s = state.lock().await;
        if !s.processing_chats.insert(chat_id.to_string()) {
            tracing::debug!(
                "Chat {chat_name} already in progress - retry in {PROCESS_RETRY_SECS}s"
            );
            return Ok(ProcessChatResult::Busy);
        }
    }

    let result = process_chat_inner(agent.as_ref(), state, chat_id, chat_name, is_group).await;

    {
        let mut s = state.lock().await;
        s.processing_chats.remove(chat_id);
    }

    match result {
        Ok(true) => Ok(ProcessChatResult::Ok),
        Ok(false) => Ok(ProcessChatResult::Busy),
        Err(e) => Err(e),
    }
}

fn msg_to_unseen_json(msg: &crate::ia::types::Message) -> serde_json::Value {
    serde_json::json!({
        "content": msg.content,
        "rawContent": msg.content,
        "sender": msg.sender,
        "senderName": msg.sender_name,
        "mentionDisplayName": msg.sender_name,
        "localId": msg.local_id,
        "serverId": msg.server_id,
        "type": msg.msg_type,
        "timestamp": msg.timestamp,
        "isSelf": msg.is_self,
        "isMentioned": msg.is_mentioned.unwrap_or(false),
    })
}

fn mark_unseen_seen(s: &mut BridgeState, chat_id: &str, unseen: &[serde_json::Value]) {
    for msg in unseen {
        let msg_id = bridge_message_id(
            chat_id,
            msg["localId"].as_i64(),
            msg["serverId"].as_i64(),
            msg["timestamp"].as_str(),
            msg["content"].as_str(),
            msg["sender"]
                .as_str()
                .or(msg["senderName"].as_str()),
            None,
        );
        s.seen_messages.insert(msg_id.clone());
        HistoryStore.save_seen_message(&msg_id);
    }
}

fn build_reply_mentions(
    is_group: bool,
    unseen: &[serde_json::Value],
    policy: &GroupPolicy,
) -> Option<Vec<String>> {
    if !is_group {
        return None;
    }

    let segments: Vec<MentionSegment> = unseen
        .iter()
        .filter_map(|m| {
            Some(MentionSegment {
                sender_name: m["senderName"].as_str()?.to_string(),
                is_mentioned: m["isMentioned"].as_bool().unwrap_or(false),
            })
        })
        .collect();

    let policy_names = resolve_reply_mentions(&segments, policy)?;
    let mut resolved = Vec::new();
    for name in policy_names {
        let msg = match unseen
            .iter()
            .rev()
            .find(|m| m["senderName"].as_str() == Some(name.as_str()))
        {
            Some(m) => m,
            None => continue,
        };
        resolved.extend(mention_names::resolve_for_reply(
            msg["senderName"].as_str().or(msg["sender"].as_str()),
            msg["rawContent"]
                .as_str()
                .or(msg["content"].as_str()),
            msg["mentionDisplayName"].as_str(),
        ));
    }
    if resolved.is_empty() {
        None
    } else {
        Some(resolved)
    }
}

async fn process_chat_inner(
    agent: &AgentLoop,
    state: &Arc<Mutex<BridgeState>>,
    chat_id: &str,
    chat_name: &str,
    is_group: bool,
) -> Result<bool, String> {
    let is_group = is_group || chat_id.contains("@chatroom");
    let ctx = ToolContext::load_async().await;
    if !ctx.is_logged_in() {
        return Ok(true);
    }

    let dir = ctx.account_dir().ok_or("Not logged in")?.to_string();
    let keys = ctx.keys.clone();
    let msgs = wechat_messages::list_messages(&dir, &keys, chat_id, 50, 0);

    drop(ctx);

    let mut unseen: Vec<serde_json::Value> = Vec::new();
    let (group_policy, history_limit) = {
        let s = state.lock().await;
        (
            s.bridge_config.policy_for(chat_id),
            s.bridge_config.group_history_limit,
        )
    };

    {
        let s = state.lock().await;
        for (idx, msg) in msgs.iter().rev().enumerate() {
            let msg_id = bridge_message_id(
                chat_id,
                Some(msg.local_id),
                Some(msg.server_id),
                Some(&msg.timestamp),
                Some(&msg.content),
                msg.sender.as_deref(),
                Some(idx),
            );
            if s.seen_messages.contains(&msg_id) {
                continue;
            }
            if msg.is_self.unwrap_or(false) {
                continue;
            }
            unseen.push(msg_to_unseen_json(msg));
        }
    }

    if unseen.is_empty() {
        let session_last = wechat_chats::get_chat_by_username(&dir, &keys, chat_id)
            .and_then(|c| c.last_msg_local_id);
        let fetched_max = msgs.iter().map(|m| m.local_id).max().unwrap_or(0);
        if !msgs.is_empty() && session_last.is_some_and(|lid| lid > fetched_max) {
            tracing::info!(
                "{chat_name}: message db not synced yet (session last={session_last:?}, fetched max={fetched_max}) - retry"
            );
            return Ok(false);
        }
        tracing::info!(
            "{chat_name}: no unseen messages (fetched max={fetched_max}, session last={session_last:?}, msgs={})",
            msgs.len()
        );
        return Ok(true);
    }

    let was_mentioned = unseen
        .iter()
        .any(|m| m["isMentioned"].as_bool().unwrap_or(false));

    if is_group {
        let mut s = state.lock().await;
        if should_skip_group_message(group_policy.require_mention, was_mentioned) {
            tracing::info!(
                "{chat_name}: buffered {} group message(s) (mention required, no @)",
                unseen.len()
            );
            mark_unseen_seen(&mut s, chat_id, &unseen);
            push_buffer(
                &mut s.group_buffers,
                chat_id,
                unseen,
                history_limit,
            );
            return Ok(true);
        }

        if was_mentioned {
            let mut buffered = drain_buffer(&mut s.group_buffers, chat_id);
            if !buffered.is_empty() {
                for msg in &mut buffered {
                    if let Some(obj) = msg.as_object_mut() {
                        obj.insert("isMentioned".into(), serde_json::Value::Bool(true));
                    }
                }
                tracing::info!(
                    "{chat_name}: injected {} buffered message(s) as group context",
                    buffered.len()
                );
                buffered.extend(unseen);
                unseen = buffered;
            }
        } else if !group_policy.require_mention {
            clear_buffer(&mut s.group_buffers, chat_id);
        }
    }

    let mut batch_lines: Vec<String> = Vec::new();
    let mut image_data: Option<String> = None;

    for msg in &unseen {
        let sender = msg["sender"]
            .as_str()
            .or(msg["senderName"].as_str())
            .unwrap_or("Unknown");
        let mut content = msg["content"].as_str().unwrap_or("").to_string();
        let local_id = msg["localId"].as_i64();
        let msg_type = msg["type"].as_i64().unwrap_or(0) as i32;

        if is_image_msg(msg_type) && local_id.is_some() {
            if let Ok(media) = download_media(chat_id, local_id.unwrap()).await {
                image_data = Some(media.clone());
                content = "[sent an image]".into();
                tracing::info!("Image from {sender}");
            }
        } else if is_voice_msg(msg_type) && local_id.is_some() {
            if let Ok(media) = download_media(chat_id, local_id.unwrap()).await {
                let api_key = {
                    let s = state.lock().await;
                    s.llm_api_key.clone()
                };
                match transcribe_voice(&media, &api_key).await {
                    Ok(transcript) => {
                        content = transcript;
                        tracing::debug!("Voice transcribed: {}", truncate_to_char_boundary(&content, 50));
                    }
                    Err(e) => {
                        content = "[voice message]".into();
                        tracing::warn!("Voice transcription failed: {e}");
                    }
                }
            }
        } else if is_video_msg(msg_type) && local_id.is_some() {
            if let Ok(media) = download_media(chat_id, local_id.unwrap()).await {
                let bytes = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    &media,
                )
                .unwrap_or_default();
                let is_jpeg = bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] == 0xD8;
                if is_jpeg {
                    content = "[sent a video]".into();
                    image_data = Some(media);
                } else {
                    let api_key = {
                        let s = state.lock().await;
                        s.llm_api_key.clone()
                    };
                    match describe_video(&media, &api_key).await {
                        Ok(desc) => content = desc,
                        Err(_) => content = "[sent a video]".into(),
                    }
                }
            }
        } else if is_file_msg(msg_type) && local_id.is_some() {
            content = format!("[sent a file: {}]", content);
        }

        let prefix = if is_group || sender != chat_name {
            format!("{}: ", sender)
        } else {
            String::new()
        };
        batch_lines.push(format!("{prefix}{content}"));
    }

    let header = format!(
        "[Chat: {} | {}{}]",
        chat_id,
        chat_name,
        if is_group { " [group]" } else { "" }
    );
    let prompt = format!("{}\n{}", header, batch_lines.join("\n"));

    tracing::info!("{} <- {} messages", chat_name, unseen.len());

    let mut history = {
        let mut s = state.lock().await;
        let mut h = s
            .chat_histories
            .get(chat_id)
            .cloned()
            .unwrap_or_default();
        if h.is_empty() {
            h = HistoryStore.load_history(chat_id);
            if !h.is_empty() {
                s.chat_histories.insert(chat_id.to_string(), h.clone());
            }
        }
        h
    };

    if history.len() > HISTORY_COMPRESS_AT {
        history = compact_history(agent, &history, chat_name).await;
    }

    let reply = match tokio::time::timeout(
        Duration::from_secs(120),
        agent.process(&prompt, &history, image_data.as_deref()),
    )
    .await
    {
        Ok(Ok(text)) => {
            if is_safety_rejection(&text) {
                tracing::warn!("LLM safety rejection suppressed");
                None
            } else {
                Some(text)
            }
        }
        Ok(Err(e)) => {
            tracing::error!("Agent error: {e}");
            None
        }
        Err(_) => {
            tracing::error!("Agent timeout for {chat_name}");
            None
        }
    };

    let reply_mentions = build_reply_mentions(is_group, &unseen, &group_policy);

    if let Some(ref names) = reply_mentions {
        tracing::info!("{chat_name}: reply mentions: {names:?}");
    } else if is_group {
        tracing::info!(
            "{chat_name}: no reply mentions (policy={:?}, unseen={})",
            group_policy.reply_with_mention,
            unseen.len()
        );
    }

    if let Some(text) = reply {
        let parts = split_reply(&text);
        let send_ctx = ToolContext::load_async().await;
        let mut all_sent = true;
        for part in parts {
            let body = if let Some(ref names) = reply_mentions {
                mention_names::strip_leading_at_mentions(&part, names)
            } else {
                part.clone()
            };
            let truncated = smart_truncate(&body, 200);
            if let Err(e) = send_wechat_message(
                &send_ctx,
                chat_id,
                Some(&truncated),
                None,
                "",
                None,
                None,
                reply_mentions.as_deref(),
            )
            .await
            {
                tracing::error!("Send error: {e}");
                all_sent = false;
                break;
            } else {
                tracing::info!("Sent: {}", truncate_to_char_boundary(&truncated, 60));
            }
        }

        if all_sent {
            let mut s = state.lock().await;
            mark_unseen_seen(&mut s, chat_id, &unseen);
            if is_group && !group_policy.require_mention {
                clear_buffer(&mut s.group_buffers, chat_id);
            }
            if s.seen_messages.len() > MAX_SEEN_MESSAGES {
                HistoryStore.clear_seen_messages(KEEP_SEEN_MESSAGES);
                s.seen_messages = HistoryStore.load_seen_messages();
            }
            let mut updated_history = history.clone();
            updated_history.push(build_user_message(&prompt));
            updated_history.push(build_assistant_message(&text));
            s.chat_histories
                .insert(chat_id.to_string(), updated_history.clone());
            prune_chat_histories(&mut s.chat_histories, chat_id);
            HistoryStore.save_history(chat_id, &updated_history);
        }
    }
    Ok(true)
}

async fn download_media(chat_id: &str, local_id: i64) -> Result<String, String> {
    let session = get_session("default").ok_or("No session")?;
    let logged_in_user = session
        .logged_in_user
        .as_ref()
        .ok_or("Not logged in")?;
    let keys = {
        let db = get_db();
        get_stored_keys(&db, &session.id, logged_in_user)
    };
    let image_keys = {
        let db = get_db();
        get_image_keys(&db, &session.id, logged_in_user)
    };

    let media = get_message_media(logged_in_user, &keys, chat_id, local_id, image_keys);
    media.data.ok_or_else(|| "No media data".into())
}
