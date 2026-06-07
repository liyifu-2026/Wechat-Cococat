use axum::{extract::Query, Json};
use serde::Deserialize;

use crate::context::session_ctx::SessionCtx;
use crate::ia::types::Contact;
use crate::tools::wechat_contacts;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    200
}

pub async fn list_contacts(Query(params): Query<ListParams>) -> Json<Vec<Contact>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    Json(wechat_contacts::list_contacts(
        &ctx.account_dir,
        &ctx.keys,
        params.limit,
        params.offset,
    ))
}

#[derive(Deserialize)]
pub struct FindParams {
    name: String,
}

pub async fn find_contacts(Query(params): Query<FindParams>) -> Json<Vec<Contact>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(Vec::new()),
    };

    Json(wechat_contacts::find_contacts(
        &ctx.account_dir,
        &ctx.keys,
        &params.name,
    ))
}
