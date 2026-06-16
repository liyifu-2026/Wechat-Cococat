use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

use crate::agent_worker;
use crate::stack;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewReplyResult {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executed_action: Option<String>,
    pub reason: String,
    pub answer: String,
    pub stealth_ok: bool,
    pub banned_hits: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

fn preview_script() -> PathBuf {
    stack::monorepo_root().join("scripts/preview-agent-reply.mjs")
}

fn agent_entry() -> PathBuf {
    stack::monorepo_root().join("packages/agent/dist/index.js")
}

fn run_agent_preview_cold(query: &str, chat_id: Option<&str>) -> Result<PreviewReplyResult, String> {
    let script = preview_script();
    if !script.is_file() {
        return Err(format!("Preview script not found: {}", script.display()));
    }
    if !agent_entry().is_file() {
        return Err(
            "Agent not built. Run: pnpm --filter @cococat/agent build".into(),
        );
    }

    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .arg(query.trim())
        .env(
            "COCOCAT_REPO_ROOT",
            stack::monorepo_root().to_string_lossy().to_string(),
        )
        .env("PATH", stack::node_path_env());

    if let Some(id) = chat_id {
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            cmd.arg(trimmed);
        }
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run agent preview: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                "Agent preview failed".into()
            } else {
                stdout
            }
        } else if stdout.is_empty() {
            stderr
        } else {
            format!("{stdout}\n{stderr}")
        });
    }

    serde_json::from_str(&stdout).map_err(|e| format!("Invalid preview JSON: {e} — {stdout}"))
}

#[tauri::command]
pub async fn preview_agent_reply(
    query: String,
    chat_id: Option<String>,
) -> Result<PreviewReplyResult, String> {
    match agent_worker::request_preview_reply(&query, chat_id.as_deref()).await {
        Ok(value) => serde_json::from_value(value)
            .map_err(|e| format!("Invalid worker preview JSON: {e}")),
        Err(worker_err) => {
            eprintln!("[preview] worker RPC failed ({worker_err}), using cold spawn");
            run_agent_preview_cold(&query, chat_id.as_deref())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_preview_probe_query_falls_back_to_reply() {
        if !agent_entry().is_file() {
            eprintln!("skip agent_preview_probe_query_falls_back_to_reply: agent dist missing");
            return;
        }
        // Phase 6.1: deflectLine 已移除，探针类问题走 CONTINUE_AGENT + fallback reply
        let result = run_agent_preview_cold("你是不是机器人", None).expect("preview");
        assert_eq!(result.action, "reply");
        assert_eq!(result.gate.as_deref(), Some("continue"));
        assert!(result.stealth_ok);
        assert!(result.banned_hits.is_empty());
    }
}
