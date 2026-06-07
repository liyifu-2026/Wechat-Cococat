use axum::{extract::{Path, Query}, Json};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use crate::context::create_context;
use crate::context::session_ctx::SessionCtx;
use crate::db::get_db;
use crate::execution::run_execution_loop;
use crate::execution::sys_impl::production_impls;
use crate::ia::types::{Chat, SubscriptionEvent};
use crate::plans::chat_open::{ChatOpenParams, ChatOpenPlan};
use crate::tools::wechat_chats;

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

pub async fn list_chats(Query(params): Query<ListParams>) -> Json<Vec<Chat>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    Json(wechat_chats::list_chats(
        &ctx.account_dir,
        &ctx.keys,
        params.limit,
        params.offset,
    ))
}

pub async fn get_chat(Path(id): Path<String>) -> Json<Option<Chat>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(None),
    };

    Json(wechat_chats::get_chat_by_username(
        &ctx.account_dir,
        &ctx.keys,
        &id,
    ))
}

#[derive(Deserialize)]
pub struct FindParams {
    name: String,
}

pub async fn find_chats(Query(params): Query<FindParams>) -> Json<Vec<Chat>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    Json(wechat_chats::find_chats_by_name(
        &ctx.account_dir,
        &ctx.keys,
        &params.name,
    ))
}

#[derive(Deserialize)]
pub struct OpenChatParams {
    #[serde(default, rename = "clearUnreads")]
    clear_unreads: bool,
}

pub async fn open_chat(
    Path(chat_id): Path<String>,
    Query(params): Query<OpenChatParams>,
) -> Json<serde_json::Value> {
    let clear_unreads = params.clear_unreads;
    let ctx = match SessionCtx::load().await {
        Ok(c) => c,
        Err(e) => {
            return Json(serde_json::json!({"ok": false, "error": e}));
        }
    };

    if chat_id.starts_with("gh_") {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Opening official accounts is not supported"
        }));
    }

    let mut context = {
        let db = get_db();
        create_context(ctx.session.clone(), &db)
    };

    let plan = ChatOpenPlan;
    let params = ChatOpenParams { chat_id, clear_unreads };
    let cancel = CancellationToken::new();
    let noop_emit = |_: SubscriptionEvent| {};
    let (observer, executor) = production_impls(&ctx.session);

    let (result, plan_state) =
        run_execution_loop(&plan, &params, &mut context, &observer, &executor, &noop_emit, cancel).await;

    if result.success {
        if let Some(open_result) = plan_state.result {
            Json(serde_json::to_value(open_result).unwrap_or_else(|_| serde_json::json!({"ok": true})))
        } else {
            Json(serde_json::json!({ "ok": true }))
        }
    } else {
        Json(serde_json::json!({
            "ok": false,
            "error": result.error.unwrap_or_else(|| "Chat open failed".to_string())
        }))
    }
}
