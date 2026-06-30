//! Memory persona — the sole section parser for `## 相处记忆`.
//!
//! This is the Rust-side SSOT for parsing the memory section out of
//! `persona.md`. The TS side (`packages/agent/src/persona.ts`) no longer
//! parses sections at all — it only does string ops (find marker, replace
//! rest). See P0-4 in the architecture refactor notes.
//!
//! Split out of `agent_config.rs` so that persona reading + section parsing
//! live together, separate from profile CRUD, escalation state, and path
//! resolution.

use std::fs;

use crate::paths::chat_dir_path;

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatMemorySummary {
    pub lines: Vec<String>,
}

/// Extract the body of the `## 相处记忆` section from a persona.md string.
///
/// Finds the marker, then scans for the next `\n## ` header (or end of
/// string) and returns the trimmed body between them.
pub fn extract_memory_section_body(persona_md: &str) -> String {
    let marker = "## 相处记忆";
    let start = match persona_md.find(marker) {
        Some(i) => i + marker.len(),
        None => return String::new(),
    };
    let rest = &persona_md[start..];
    let end = rest
        .find("\n## ")
        .map(|i| &rest[..i])
        .unwrap_or(rest);
    end.trim().to_string()
}

fn parse_memory_section(persona_md: &str, max: usize) -> Vec<String> {
    let body = extract_memory_section_body(persona_md);
    if body.is_empty() || body.contains("首次 fork 时为空") {
        return vec![];
    }
    body.lines()
        .map(|l| l.trim().trim_start_matches('-').trim_start_matches('*').trim())
        .filter(|l| !l.is_empty() && !l.starts_with('（'))
        .take(max)
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
pub fn read_chat_memory_summary(
    chat_id: String,
    max_lines: Option<usize>,
) -> Result<ChatMemorySummary, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let limit = max_lines.unwrap_or(3).max(1);
    let path = chat_dir_path(&chat_id).join("persona.md");
    if !path.is_file() {
        return Ok(ChatMemorySummary::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines = parse_memory_section(&raw, limit);
    Ok(ChatMemorySummary { lines })
}

/// Per-chat `## 相处记忆` —与 Agent `buildSystemPrompt` 注入对齐（SSOT）。
#[tauri::command]
pub fn read_memory_persona(chat_id: String) -> Result<String, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = chat_dir_path(&chat_id).join("persona.md");
    if !path.is_file() {
        return Ok(String::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(extract_memory_section_body(&raw))
}

#[cfg(test)]
mod tests {
    use super::extract_memory_section_body;

    #[test]
    fn extract_memory_section_body_returns_section_only() {
        let md = "## 核心性格\n\n猫\n\n## 相处记忆\n\n- 喜欢咖啡\n- 讨厌早起\n\n## 其他\n\nx";
        assert_eq!(
            extract_memory_section_body(md),
            "- 喜欢咖啡\n- 讨厌早起"
        );
    }
}
