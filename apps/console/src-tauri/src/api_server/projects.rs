use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::infra;
use super::routing::{ApiResponse, ok};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ProjectEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub current: bool,
}

pub(super) fn handle_projects(app: &AppHandle) -> ApiResponse {
    let projects = load_projects(app);
    let current_project = projects.iter().find(|project| project.current).cloned();
    ok(json!({
        "ok": true,
        "projects": projects,
        "currentProject": current_project,
    }))
}

pub(crate) fn load_projects(app: &AppHandle) -> Vec<ProjectEntry> {
    let current = String::new();
    let mut by_path: BTreeMap<String, ProjectEntry> = BTreeMap::new();

    if let Some(parsed) = infra::load_app_state(app) {
        if let Some(registry) = parsed.get("projectRegistry").and_then(Value::as_object) {
            for (id, value) in registry {
                let path = value.get("path").and_then(Value::as_str).unwrap_or("");
                if path.is_empty() {
                    continue;
                }
                let path = normalize_path(path);
                let name = value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| project_name_from_path(&path));
                by_path.insert(
                    path.clone(),
                    ProjectEntry {
                        id: id.clone(),
                        name,
                        current: path == current,
                        path,
                    },
                );
            }
        }
        if let Some(recents) = parsed.get("recentProjects").and_then(Value::as_array) {
            for value in recents {
                let path = value.get("path").and_then(Value::as_str).unwrap_or("");
                if path.is_empty() {
                    continue;
                }
                let path = normalize_path(path);
                by_path.entry(path.clone()).or_insert_with(|| {
                    let id = read_project_id(&path).unwrap_or_else(|| path.clone());
                    let name = value
                        .get("name")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| project_name_from_path(&path));
                    ProjectEntry {
                        id,
                        name,
                        current: path == current,
                        path,
                    }
                });
            }
        }
    }



    if !current.is_empty() {
        by_path
            .entry(current.clone())
            .or_insert_with(|| ProjectEntry {
                id: read_project_id(&current).unwrap_or_else(|| current.clone()),
                name: project_name_from_path(&current),
                current: true,
                path: current.clone(),
            });
    }

    by_path.into_values().collect()
}

pub(crate) fn resolve_project(app: &AppHandle, project_id: &str) -> Result<ProjectEntry, String> {
    let project_id = infra::percent_decode(project_id);
    let wants_current = project_id.eq_ignore_ascii_case("current");
    load_projects(app)
        .into_iter()
        .find(|p| {
            p.id == project_id
                || project_path_matches(&p.path, &project_id)
                || (wants_current && p.current)
        })
        .ok_or_else(|| format!("Unknown project: {project_id}"))
}

pub(super) fn project_path_matches(stored_path: &str, candidate: &str) -> bool {
    let stored = normalize_path(stored_path);
    let candidate = normalize_path(candidate);
    if cfg!(windows) {
        stored.eq_ignore_ascii_case(&candidate)
    } else {
        stored == candidate
    }
}

pub(super) fn read_project_id(path: &str) -> Option<String> {
    let raw = fs::read_to_string(Path::new(path).join(".llm-wiki/project.json")).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub(super) fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Project")
        .to_string()
}

pub(super) fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_path_match_normalizes_separators() {
        assert!(project_path_matches(
            "C:/Users/me/wiki",
            "C:\\Users\\me\\wiki"
        ));
        if cfg!(windows) {
            assert!(project_path_matches("C:/Users/me/wiki", "c:/users/me/wiki"));
        } else {
            assert!(!project_path_matches(
                "C:/Users/me/wiki",
                "c:/users/me/wiki"
            ));
        }
    }
}
