//! Console event log + stack log readers.
//!
//! Split out of `agent_config.rs` — log readers are a read-only concern
//! with their own file formats (JSONL for console events, plain text for
//! stack log), unrelated to chat directory management or profile CRUD.

use std::fs;

use crate::paths::cococat_data_dir;

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEventDto {
    pub ts: String,
    pub kind: String,
    #[serde(default)]
    pub chat_id: Option<String>,
    #[serde(default)]
    pub chat_name: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn list_console_events(max_lines: Option<usize>) -> Result<Vec<ConsoleEventDto>, String> {
    let path = cococat_data_dir().join("events.jsonl");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let limit = max_lines.unwrap_or(120).max(1);
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = if lines.len() <= limit {
        lines
    } else {
        lines[lines.len() - limit..].to_vec()
    };
    let mut out = Vec::with_capacity(tail.len());
    for line in tail {
        if let Ok(ev) = serde_json::from_str::<ConsoleEventDto>(line) {
            if !ev.kind.is_empty() && !ev.ts.is_empty() {
                out.push(ev);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn read_stack_log(max_lines: Option<usize>) -> Result<String, String> {
    let path = cococat_data_dir().join("stack/agent.log");
    if !path.is_file() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let limit = max_lines.unwrap_or(80).max(1);
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= limit {
        Ok(content)
    } else {
        Ok(lines[lines.len() - limit..].join("\n"))
    }
}
