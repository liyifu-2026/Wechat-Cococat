use std::path::PathBuf;
use std::sync::OnceLock;

static RESOURCE_DIR_HINT: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_dir_hint(dir: PathBuf) {
    let _ = RESOURCE_DIR_HINT.set(dir);
}

pub fn source_root() -> PathBuf {
    if let Ok(root) = std::env::var("COCOCAT_REPO_ROOT") {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

pub fn resource_root() -> PathBuf {
    if let Ok(root) = std::env::var("COCOCAT_RESOURCE_ROOT") {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Some(dir) = RESOURCE_DIR_HINT.get() {
        let runtime = dir.join("runtime");
        if runtime.join("docker-compose.yml").is_file()
            || runtime.join("packages/agent/dist/cli.js").is_file()
        {
            return runtime;
        }
        return dir.clone();
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for candidate in [parent.join("resources"), parent.to_path_buf()] {
                if candidate.join("docker-compose.yml").is_file()
                    || candidate.join("packages/agent/dist/cli.js").is_file()
                    || candidate.join("scripts/cococat-stack.ps1").is_file()
                {
                    return candidate;
                }
            }
        }
    }
    source_root()
}

fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> PathBuf {
    let mut fallback = None;
    for candidate in candidates {
        if fallback.is_none() {
            fallback = Some(candidate.clone());
        }
        if candidate.exists() {
            return candidate;
        }
    }
    fallback.unwrap_or_else(resource_root)
}

pub fn app_root() -> PathBuf {
    let resource = resource_root();
    if resource.join("packages/agent/dist/cli.js").is_file()
        || resource.join("docker-compose.yml").is_file()
    {
        return resource;
    }
    let source = source_root();
    if source.join("packages/agent/dist/cli.js").is_file()
        || source.join("docker-compose.yml").is_file()
    {
        return source;
    }
    resource
}

pub fn agent_dist_dir() -> PathBuf {
    let resource = resource_root();
    let source = source_root();
    first_existing([
        resource.join("packages/agent/dist"),
        resource.join("agent/dist"),
        source.join("packages/agent/dist"),
    ])
}

pub fn agent_entry(name: &str) -> PathBuf {
    agent_dist_dir().join(name)
}

pub fn script_path(name: &str) -> PathBuf {
    let resource = resource_root();
    let source = source_root();
    first_existing([
        resource.join("scripts").join(name),
        resource.join(name),
        source.join("scripts").join(name),
    ])
}

pub fn compose_dir() -> PathBuf {
    let resource = resource_root();
    let source = source_root();
    for candidate in [resource.clone(), resource.join("stack"), source.clone()] {
        if candidate.join("docker-compose.yml").is_file() {
            return candidate;
        }
    }
    resource
}

pub fn node_modules_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for root in [resource_root(), source_root()] {
        let dir = root.join("node_modules/.bin");
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}
