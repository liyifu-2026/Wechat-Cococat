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
use crate::tools::wechat_media::get_message_media;
use crate::tools::wechat_artifacts::write_artifact;
use crate::tools::wechat_messages;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

pub async fn list_messages(
    Path(chat_id): Path<String>,
    Query(params): Query<ListParams>,
) -> Json<Vec<Message>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    if !ctx
        .keys
        .keys()
        .any(|k| k.starts_with("message_") && k.ends_with(".db") && !k.contains("fts") && !k.contains("resource"))
    {
        return Json(Vec::new());
    }

    Json(wechat_messages::list_messages(
        &ctx.account_dir,
        &ctx.keys,
        &chat_id,
        params.limit,
        params.offset,
    ))
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

    if crate::execution::rate_limiter::get_rate_limiter()
        .lock()
        .map(|l| l.is_cooling_down())
        .unwrap_or(false)
    {
        return Json(SendResult {
            success: false,
            error: Some(
                "WeChat rate limit cooldown active — try again later".to_string(),
            ),
        });
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
    };
    let cancel = CancellationToken::new();
    let noop_emit = |_: SubscriptionEvent| {};
    let (observer, executor) = production_impls(&ctx.session);

    let (result, _plan_state) =
        run_execution_loop(&plan, &params, &mut context, &observer, &executor, &noop_emit, cancel).await;

    if let Some(p) = &image_path {
        let _ = std::fs::remove_file(p);
    }
    if let Some(p) = &file_path {
        let _ = std::fs::remove_file(p);
    }

    Json(SendResult {
        success: result.success,
        error: result.error,
    })
}
