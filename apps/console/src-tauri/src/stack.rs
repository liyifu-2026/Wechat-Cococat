use std::path::{Path, PathBuf};
use std::process::Command;

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("COCOCAT_REPO_ROOT") {
        return PathBuf::from(root);
    }
    // CARGO_MANIFEST_DIR = apps/console/src-tauri → monorepo root is three levels up
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn stack_script() -> PathBuf {
    if cfg!(target_os = "windows") {
        repo_root().join("scripts/cococat-stack.ps1")
    } else {
        repo_root().join("scripts/cococat-stack.sh")
    }
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
        format!("{}/.local/share/pnpm", home.display()),
        format!("{}/node_modules/.bin", repo.display()),
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
    let script = stack_script();
    if !script.is_file() {
        return Err(format!("Stack script not found: {}", script.display()));
    }

    let repo = repo_root();
    let path = extended_path();

    let output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg(action)
            .arg(service)
            .env("COCOCAT_REPO_ROOT", repo.to_string_lossy().to_string())
            .env("PATH", &path)
            .output()
            .map_err(|e| format!("Failed to run stack script: {e}"))?
    } else {
        Command::new("bash")
            .arg(&script)
            .arg(action)
            .arg(service)
            .env("COCOCAT_REPO_ROOT", repo.to_string_lossy().to_string())
            .env("PATH", path)
            .output()
            .map_err(|e| format!("Failed to run stack script: {e}"))?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if stdout.is_empty() {
            Ok(stderr)
        } else if stderr.is_empty() {
            Ok(stdout)
        } else {
            Ok(format!("{stdout}\n{stderr}"))
        }
    } else {
        Err(if stderr.is_empty() {
            if stdout.is_empty() {
                format!("stack command failed: {action} {service}")
            } else {
                stdout
            }
        } else {
            format!("{stdout}\n{stderr}").trim().to_string()
        })
    }
}

#[tauri::command]
pub fn stack_command(service: String, action: String) -> Result<String, String> {
    run_stack_command(&service, &action)
}

#[tauri::command]
pub fn read_cococat_token_cmd() -> Result<String, String> {
    read_cococat_token()
}
