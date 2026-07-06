use std::path::{Path, PathBuf};

use crate::paths::{cococat_config_dir, home_dir};
use crate::runtime_layout;
use crate::stack_orchestrator;

fn repo_root() -> PathBuf {
    runtime_layout::app_root()
}

fn read_token_from(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn read_cococat_token() -> Result<String, String> {
    let path = cococat_config_dir().join("token");
    if let Some(token) = read_token_from(&path) {
        return Ok(token);
    }
    Err("Missing token. Run pnpm migrate or create ~/.config/cococat/token".into())
}

fn extended_path() -> String {
    let home = home_dir();
    let repo = repo_root();
    let mut parts: Vec<String> = vec![
        format!("{}/.local/bin", home.display()),
        format!("{}/.local/share/cococat/bin", home.display()),
        format!("{}/.local/share/pnpm", home.display()),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];
    for dir in runtime_layout::node_modules_bin_dirs() {
        parts.insert(0, dir.to_string_lossy().to_string());
    }
    parts.insert(0, format!("{}/node_modules/.bin", repo.display()));
    if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            parts.insert(0, bin.to_string_lossy().to_string());
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        if !existing.is_empty() {
            parts.push(existing);
        }
    }
    parts.join(":")
}

pub(crate) fn node_path_env() -> String {
    extended_path()
}

pub fn run_stack_command(service: &str, action: &str) -> Result<String, String> {
    stack_orchestrator::execute_command(service, action)
}

#[tauri::command]
pub async fn stack_command(service: String, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_stack_command(&service, &action))
        .await
        .map_err(|e| format!("stack_command task failed: {e}"))?
}

#[tauri::command]
pub fn read_cococat_token_cmd() -> Result<String, String> {
    let token = read_cococat_token()?;
    crate::driver_proxy::update_cached_token(token.clone());
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_path_includes_homebrew_and_local_bin() {
        let path = extended_path();
        assert!(path.contains("/usr/local/bin"));
        assert!(path.contains(".local/bin"));
    }
}
