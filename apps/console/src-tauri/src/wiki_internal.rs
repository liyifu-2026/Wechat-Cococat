//! In-process Wiki operations for Agent Worker upstream RPC (zero HTTP).

use std::fs;
use std::sync::{LazyLock, OnceLock};

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::runtime::Runtime;

use crate::api_server::{files, projects};
use crate::commands::search::{search_federated_inner, FederatedProjectSpec};

static APP: OnceLock<AppHandle> = OnceLock::new();
static RUNTIME: LazyLock<Runtime> =
    LazyLock::new(|| Runtime::new().expect("wiki_internal tokio runtime"));

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn handle_upstream(method: &str, params: Value) -> (Value, Option<String>) {
    match method {
        "wiki_search_federated" => match parse_federated_search(params) {
            Ok(args) => match RUNTIME.block_on(search_federated_inner(
                args.projects,
                args.query,
                args.top_k,
                args.include_content,
            )) {
                Ok(results) => (json!(results), None),
                Err(err) => (Value::Null, Some(err)),
            },
            Err(err) => (Value::Null, Some(err)),
        },
        "wiki_read_file" => match read_wiki_file(params) {
            Ok(content) => (json!({ "content": content }), None),
            Err(err) => (Value::Null, Some(err)),
        },
        "wiki_list_projects" => match list_projects() {
            Ok(entries) => (json!({ "projects": entries }), None),
            Err(err) => (Value::Null, Some(err)),
        },
        "ping" => (json!({ "ok": true }), None),
        other => (
            Value::Null,
            Some(format!("Unknown upstream method: {other}")),
        ),
    }
}

#[derive(Debug)]
struct FederatedSearchArgs {
    projects: Vec<FederatedProjectSpec>,
    query: String,
    top_k: usize,
    include_content: bool,
}

fn parse_federated_search(params: Value) -> Result<FederatedSearchArgs, String> {
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("wiki_search_federated requires params.query")?
        .to_string();

    let projects_val = params
        .get("projects")
        .and_then(Value::as_array)
        .ok_or("wiki_search_federated requires params.projects")?;

    let mut projects = Vec::new();
    for item in projects_val {
        let project_path = item
            .get("projectPath")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("each project requires projectPath")?
            .to_string();
        let project_name = item
            .get("projectName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        projects.push(FederatedProjectSpec {
            project_path,
            project_name,
        });
    }

    if projects.is_empty() {
        return Err("wiki_search_federated requires at least one project".into());
    }

    let top_k = params
        .get("topK")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(20)
        .clamp(1, 50);

    let include_content = params
        .get("includeContent")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    Ok(FederatedSearchArgs {
        projects,
        query,
        top_k,
        include_content,
    })
}

fn read_wiki_file(params: Value) -> Result<String, String> {
    let project_path = params
        .get("projectPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("wiki_read_file requires params.projectPath")?;
    let rel_path = params
        .get("relPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("wiki_read_file requires params.relPath")?;

    if !files::is_public_project_rel(rel_path) {
        return Err("Path is not exposed for internal wiki read".into());
    }
    let path = files::safe_join(project_path, rel_path)?;
    if !path.is_file() {
        return Err(format!("File not found: {rel_path}"));
    }
    let meta = fs::metadata(&path).map_err(|e| format!("File metadata failed: {e}"))?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("File is too large to read".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleProjectJson {
    id: String,
    name: String,
    path: String,
    current: bool,
}

fn list_projects() -> Result<Vec<ConsoleProjectJson>, String> {
    let app = APP
        .get()
        .ok_or("Wiki internal app handle not initialized")?;
    let entries = projects::load_projects(app);
    Ok(entries
        .into_iter()
        .map(|p| ConsoleProjectJson {
            id: p.id,
            name: p.name,
            path: p.path,
            current: p.current,
        })
        .collect())
}

pub fn resolve_project_path(project_id: &str) -> Result<String, String> {
    let app = APP
        .get()
        .ok_or("Wiki internal app handle not initialized")?;
    let project = projects::resolve_project(app, project_id)?;
    Ok(project.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_federated_search_requires_query_and_projects() {
        let err = parse_federated_search(json!({})).unwrap_err();
        assert!(err.contains("query"));
        let err = parse_federated_search(json!({ "query": "refund" })).unwrap_err();
        assert!(err.contains("projects"));
    }
}
