//! Agent chat directory management + wiki binding + proxy toggle.
//!
//! Split out of `agent_config.rs`. Owns the on-disk layout of
//! `~/.local/share/cococat/chats/<dir>/` — meta.json, wiki.json, style.json,
//! and the per-chat `agentProxyEnabled` flag. `validate_wiki_json` is
//! private to this module: it's an internal validation detail of
//! `ensure_and_bind_agent_chat_dir` / `write_agent_chat_file`, not a
//! reusable concern.

use std::fs;
use std::path::PathBuf;

use crate::paths::{chat_dir_path, cococat_data_dir, encode_chat_dir, ensure_parent};

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AgentChatSummary {
    pub chat_id: String,
    pub dir_name: String,
    pub created_at: Option<String>,
    pub last_local_id: Option<u64>,
}

const AGENT_CHAT_FILES: &[&str] = &[
    "meta.json",
    "persona.md",
    "wiki.json",
    "style.json",
    "transcript.json",
    "profile.json",
    "escalation-state.json",
];

fn validate_agent_chat_path(dir_name: &str, file: &str) -> Result<PathBuf, String> {
    if dir_name.contains('/') || dir_name.contains('\\') || dir_name.contains("..") {
        return Err("invalid chat dir".into());
    }
    if !AGENT_CHAT_FILES.contains(&file) {
        return Err("file not allowed".into());
    }
    Ok(cococat_data_dir().join("chats").join(dir_name).join(file))
}

#[tauri::command]
pub fn list_agent_chats() -> Result<Vec<AgentChatSummary>, String> {
    let root = cococat_data_dir().join("chats");
    if !root.is_dir() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let meta_path = path.join("meta.json");
        let (chat_id, created_at, last_local_id) = if meta_path.is_file() {
            let raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
            let meta: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("meta.json: {e}"))?;
            let chat_id = meta
                .get("chatId")
                .and_then(|v| v.as_str())
                .unwrap_or(&dir_name)
                .to_string();
            let created_at = meta
                .get("createdAt")
                .and_then(|v| v.as_str())
                .map(String::from);
            let last_local_id = meta.get("lastLocalId").and_then(|v| v.as_u64());
            (chat_id, created_at, last_local_id)
        } else {
            (dir_name.clone(), None, None)
        };
        out.push(AgentChatSummary {
            chat_id,
            dir_name,
            created_at,
            last_local_id,
        });
    }
    out.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.chat_id.cmp(&b.chat_id))
    });
    Ok(out)
}

#[tauri::command]
pub fn read_agent_chat_file(dir_name: String, file: String) -> Result<String, String> {
    let path = validate_agent_chat_path(&dir_name, &file)?;
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_agent_chat_file(
    dir_name: String,
    file: String,
    content: String,
) -> Result<(), String> {
    let path = validate_agent_chat_path(&dir_name, &file)?;
    ensure_parent(&path)?;
    fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))
}

static CHAT_DIR_BIND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn validate_wiki_json(content: &str) -> Result<serde_json::Value, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("wiki.json content required".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("wiki.json: {e}"))?;
    let projects = value
        .get("projects")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "wiki.json must contain a projects array".to_string())?;
    for item in projects {
        if !item.is_string() {
            return Err("wiki.json projects must be strings".into());
        }
    }
    Ok(value)
}

fn ensure_chat_meta(chat_id: &str, dir: &std::path::Path) -> Result<(), String> {
    let meta_path = dir.join("meta.json");
    if meta_path.is_file() {
        return Ok(());
    }
    let meta = serde_json::json!({
        "chatId": chat_id,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    });
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", meta_path.display()))
}

/// Atomically ensure agent chat dir exists, write compliant meta.json (if new), then wiki.json.
/// Serialized with CHAT_DIR_BIND_LOCK to avoid TS/Agent concurrent mkdir races.
#[tauri::command]
pub fn ensure_and_bind_agent_chat_dir(
    chat_id: String,
    wiki_json_content: String,
) -> Result<String, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let wiki = validate_wiki_json(&wiki_json_content)?;
    let _guard = CHAT_DIR_BIND_LOCK
        .lock()
        .map_err(|e| format!("chat bind lock poisoned: {e}"))?;
    let dir = chat_dir_path(&chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_meta(&chat_id, &dir)?;
    let wiki_path = dir.join("wiki.json");
    let serialized = serde_json::to_string_pretty(&wiki)
        .map_err(|e| format!("wiki.json serialize: {e}"))?
        + "\n";
    fs::write(&wiki_path, serialized)
        .map_err(|e| format!("{}: {e}", wiki_path.display()))?;
    Ok(encode_chat_dir(&chat_id))
}

fn read_agent_proxy_enabled_from_style(style_path: &std::path::Path) -> Result<bool, String> {
    if !style_path.is_file() {
        return Ok(true);
    }
    let raw = fs::read_to_string(style_path).map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("style.json: {e}"))?;
    Ok(v.get("agentProxyEnabled")
        .and_then(|b| b.as_bool())
        .unwrap_or(true))
}

/// Per-chat Agent 代发开关（style.json `agentProxyEnabled`；缺省 true）。
#[tauri::command]
pub fn read_chat_agent_proxy_enabled(chat_id: String) -> Result<bool, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(&chat_id);
    read_agent_proxy_enabled_from_style(&dir.join("style.json"))
}

#[tauri::command]
pub fn set_chat_agent_proxy_enabled(chat_id: String, enabled: bool) -> Result<(), String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(&chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_meta(&chat_id, &dir)?;

    let style_path = dir.join("style.json");
    let mut style: serde_json::Value = if style_path.is_file() {
        let raw = fs::read_to_string(&style_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = style.as_object_mut() {
        obj.insert("agentProxyEnabled".to_string(), serde_json::json!(enabled));
    }
    fs::write(
        &style_path,
        serde_json::to_string_pretty(&style).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", style_path.display()))?;
    Ok(())
}

#[tauri::command]
pub fn read_chat_wiki_hits(chat_id: String) -> Result<Vec<String>, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = chat_dir_path(&chat_id).join("wiki-hits.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let hits = json
        .get("hits")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::validate_wiki_json;

    #[test]
    fn validate_wiki_json_requires_projects_array() {
        assert!(validate_wiki_json(r#"{"projects":["FAQ"]}"#).is_ok());
        assert!(validate_wiki_json(r#"{"projects":[]}"#).is_ok());
        assert!(validate_wiki_json("{}").is_err());
        assert!(validate_wiki_json(r#"{"projects":[1]}"#).is_err());
    }
}
