use axum::{
    extract::{Path, Query},
    Json,
};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use crate::context::create_context;
use crate::context::session_ctx::SessionCtx;
use crate::db::get_db;
use crate::execution::run_execution_loop;
use crate::execution::sys_impl::production_impls;
use crate::ia::types::{MediaResult, Message, SendResult, SubscriptionEvent};
use crate::plans::send_message::{SendMessageParams, SendMessagePlan};
use crate::plans::Plan;
use crate::tools::client_msg_registry;
use crate::tools::wechat_artifacts::write_artifact;
use crate::tools::wechat_media::get_message_media;
use crate::tools::wechat_messages;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default)]
    before_time: Option<i64>,
    #[serde(default)]
    after_time: Option<i64>,
}

fn default_limit() -> i64 {
    50
}

fn annotate_messages(ctx: &SessionCtx, chat_id: &str, messages: &mut Vec<Message>) {
    client_msg_registry::resolve_pending_for_chat(&ctx.account_dir, &ctx.keys, chat_id);
    client_msg_registry::attach_client_msg_ids(chat_id, messages);
}

pub async fn list_messages(
    Path(chat_id): Path<String>,
    Query(params): Query<ListParams>,
) -> Json<Vec<Message>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    if !ctx.keys.keys().any(|k| {
        k.starts_with("message_")
            && k.ends_with(".db")
            && !k.contains("fts")
            && !k.contains("resource")
    }) {
        return Json(Vec::new());
    }

    let mut messages = if let Some(before) = params.before_time {
        wechat_messages::list_messages_before_time(
            &ctx.account_dir,
            &ctx.keys,
            &chat_id,
            before,
            params.limit,
        )
    } else if let Some(after) = params.after_time {
        wechat_messages::list_messages_after_time(
            &ctx.account_dir,
            &ctx.keys,
            &chat_id,
            after,
            params.limit,
        )
    } else {
        wechat_messages::list_messages(
            &ctx.account_dir,
            &ctx.keys,
            &chat_id,
            params.limit,
            params.offset,
        )
    };
    annotate_messages(&ctx, &chat_id, &mut messages);
    Json(messages)
}

#[derive(Deserialize)]
pub struct AroundParams {
    #[serde(default = "default_limit")]
    limit: i64,
}

pub async fn list_messages_around(
    Path((chat_id, local_id)): Path<(String, i64)>,
    Query(params): Query<AroundParams>,
) -> Json<Vec<Message>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    if !ctx.keys.keys().any(|k| {
        k.starts_with("message_")
            && k.ends_with(".db")
            && !k.contains("fts")
            && !k.contains("resource")
    }) {
        return Json(Vec::new());
    }

    let mut messages = wechat_messages::list_messages_around(
        &ctx.account_dir,
        &ctx.keys,
        &chat_id,
        local_id,
        params.limit,
    );
    annotate_messages(&ctx, &chat_id, &mut messages);
    Json(messages)
}

pub async fn get_media(Path((chat_id, local_id)): Path<(String, i64)>) -> Json<MediaResult> {
    let empty = MediaResult {
        media_type: "unsupported".to_string(),
        data: None,
        url: None,
        format: String::new(),
        filename: String::new(),
        artifact_ref: None,
    };

    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(empty),
    };

    let mut result = get_message_media(
        &ctx.account_dir,
        &ctx.keys,
        &chat_id,
        local_id,
        ctx.image_keys,
    );
    if let Some(artifact_ref) = write_artifact(&chat_id, local_id, &result) {
        result.artifact_ref = Some(artifact_ref);
    }
    Json(result)
}

