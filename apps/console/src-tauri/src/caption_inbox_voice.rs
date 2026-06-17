use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

use crate::stack;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionInboxVoiceResult {
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn caption_script() -> PathBuf {
    stack::monorepo_root().join("scripts/caption-inbox-voice.mjs")
}

fn agent_caption_entry() -> PathBuf {
    stack::monorepo_root()
        .join("packages/agent/dist/caption-llm.js")
}

fn run_caption_script(audio_data_url: &str) -> Result<CaptionInboxVoiceResult, String> {
    let url = audio_data_url.trim();
    if url.is_empty() {
        return Err("audioDataUrl is empty".into());
    }

    let script = caption_script();
    if !script.is_file() {
        return Err(format!("Caption script not found: {}", script.display()));
    }
    if !agent_caption_entry().is_file() {
        return Err(
            "Agent not built. Run: pnpm --filter @cococat/agent build".into(),
        );
    }

    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .arg(url)
        .env(
            "COCOCAT_REPO_ROOT",
            stack::monorepo_root().to_string_lossy().to_string(),
        )
        .env("PATH", stack::node_path_env());

    if let Ok(dir) = std::env::var("COCOCAT_CONFIG_DIR") {
        cmd.env("COCOCAT_CONFIG_DIR", dir);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run voice caption: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() && !output.status.success() {
        return Err(if stderr.is_empty() {
            "Voice caption failed".into()
        } else {
            stderr
        });
    }

    let parsed: CaptionInboxVoiceResult = serde_json::from_str(&stdout).map_err(|e| {
        format!("Invalid caption JSON: {e} — stdout={stdout} stderr={stderr}")
    })?;

    if let Some(err) = parsed.error.as_ref().filter(|s| !s.is_empty()) {
        return Err(err.clone());
    }

    Ok(parsed)
}

#[tauri::command]
pub fn caption_inbox_voice(audio_data_url: String) -> Result<CaptionInboxVoiceResult, String> {
    run_caption_script(&audio_data_url)
}
