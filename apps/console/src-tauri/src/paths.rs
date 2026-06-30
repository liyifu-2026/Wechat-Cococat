//! CocoCat Config Root — Rust adapter.
//!
//! Single source of truth for path resolution across the Tauri backend.
//! Mirrors `@cococat/shared/paths.ts` on the TS side. Before this module
//! existed, `home_dir()` / `cococat_config_dir()` / `cococat_data_dir()` were
//! copy-pasted across `agent_config.rs`, `stack.rs`, and `stack_orchestrator.rs`
//! — three drifted copies of the same logic.

use std::path::{Path, PathBuf};

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn cococat_config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".config/cococat")
}

pub fn cococat_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_DATA_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".local/share/cococat")
}

pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `12345678@chatroom` → `_12345678_chatroom`
pub fn encode_chat_dir(chat_id: &str) -> String {
    format!("_{}", chat_id.replace('@', "_"))
}

pub fn chat_dir_path(chat_id: &str) -> PathBuf {
    cococat_data_dir()
        .join("chats")
        .join(encode_chat_dir(chat_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_chat_dir_matches_agent() {
        assert_eq!(encode_chat_dir("12345678@chatroom"), "_12345678_chatroom");
    }
}
