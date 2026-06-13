use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::AppHandle;

use super::projects;
use super::routing::{ApiResponse, err, ok};

pub(super) fn handle_agent_scope(app: &AppHandle, project_id: &str) -> ApiResponse {
    let project = match projects::resolve_project(app, project_id) {
        Ok(project) => project,
        Err(e) => return err(404, e),
    };

    let path = PathBuf::from(&project.path)
        .join(".llm-wiki")
        .join("agent-scope.json");

    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return err(
                404,
                "agent-scope.json not found — run wiki ingest to generate it",
            );
        }
        Err(e) => return err(500, format!("Failed to read agent-scope.json: {e}")),
    };

    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(e) => return err(500, format!("Invalid agent-scope.json: {e}")),
    };

    let mtime_ms = fs::metadata(&path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    ok(json!({
        "ok": true,
        "projectId": project.id,
        "path": ".llm-wiki/agent-scope.json",
        "mtimeMs": mtime_ms,
        "scope": parsed,
    }))
}
