//! Per-chat profile CRUD with file locking.
//!
//! Split out of `agent_config.rs` — profile format + locking is an isolated
//! concern that doesn't need to share a module with path resolution,
//! memory parsing, or escalation state.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use fs2::FileExt;

use crate::paths::{chat_dir_path, ensure_parent};

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatProfileFile {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_type: Option<String>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatProfilePatch {
    /// Outer None = field omitted (no change). Inner None = clear userType.
    pub user_type: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
}

const PROFILE_LOCK_TIMEOUT: Duration = Duration::from_secs(3);
const PROFILE_LOCK_RETRY: Duration = Duration::from_millis(50);

fn profile_path(chat_id: &str) -> PathBuf {
    chat_dir_path(chat_id).join("profile.json")
}

fn read_profile_file(path: &Path) -> Result<ChatProfileFile, String> {
    if !path.is_file() {
        return Ok(ChatProfileFile::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(ChatProfileFile::default());
    }
    serde_json::from_str(&raw).map_err(|e| format!("profile.json: {e}"))
}

fn write_profile_file(path: &Path, profile: &ChatProfileFile) -> Result<(), String> {
    ensure_parent(path)?;
    fs::write(
        path,
        serde_json::to_string_pretty(profile).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(unix)]
fn with_profile_file<F, T>(chat_id: &str, f: F) -> Result<T, String>
where
    F: FnOnce(ChatProfileFile) -> Result<(ChatProfileFile, T), String>,
{
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = profile_path(chat_id);
    ensure_parent(&path)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + PROFILE_LOCK_TIMEOUT;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => break,
            Err(_) if Instant::now() < deadline => thread::sleep(PROFILE_LOCK_RETRY),
            Err(e) => return Err(format!("profile lock timeout: {e}")),
        }
    }
    let result = (|| {
        let mut profile = read_profile_file(&path)?;
        let (next, out) = f(profile)?;
        profile = next;
        write_profile_file(&path, &profile)?;
        Ok(out)
    })();
    let _ = file.unlock();
    result
}

#[cfg(not(unix))]
fn with_profile_file<F, T>(chat_id: &str, f: F) -> Result<T, String>
where
    F: FnOnce(ChatProfileFile) -> Result<(ChatProfileFile, T), String>,
{
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = profile_path(chat_id);
    let mut profile = read_profile_file(&path)?;
    let (next, out) = f(profile)?;
    profile = next;
    write_profile_file(&path, &profile)?;
    Ok(out)
}

#[tauri::command]
pub fn read_chat_profile(chat_id: String) -> Result<ChatProfileFile, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    read_profile_file(&profile_path(&chat_id))
}

#[tauri::command]
pub fn patch_chat_profile(chat_id: String, patch: ChatProfilePatch) -> Result<ChatProfileFile, String> {
    with_profile_file(&chat_id, |mut profile| {
        if let Some(user_type) = patch.user_type {
            profile.user_type = user_type.filter(|v| !v.trim().is_empty());
        }
        if let Some(tags) = patch.tags {
            profile.tags = tags
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
        }
        let out = profile.clone();
        Ok((profile, out))
    })
}

#[tauri::command]
pub fn write_chat_profile(chat_id: String, tags: Vec<String>) -> Result<(), String> {
    let cleaned: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    patch_chat_profile(
        chat_id,
        ChatProfilePatch {
            user_type: None,
            tags: Some(cleaned),
        },
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_profile_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join("cococat-chat-profile-tests")
            .join(format!("{name}-{nonce}"))
            .join("profile.json")
    }

    #[test]
    fn read_profile_file_treats_empty_file_as_default() {
        let path = temp_profile_path("empty");
        ensure_parent(&path).unwrap();
        fs::write(&path, "").unwrap();

        let profile = read_profile_file(&path).unwrap();

        assert!(profile.tags.is_empty());
        assert_eq!(profile.user_type, None);
    }

    #[test]
    fn read_profile_file_treats_whitespace_file_as_default() {
        let path = temp_profile_path("whitespace");
        ensure_parent(&path).unwrap();
        fs::write(&path, "  \n\t").unwrap();

        let profile = read_profile_file(&path).unwrap();

        assert!(profile.tags.is_empty());
        assert_eq!(profile.user_type, None);
    }
}
