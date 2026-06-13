use serde_json::{json, Value};
use tauri::AppHandle;

use crate::commands;

use super::infra;
use super::projects;
use super::routing::{ApiResponse, ok, err};

pub(super) fn handle_rescan(app: &AppHandle, project_id: &str) -> ApiResponse {
    let project = match projects::resolve_project(app, project_id) {
        Ok(project) => project,
        Err(e) => return err(404, e),
    };
    let source_watch_config = load_source_watch_config(app, &project.id);
    match commands::file_sync::rescan_project_files(
        app.clone(),
        project.id.clone(),
        project.path.clone(),
        source_watch_config,
    ) {
        Ok(result) => ok(json!({ "ok": true, "projectId": project.id, "result": result })),
        Err(e) => err(500, e),
    }
}

fn load_source_watch_config(
    app: &AppHandle,
    project_id: &str,
) -> Option<commands::file_sync::SourceWatchConfig> {
    let parsed = infra::load_app_state(app)?;
    let settings = parsed.get("sourceWatchConfig").and_then(Value::as_object);
    if let Some(value) = settings
        .and_then(|s| s.get(project_id).or_else(|| s.get("default")))
        .cloned()
    {
        if let Ok(config) = serde_json::from_value::<commands::file_sync::SourceWatchConfig>(value)
        {
            return Some(config);
        }
    }
    let legacy_enabled = parsed
        .get("projectFileSyncEnabled")
        .and_then(Value::as_object)
        .and_then(|settings| {
            settings
                .get(project_id)
                .or_else(|| settings.get("default"))
                .and_then(Value::as_bool)
        });
    legacy_enabled.and_then(|enabled| {
        serde_json::from_value::<commands::file_sync::SourceWatchConfig>(
            json!({ "enabled": enabled }),
        )
        .ok()
    })
}
