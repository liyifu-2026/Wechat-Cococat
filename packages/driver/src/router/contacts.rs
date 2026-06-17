use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::context::session_ctx::SessionCtx;
use crate::ia::types::Contact;
use crate::tools::{avatar_proxy, wechat_contacts};

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

pub async fn get_contact(Path(username): Path<String>) -> Json<Option<Contact>> {
    let ctx = match SessionCtx::load().await {
        Ok(c) if c.is_logged_in() => c,
        _ => return Json(None),
    };

    Json(wechat_contacts::get_contact_by_username(
        &ctx.account_dir,
        &ctx.keys,
        &username,
    ))
}

#[derive(Deserialize)]
pub struct AvatarParams {
    url: String,
}

pub async fn proxy_avatar(Query(params): Query<AvatarParams>) -> Response {
    match avatar_proxy::fetch_avatar(&params.url).await {
        Ok((bytes, content_type)) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, content_type)],
            bytes,
        )
            .into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
    }
}
