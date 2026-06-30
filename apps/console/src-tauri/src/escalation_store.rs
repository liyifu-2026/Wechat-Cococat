//! Escalation state + mute CRUD.
//!
//! Split out of `agent_config.rs` — escalation state and mute management
//! are an isolated concern with their own JSON schemas and file locations,
//! unrelated to profile CRUD or memory persona parsing.

use std::fs;

use crate::paths::{chat_dir_path, cococat_data_dir, ensure_parent};

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatEscalationStateFile {
    #[serde(default)]
    pub deflect_sent: bool,
    #[serde(default)]
    pub probe_streak: u32,
}

#[tauri::command]
pub fn read_chat_escalation_state(chat_id: String) -> Result<ChatEscalationStateFile, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = chat_dir_path(&chat_id).join("escalation-state.json");
    if !path.is_file() {
        return Ok(ChatEscalationStateFile::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("escalation-state.json: {e}"))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct EscalationMuteEntry {
    pub chat_id: String,
    pub chat_name: String,
    pub reason: String,
    pub muted_until: u64,
    pub triggered_at: String,
}

#[tauri::command]
pub fn list_escalation_mutes() -> Result<Vec<EscalationMuteEntry>, String> {
    let path = cococat_data_dir().join("escalation/mutes.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entries = json
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut out = Vec::new();
    for entry in entries {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let muted_until = obj
            .get("mutedUntil")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if muted_until <= now_ms {
            continue;
        }
        out.push(EscalationMuteEntry {
            chat_id: obj
                .get("chatId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            chat_name: obj
                .get("chatName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            reason: obj
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            muted_until,
            triggered_at: obj
                .get("triggeredAt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn unmute_escalation_chat(chat_id: String) -> Result<bool, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = cococat_data_dir().join("escalation/mutes.json");
    if !path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entries = json
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let had_target = entries.iter().any(|entry| {
        entry
            .get("chatId")
            .and_then(|v| v.as_str())
            == Some(chat_id.as_str())
    });
    let next: Vec<serde_json::Value> = entries
        .into_iter()
        .filter(|entry| {
            let id_match = entry
                .get("chatId")
                .and_then(|v| v.as_str())
                .map(|id| id == chat_id)
                .unwrap_or(false);
            if id_match {
                return false;
            }
            entry
                .get("mutedUntil")
                .and_then(|v| v.as_u64())
                .map(|until| until > now_ms)
                .unwrap_or(false)
        })
        .collect();
    let changed = had_target;
    json["entries"] = serde_json::Value::Array(next);
    ensure_parent(&path)?;
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap_or_else(|_| "{}".into()))
        .map_err(|e| e.to_string())?;
    Ok(changed)
}

#[tauri::command]
pub fn mute_escalation_chat(
    chat_id: String,
    chat_name: String,
    reason: String,
    hours: Option<u64>,
) -> Result<bool, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("reason required".into());
    }
    let hours = hours.unwrap_or_else(|| {
        if reason == "probe_b" {
            2
        } else {
            24
        }
    });
    let path = cococat_data_dir().join("escalation/mutes.json");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut json: serde_json::Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_else(|_| {
            serde_json::json!({ "version": 1, "entries": [] })
        })
    } else {
        serde_json::json!({ "version": 1, "entries": [] })
    };
    let entries = json
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let active: Vec<serde_json::Value> = entries
        .into_iter()
        .filter(|entry| {
            let id_match = entry
                .get("chatId")
                .and_then(|v| v.as_str())
                .map(|id| id == chat_id)
                .unwrap_or(false);
            if id_match {
                return false;
            }
            entry
                .get("mutedUntil")
                .and_then(|v| v.as_u64())
                .map(|until| until > now_ms)
                .unwrap_or(false)
        })
        .collect();
    let muted_until = now_ms + hours * 60 * 60 * 1000;
    let triggered_at = chrono::Utc::now().to_rfc3339();
    let mut next = active;
    next.push(serde_json::json!({
        "chatId": chat_id,
        "chatName": chat_name,
        "reason": reason,
        "mutedUntil": muted_until,
        "triggeredAt": triggered_at,
    }));
    json["entries"] = serde_json::Value::Array(next);
    ensure_parent(&path)?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&json).unwrap_or_else(|_| "{}".into()),
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}
