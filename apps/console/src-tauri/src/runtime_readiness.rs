use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::{paths, runtime_layout, stack};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessItem {
    id: &'static str,
    label: &'static str,
    state: &'static str,
    detail: String,
    action: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadiness {
    overall: &'static str,
    config_dir: String,
    data_dir: String,
    items: Vec<RuntimeReadinessItem>,
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .env("PATH", stack::node_path_env())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("{program} exited {}", output.status)
    } else {
        stderr
    })
}

fn path_item(
    id: &'static str,
    label: &'static str,
    path: PathBuf,
    action: Option<String>,
) -> RuntimeReadinessItem {
    if path.exists() {
        RuntimeReadinessItem {
            id,
            label,
            state: "ready",
            detail: path.display().to_string(),
            action: None,
        }
    } else {
        RuntimeReadinessItem {
            id,
            label,
            state: "missing",
            detail: format!("Missing {}", path.display()),
            action,
        }
    }
}

fn docker_item() -> RuntimeReadinessItem {
    match command_output("docker", &["info", "--format", "{{.ServerVersion}}"]) {
        Ok(version) => RuntimeReadinessItem {
            id: "docker",
            label: "Docker Desktop",
            state: "ready",
            detail: if version.is_empty() {
                "Docker daemon reachable".into()
            } else {
                format!("Docker daemon reachable ({version})")
            },
            action: None,
        },
        Err(err) => RuntimeReadinessItem {
            id: "docker",
            label: "Docker Desktop",
            state: "missing",
            detail: format!("Docker daemon unavailable: {err}"),
            action: Some("Install and start Docker Desktop".into()),
        },
    }
}

fn node_item() -> RuntimeReadinessItem {
    match command_output("node", &["--version"]) {
        Ok(version) => {
            let major = version
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            if major >= 22 {
                RuntimeReadinessItem {
                    id: "node",
                    label: "Node.js",
                    state: "ready",
                    detail: version,
                    action: None,
                }
            } else {
                RuntimeReadinessItem {
                    id: "node",
                    label: "Node.js",
                    state: "missing",
                    detail: format!("Node.js 22+ required; found {version}"),
                    action: Some("Install Node.js 22 LTS".into()),
                }
            }
        }
        Err(err) => RuntimeReadinessItem {
            id: "node",
            label: "Node.js",
            state: "missing",
            detail: format!("node not found: {err}"),
            action: Some("Install Node.js 22 LTS".into()),
        },
    }
}

fn driver_image_item() -> RuntimeReadinessItem {
    let image = std::env::var("AGENT_WECHAT_IMAGE").unwrap_or_else(|_| "agent-wechat:amd64".into());
    match command_output(
        "docker",
        &["image", "inspect", &image, "--format", "{{.Id}}"],
    ) {
        Ok(id) => RuntimeReadinessItem {
            id: "driverImage",
            label: "Driver image",
            state: "ready",
            detail: format!("{image} {}", id.chars().take(18).collect::<String>()),
            action: None,
        },
        Err(_) => RuntimeReadinessItem {
            id: "driverImage",
            label: "Driver image",
            state: "missing",
            detail: format!("{image} not found"),
            action: Some("Run scripts\\install-windows.ps1 -BuildImage".into()),
        },
    }
}

#[tauri::command]
pub fn get_runtime_readiness() -> RuntimeReadiness {
    let config_dir = paths::cococat_config_dir();
    let data_dir = paths::cococat_data_dir();
    let resource_root = runtime_layout::resource_root();

    let items = vec![
        RuntimeReadinessItem {
            id: "configDir",
            label: "Config directory",
            state: "ready",
            detail: config_dir.display().to_string(),
            action: None,
        },
        RuntimeReadinessItem {
            id: "dataDir",
            label: "Data directory",
            state: "ready",
            detail: data_dir.display().to_string(),
            action: None,
        },
        RuntimeReadinessItem {
            id: "resourceRoot",
            label: "Runtime resources",
            state: "ready",
            detail: resource_root.display().to_string(),
            action: None,
        },
        path_item(
            "token",
            "Auth token",
            config_dir.join("token"),
            Some("Run scripts\\install-windows.ps1".into()),
        ),
        path_item(
            "agentEnv",
            "Agent env",
            config_dir.join("agent.env"),
            Some("Copy config\\agent.env.example to the config directory".into()),
        ),
        docker_item(),
        node_item(),
        driver_image_item(),
        path_item(
            "agentBuild",
            "Agent build",
            runtime_layout::agent_entry("cli.js"),
            Some("Build Agent before packaging or run pnpm agent:build".into()),
        ),
        path_item(
            "composeFile",
            "Docker compose",
            runtime_layout::compose_dir().join("docker-compose.yml"),
            Some("Bundle docker-compose.yml with the runtime resources".into()),
        ),
    ];

    let overall = if items.iter().all(|item| item.state == "ready") {
        "ready"
    } else {
        "needsSetup"
    };

    RuntimeReadiness {
        overall,
        config_dir: config_dir.display().to_string(),
        data_dir: data_dir.display().to_string(),
        items,
    }
}
