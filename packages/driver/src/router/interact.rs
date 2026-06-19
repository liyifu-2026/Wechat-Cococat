use axum::{extract::Json, http::StatusCode};
use serde::{Deserialize, Serialize};

use crate::tools::exec::{exec_command, ExecOptions};

#[derive(Deserialize)]
pub struct ClickRequest {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
pub struct ClickResponse {
    success: bool,
}

pub async fn click_at(Json(req): Json<ClickRequest>) -> (StatusCode, Json<ClickResponse>) {
    let x = req.x.round() as i32;
    let y = req.y.round() as i32;

    tracing::info!("[interact] click at ({x}, {y})");

    let args: Vec<String> = vec![x.to_string(), y.to_string()];
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let result = exec_command("click", &args_ref, &ExecOptions::default()).await;

    match result.exit_code {
        0 => (StatusCode::OK, Json(ClickResponse { success: true })),
        _ => {
            tracing::error!("[interact] click failed: {}", result.stderr);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ClickResponse { success: false }),
            )
        }
    }
}
