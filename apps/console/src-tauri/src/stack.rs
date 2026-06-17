use std::path::{Path, PathBuf};

use crate::stack_orchestrator;

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("COCOCAT_REPO_ROOT") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn cococat_config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".config/cococat")
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
        format!("{}/node_modules/.bin", repo.display()),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];
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

pub(crate) fn monorepo_root() -> PathBuf {
    repo_root()
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
    read_cococat_token()
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
