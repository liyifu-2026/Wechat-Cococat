use std::io::Read;

use serde_json::{json, Value};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, StatusCode};

use super::infra;
use super::projects;
use super::files;
use super::search;
use super::graph;
use super::rescan;
use super::agent_scope;
use super::{API_PREFIX};

pub(super) const MAX_BODY_BYTES: usize = 1024 * 1024;

pub(super) struct ApiResponse {
    pub status: u16,
    pub body: Value,
}

pub(super) fn ok(body: Value) -> ApiResponse {
    ApiResponse { status: 200, body }
}

pub(super) fn err(status: u16, message: impl Into<String>) -> ApiResponse {
    ApiResponse {
        status,
        body: json!({ "ok": false, "error": message.into() }),
    }
}

pub(super) fn process_request(app: AppHandle, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    if method == Method::Options {
        respond_options(request);
        return;
    }

    let headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().to_ascii_lowercase().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect();

    let body = match read_body(&mut request) {
        Ok(body) => body,
        Err(err) => {
            respond_error(request, 400, &err);
            return;
        }
    };

    let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        handle_request(&app, &method, &url, &body, &headers)
    }))
    .unwrap_or_else(|payload| {
        eprintln!("[API Server] request panicked: {payload:?}");
        err(500, "Internal API server error")
    });
    respond_json(request, response.status, response.body);
}

pub(super) fn handle_request(
    app: &AppHandle,
    method: &Method,
    url: &str,
    body: &str,
    headers: &[(String, String)],
) -> ApiResponse {
    let (path, query) = infra::split_url(url);
    if path == "/health" || path == format!("{API_PREFIX}/health") {
        return ok(json!({
            "ok": true,
            "status": super::get_api_status(),
            "version": env!("CARGO_PKG_VERSION"),
            "authRequired": infra::api_auth_required(app),
            "authConfigured": infra::api_token(app).is_some(),
            "tokenSource": infra::api_token_source(app),
            "enabled": infra::api_enabled(app),
            "allowUnauthenticated": infra::api_allow_unauthenticated(app),
        }));
    }
    if !path.starts_with(API_PREFIX) {
        return err(404, "Not found");
    }
    if !infra::api_enabled(app) {
        return err(503, "API server is disabled in Settings → API Server");
    }
    if !infra::is_authorized(app, query, headers) {
        return err(401, "Unauthorized");
    }
    if !matches!(method, &Method::Get | &Method::Post) {
        return err(405, "Method not allowed");
    }

    let parts: Vec<&str> = path
        .trim_start_matches(API_PREFIX)
        .trim_start_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();

    match (method, parts.as_slice()) {
        (&Method::Get, ["projects"]) => projects::handle_projects(app),
        (&Method::Get, ["projects", project_id, "files"]) => files::handle_files(app, project_id, query),
        (&Method::Get, ["projects", project_id, "files", "content"]) => {
            files::handle_file_content(app, project_id, query)
        }
        (&Method::Post, ["projects", project_id, "search"]) => search::handle_search(app, project_id, body),
        (&Method::Get, ["projects", project_id, "graph"]) => graph::handle_graph(app, project_id, query),
        (&Method::Post, ["projects", project_id, "sources", "rescan"]) => {
            rescan::handle_rescan(app, project_id)
        }
        (&Method::Get, ["projects", project_id, "agent-scope"]) => {
            agent_scope::handle_agent_scope(app, project_id)
        }
        _ => err(404, "Not found"),
    }
}

pub(super) fn should_rate_limit(method: &Method, url: &str) -> bool {
    if method == &Method::Options {
        return false;
    }
    let (path, _) = infra::split_url(url);
    !(path == "/health" || path == format!("{API_PREFIX}/health"))
}

fn read_body(request: &mut tiny_http::Request) -> Result<String, String> {
    let mut limited = request.as_reader().take(MAX_BODY_BYTES as u64 + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read body: {e}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("Request body too large".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "Request body must be UTF-8".to_string())
}

pub(super) fn respond_error(request: tiny_http::Request, status: u16, message: &str) {
    respond_json(request, status, json!({ "ok": false, "error": message }));
}

fn respond_options(request: tiny_http::Request) {
    let mut response = Response::empty(StatusCode(204));
    for header in cors_headers() {
        response.add_header(header);
    }
    response.add_header(Header::from_bytes("Access-Control-Max-Age", "600").unwrap());
    let _ = request.respond(response);
}

pub(super) fn respond_json(request: tiny_http::Request, status: u16, body: Value) {
    let mut response = Response::from_string(body.to_string()).with_status_code(StatusCode(status));
    for header in cors_headers() {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
        Header::from_bytes(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-LLM-Wiki-Token",
        )
        .unwrap(),
        Header::from_bytes("Content-Type", "application/json").unwrap(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_skips_health_and_options_only() {
        assert!(!should_rate_limit(&Method::Get, "/api/v1/health"));
        assert!(!should_rate_limit(&Method::Options, "/api/v1/projects"));
        assert!(should_rate_limit(&Method::Get, "/wp-login"));
        assert!(should_rate_limit(
            &Method::Post,
            "/api/v1/projects/current/search"
        ));
    }
}
