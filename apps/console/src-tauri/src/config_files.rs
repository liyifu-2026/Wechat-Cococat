//! App-level config file I/O + legacy detection + paths export.
//!
//! Residual module after splitting `agent_config.rs` into focused modules
//! (`paths.rs`, `chat_profile.rs`, `memory_persona.rs`, `escalation_store.rs`,
//! `agent_chat_dir.rs`, `console_logs.rs`). What remains here is genuinely
//! app-level: generic config file read/write, the `get_cococat_paths` /
//! `open_cococat_folder` helpers, and legacy `agent-wechat` detection.

use std::fs;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::paths::{cococat_config_dir, cococat_data_dir, ensure_parent, home_dir};

#[tauri::command]
pub fn read_config_file(name: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid config file name".into());
    }
    let path = cococat_config_dir().join(&name);
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn write_config_file(name: String, content: String) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid config file name".into());
    }
    let path = cococat_config_dir().join(&name);
    ensure_parent(&path)?;
    fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CococatPaths {
    pub config_dir: String,
    pub data_dir: String,
}

#[tauri::command]
pub fn get_cococat_paths() -> CococatPaths {
    CococatPaths {
        config_dir: cococat_config_dir().to_string_lossy().into_owned(),
        data_dir: cococat_data_dir().to_string_lossy().into_owned(),
    }
}

#[tauri::command]
pub fn open_cococat_folder(app: AppHandle, kind: String) -> Result<(), String> {
    let path = match kind.as_str() {
        "config" => cococat_config_dir(),
        "data" => cococat_data_dir(),
        _ => return Err(format!("unknown folder kind: {kind}")),
    };
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().into_owned();
    match app.opener().open_path(&path_str, None::<&str>) {
        Ok(()) => Ok(()),
        Err(open_err) => app
            .opener()
            .reveal_item_in_dir(&path_str)
            .map_err(|reveal_err| {
                format!(
                    "Failed to open folder: {}; reveal fallback also failed: {}",
                    open_err, reveal_err
                )
            }),
    }
}

#[tauri::command]
pub fn detect_legacy_config() -> Result<bool, String> {
    let legacy = home_dir().join(".config/agent-wechat");
    let token = cococat_config_dir().join("token");
    Ok(legacy.is_dir() && !token.is_file())
}