#[derive(Deserialize)]
pub struct SendParams {
    #[serde(rename = "chatId")]
    chat_id: String,
    text: Option<String>,
    image: Option<ImageInput>,
    file: Option<FileInput>,
    #[serde(default)]
    mentions: Vec<String>,
    #[serde(rename = "clientMsgId")]
    client_msg_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ImageInput {
    data: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
}

#[derive(Deserialize)]
pub struct FileInput {
    data: String,
    filename: String,
}

pub async fn send_message(Json(input): Json<SendParams>) -> Json<SendResult> {
    if input.text.is_none() && input.image.is_none() && input.file.is_none() {
        return Json(SendResult {
            success: false,
            error: Some("No text, image, or file provided".to_string()),
        });
    }

    if let Ok(mut limiter) = crate::execution::rate_limiter::get_rate_limiter().lock() {
        if let Err(error) = limiter.check_outbound_allowed(&input.chat_id) {
            return Json(SendResult {
                success: false,
                error: Some(error),
            });
        }
    }

    let ctx = match SessionCtx::load().await {
        Ok(c) => c,
        Err(e) => {
            return Json(SendResult {
                success: false,
                error: Some(e),
            });
        }
    };

    let mut image_path: Option<String> = None;
    let mut image_mime: Option<String> = None;
    if let Some(ref img) = input.image {
        let ext = match img.mime_type.as_str() {
            "image/jpeg" => ".jpg",
            "image/gif" => ".gif",
            _ => ".png",
        };
        let path = format!(
            "/tmp/send_image_{}{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            ext
        );
        if let Ok(bytes) =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &img.data)
        {
            if std::fs::write(&path, &bytes).is_ok() {
                image_mime = Some(img.mime_type.clone());
                image_path = Some(path);
            }
        }
    }

    let mut file_path: Option<String> = None;
    if let Some(ref f) = input.file {
        let safe_name: String = f
            .filename
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let path = format!(
            "/tmp/send_file_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            safe_name
        );
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &f.data) {
            Ok(bytes) => match std::fs::write(&path, &bytes) {
                Ok(_) => {
                    file_path = Some(path);
                }
                Err(e) => {
                    return Json(SendResult {
                        success: false,
                        error: Some(format!("Failed to write temp file: {e}")),
                    });
                }
            },
            Err(e) => {
                return Json(SendResult {
                    success: false,
                    error: Some(format!("Failed to decode base64 file data: {e}")),
                });
            }
        }
    }

    let chat_id = input.chat_id.clone();
    let send_text = input.text.clone();
    let client_msg_id = input.client_msg_id.clone();

    if let (Some(ref id), Some(ref text)) = (&client_msg_id, &send_text) {
        if !text.trim().is_empty() {
            client_msg_registry::register_send(&chat_id, id, text);
        }
    }

    let mut context = {
        let db = get_db();
        create_context(ctx.session.clone(), &db)
    };

    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: input.chat_id,
        message: input.text,
        image_path: image_path.clone(),
        image_mime,
        file_path: file_path.clone(),
        mentions: input.mentions,
        session: Some(ctx.session.clone()),
    };
    let cancel = CancellationToken::new();
    let cancel_for_timeout = cancel.clone();
    let noop_emit = |_: SubscriptionEvent| {};
    let (observer, executor) = production_impls(&ctx.session);

    let execution = run_execution_loop(
        &plan,
        &params,
        &mut context,
        &observer,
        &executor,
        &noop_emit,
        cancel,
    );
    let (result, _plan_state) =
        match tokio::time::timeout(std::time::Duration::from_secs(55), execution).await {
            Ok(outcome) => outcome,
            Err(_) => {
                cancel_for_timeout.cancel();
                (
                    crate::execution::ExecutionResult {
                        success: false,
                        error: Some("sendMessage timed out after 55s".to_string()),
                    },
                    plan.initial_plan_state(),
                )
            }
        };

    if let Some(p) = &image_path {
        let _ = std::fs::remove_file(p);
    }
    if let Some(p) = &file_path {
        let _ = std::fs::remove_file(p);
    }

    if result.success {
        if let Ok(mut limiter) = crate::execution::rate_limiter::get_rate_limiter().lock() {
            limiter.record_outbound_success(&chat_id);
        }
        if let (Some(ref id), Some(ref text)) = (&client_msg_id, &send_text) {
            if !text.trim().is_empty() {
                client_msg_registry::try_resolve_after_send(
                    &ctx.account_dir,
                    &ctx.keys,
                    &chat_id,
                    id,
                    text,
                );
            }
        }
        crate::events::emit_chat_changed(&chat_id);
    }

    Json(SendResult {
        success: result.success,
        error: humanize_send_error(result.error),
    })
}

fn humanize_send_error(raw: Option<String>) -> Option<String> {
    match raw.as_deref() {
        Some("No action selected") => Some(
            "无法在桌面微信执行发送：请确认微信窗口在「聊天」页、目标会话可打开，且底部有输入框（可在 Console 系统·微信连接查看界面）".to_string(),
        ),
        other => other.map(String::from),
    }
}
