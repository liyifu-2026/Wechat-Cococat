//! Native stack orchestrator — driver (docker), memory (gateway), agent (node).
//! Replaces `bash scripts/cococat-stack.sh` for Console Tauri invoke path.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use uuid::Uuid;

use crate::stack;

const DRIVER_URL: &str = "http://127.0.0.1:6174";
const MEMORY_URL: &str = "http://127.0.0.1:8420";
const STOP_GRACE_MS: u64 = 500;

static ORCHESTRATOR: LazyLock<Mutex<StackOrchestrator>> =
    LazyLock::new(|| Mutex::new(StackOrchestrator::new()));

static HTTP: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_else(|_| Client::new())
});

pub struct StackService {
    pub name: &'static str,
    pub pid_path: PathBuf,
}

pub struct StackOrchestrator {
    services: Vec<StackService>,
    agent_log: PathBuf,
}

impl StackOrchestrator {
    pub fn new() -> Self {
        let stack_dir = stack_data_dir().join("stack");
        let _ = fs::create_dir_all(&stack_dir);
        Self {
            services: vec![
                StackService {
                    name: "driver",
                    pid_path: stack_dir.join("driver.pid"),
                },
                StackService {
                    name: "memory",
                    pid_path: stack_dir.join("memory.pid"),
                },
                StackService {
                    name: "agent",
                    pid_path: stack_dir.join("agent.pid"),
                },
            ],
            agent_log: stack_dir.join("agent.log"),
        }
    }

    fn service(&self, name: &str) -> Option<&StackService> {
        self.services.iter().find(|s| s.name == name)
    }

    pub fn execute(&mut self, service: &str, action: &str) -> Result<String, String> {
        match action {
            "status" => self.status(service),
            "start" => self.start(service),
            "stop" => self.stop(service),
            other => Err(format!("Invalid stack action: {other}")),
        }
    }

    pub fn shutdown_all(&mut self) {
        eprintln!("[stack] cascading shutdown…");
        let _ = self.stop_agent();
        let _ = self.stop_memory();
        let _ = self.stop_driver();
        eprintln!("[stack] shutdown complete");
    }

    fn status(&self, service: &str) -> Result<String, String> {
        if service == "all" {
            let lines = [
                self.status_driver(),
                self.status_memory(),
                self.status_agent(),
            ]
            .into_iter()
            .map(|r| r.unwrap_or_else(|e| e))
            .collect::<Vec<_>>();
            return Ok(lines.join("\n"));
        }
        match service {
            "driver" => self.status_driver(),
            "memory" => self.status_memory(),
            "agent" => self.status_agent(),
            other => Err(format!("unknown service: {other}")),
        }
    }

    fn start(&mut self, service: &str) -> Result<String, String> {
        if service == "all" {
            let mut out = Vec::new();
            out.push(self.start_driver()?);
            if let Err(err) = self.start_memory() {
                out.push(format!("memory: optional — {err}"));
            } else if let Ok(line) = self.status_memory() {
                out.push(line);
            }
            out.push(self.start_agent()?);
            return Ok(out.join("\n"));
        }
        match service {
            "driver" => self.start_driver(),
            "memory" => self.start_memory(),
            "agent" => self.start_agent(),
            other => Err(format!("unknown service: {other}")),
        }
    }

    fn stop(&mut self, service: &str) -> Result<String, String> {
        if service == "all" {
            let out = [self.stop_agent(), self.stop_memory(), self.stop_driver()]
                .into_iter()
                .map(|r| r.unwrap_or_else(|e| e))
                .collect::<Vec<_>>();
            return Ok(out.join("\n"));
        }
        match service {
            "driver" => self.stop_driver(),
            "memory" => self.stop_memory(),
            "agent" => self.stop_agent(),
            other => Err(format!("unknown service: {other}")),
        }
    }

    fn status_driver(&self) -> Result<String, String> {
        if driver_api_up() {
            return Ok(format!("driver: up ({DRIVER_URL})"));
        }
        if driver_container_running()? {
            return Err(format!(
                "driver: container running but API unreachable ({DRIVER_URL})"
            ));
        }
        Err("driver: down".into())
    }

    fn status_memory(&self) -> Result<String, String> {
        if memory_health_up() {
            return Ok(format!("memory: up ({MEMORY_URL})"));
        }
        if let Some(svc) = self.service("memory") {
            if let Some(pid) = read_pid(&svc.pid_path) {
                if pid_alive(pid) {
                    return Err(format!("memory: pid {pid} but health failed"));
                }
            }
        }
        Err("memory: down".into())
    }

    fn status_agent(&self) -> Result<String, String> {
        let svc = self
            .service("agent")
            .ok_or("agent service not configured")?;
        if let Some(pid) = read_pid(&svc.pid_path) {
            if pid_alive(pid) {
                return Ok(format!("agent: up pid={pid}"));
            }
            cleanup_stale_pid(&svc.pid_path, pid);
        }
        Err("agent: down".into())
    }

    fn start_driver(&mut self) -> Result<String, String> {
        if driver_api_up() {
            return Ok("driver: already up".into());
        }
        ensure_auth_token()?;
        if let Some(svc) = self.service("driver") {
            if let Some(pid) = read_pid(&svc.pid_path) {
                cleanup_stale_pid(&svc.pid_path, pid);
            }
        }

        if driver_container_running()? && !driver_api_up() {
            if wait_driver_api(30) {
                return self.status_driver();
            }
            run_docker(&["restart", "agent-wechat"])?;
            if wait_driver_api(45) {
                return self.status_driver();
            }
            return Err(format!("driver: API still unreachable ({DRIVER_URL})"));
        }

        if try_start_existing_driver_containers()? && wait_driver_api(45) {
            return self.status_driver();
        }

        run_driver_compose_up()?;
        if wait_driver_api(45) {
            return self.status_driver();
        }
        Err(format!("driver: started but API not ready ({DRIVER_URL})"))
    }

    fn stop_driver(&mut self) -> Result<String, String> {
        let repo = stack::monorepo_root();
        let _ = Command::new("docker")
            .args(["compose", "down"])
            .current_dir(&repo)
            .env("PATH", stack::node_path_env())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = run_docker(&["stop", "agent-wechat"]);
        if let Some(svc) = self.service("driver") {
            let _ = fs::remove_file(&svc.pid_path);
        }
        Ok("driver: stopped".into())
    }

    fn start_memory(&mut self) -> Result<String, String> {
        if memory_health_up() {
            return Ok("memory: already up".into());
        }
        let svc = self
            .service("memory")
            .ok_or("memory service not configured")?;
        if let Some(pid) = read_pid(&svc.pid_path) {
            if pid_alive(pid) {
                cleanup_stale_pid(&svc.pid_path, pid);
            } else {
                let _ = fs::remove_file(&svc.pid_path);
            }
        }

        let memory_data = stack_data_dir().join("memory");
        let _ = fs::create_dir_all(&memory_data);
        let gateway_pid_file = memory_data.join("gateway.pid");
        let env_file = memory_env_file();
        if !env_file.is_file() {
            return Err(format!(
                "Missing {} — copy config/tencentdb-memory.env.example",
                env_file.display()
            ));
        }

        let gateway_root = gateway_root_dir();
        let gateway_src = gateway_root.join("src/gateway/server.ts");
        if !gateway_src.is_file() {
            return Err(format!(
                "Missing gateway source: {} — clone TencentDB-Agent-Memory first",
                gateway_src.display()
            ));
        }

        stop_pid_file(&gateway_pid_file, "gateway", STOP_GRACE_MS);
        let env = load_env_file(&env_file);
        let node = find_node_binary()?;
        let log_file = memory_data.join("gateway.log");
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .map_err(|e| format!("memory log open failed: {e}"))?;

        let mut cmd = Command::new(&node);
        cmd.arg("--import")
            .arg("tsx/esm")
            .arg(&gateway_src)
            .current_dir(&gateway_root)
            .env("PATH", stack::node_path_env())
            .env("TDAI_DATA_DIR", &memory_data)
            .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log))
            .stdin(Stdio::null());
        apply_env_map(&mut cmd, &env);
        if !env.contains_key("TDAI_GATEWAY_HOST") {
            cmd.env("TDAI_GATEWAY_HOST", "127.0.0.1");
        }
        if !env.contains_key("TDAI_GATEWAY_PORT") {
            cmd.env("TDAI_GATEWAY_PORT", "8420");
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("memory gateway spawn failed: {e}"))?;
        let pid = child.id();
        write_pid_atomic(&gateway_pid_file, pid)?;
        write_pid_atomic(&svc.pid_path, pid)?;

        if wait_memory_health(45, pid) {
            return self.status_memory();
        }
        Err("memory: gateway health check timed out".into())
    }

    fn stop_memory(&mut self) -> Result<String, String> {
        let memory_data = stack_data_dir().join("memory");
        stop_pid_file(&memory_data.join("gateway.pid"), "gateway", STOP_GRACE_MS);
        if let Some(svc) = self.service("memory") {
            stop_pid_file(&svc.pid_path, "memory", STOP_GRACE_MS);
        }
        Ok("memory: stopped".into())
    }

    fn start_agent(&mut self) -> Result<String, String> {
        let svc = self
            .service("agent")
            .ok_or("agent service not configured")?;
        if let Some(pid) = read_pid(&svc.pid_path) {
            if pid_alive(pid) {
                return Ok(format!("agent: already up pid={pid}"));
            }
            cleanup_stale_pid(&svc.pid_path, pid);
        }

        if !driver_api_up() {
            // Driver may be slow to respond after container start —
            // give it a short grace window instead of failing immediately.
            if !wait_driver_api(15) {
                return Err("agent: driver not up — start driver first".into());
            }
        }

        let token = stack::read_cococat_token()?;
        let repo = stack::monorepo_root();
        let agent_cli = repo.join("packages/agent/dist/cli.js");
        if !agent_cli.is_file() {
            return Err(format!(
                "agent: missing {} — run: pnpm --filter @cococat/agent build",
                agent_cli.display()
            ));
        }

        let config_dir = config_dir();
        let data_dir = stack_data_dir();
        let mut cmd = Command::new(find_node_binary()?);
        cmd.arg(&agent_cli)
            .current_dir(&repo)
            .env("PATH", stack::node_path_env())
            .env("COCOCAT_CONFIG_DIR", &config_dir)
            .env("COCOCAT_DATA_DIR", &data_dir)
            .env("AGENT_WECHAT_DATA_ROOT", &data_dir)
            .env("AGENT_WECHAT_TOKEN", &token)
            .stdin(Stdio::null());

        for name in ["agent.env", "caption.env"] {
            let path = config_dir.join(name);
            if path.is_file() {
                apply_env_map(&mut cmd, &load_env_file(&path));
            }
        }

        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.agent_log)
            .map_err(|e| format!("agent log open failed: {e}"))?;
        cmd.stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log));

        let child = cmd
            .spawn()
            .map_err(|e| format!("agent spawn failed: {e}"))?;
        let pid = child.id();
        write_pid_atomic(&svc.pid_path, pid)?;
        thread::sleep(Duration::from_secs(2));
        self.status_agent()
    }

    fn stop_agent(&mut self) -> Result<String, String> {
        let svc = self
            .service("agent")
            .ok_or("agent service not configured")?;
        stop_pid_file(&svc.pid_path, "agent", STOP_GRACE_MS);
        Ok("agent: stopped".into())
    }
}

pub fn execute_command(service: &str, action: &str) -> Result<String, String> {
    let mut orch = ORCHESTRATOR
        .lock()
        .map_err(|e| format!("stack orchestrator lock poisoned: {e}"))?;
    orch.execute(service, action)
}

pub fn shutdown_all() {
    if let Ok(mut orch) = ORCHESTRATOR.lock() {
        orch.shutdown_all();
    }
}

fn stack_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_DATA_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".local/share/cococat")
}

fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COCOCAT_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".config/cococat")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn memory_env_file() -> PathBuf {
    let cfg = config_dir();
    let preferred = cfg.join("memory.env");
    if preferred.is_file() {
        return preferred;
    }
    cfg.join("agent.env")
}

fn gateway_root_dir() -> PathBuf {
    if let Ok(root) = std::env::var("TDAI_GATEWAY_ROOT") {
        if !root.trim().is_empty() {
            return PathBuf::from(root);
        }
    }
    stack_data_dir().join("TencentDB-Agent-Memory")
}

fn read_pid(path: &Path) -> Option<u32> {
    let raw = fs::read_to_string(path).ok()?;
    raw.trim().parse().ok().filter(|&p| p > 0)
}

fn write_pid_atomic(path: &Path, pid: u32) -> Result<(), String> {
    let tmp = path.with_extension("pid.tmp");
    fs::write(&tmp, format!("{pid}\n")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub(crate) fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn cleanup_stale_pid(path: &Path, pid: u32) {
    if !pid_alive(pid) {
        let _ = fs::remove_file(path);
    }
}

fn stop_pid_file(path: &Path, name: &str, grace_ms: u64) {
    if let Some(pid) = read_pid(path) {
        signal_stop(pid, grace_ms);
        eprintln!("stopped {name} pid={pid}");
    }
    let _ = fs::remove_file(path);
}

fn signal_stop(pid: u32, grace_ms: u64) {
    if !pid_alive(pid) {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(grace_ms));
    if pid_alive(pid) {
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
}

fn find_node_binary() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("COCOCAT_NODE") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Ok(p) = which::which("node") {
        return Ok(p);
    }
    let home = home_dir();
    let repo = stack::monorepo_root();
    for candidate in [
        home.join(".local/share/cococat/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
        repo.join("node_modules/.bin/node"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Ok(entries) = fs::read_dir(home.join(".nvm/versions/node")) {
        let mut bins: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path().join("bin/node"))
            .filter(|p| p.is_file())
            .collect();
        bins.sort();
        if let Some(latest) = bins.pop() {
            return Ok(latest);
        }
    }
    Err(
        "node not found — install Node or set COCOCAT_NODE (GUI apps often lack PATH)"
            .into(),
    )
}

fn load_env_file(path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(raw) = fs::read_to_string(path) else {
        return out;
    };
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let mut val = v.trim();
            if (val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\''))
            {
                val = &val[1..val.len() - 1];
            }
            if !key.is_empty() {
                out.insert(key.to_string(), val.to_string());
            }
        }
    }
    out
}

fn apply_env_map(cmd: &mut Command, env: &HashMap<String, String>) {
    for (k, v) in env {
        cmd.env(k, v);
    }
}

fn read_auth_token() -> Option<String> {
    let path = config_dir().join("token");
    let raw = fs::read_to_string(path).ok()?;
    let t = raw.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn ensure_auth_token() -> Result<(), String> {
    if read_auth_token().is_some() {
        return Ok(());
    }
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let token = Uuid::new_v4().to_string().replace('-', "");
    let path = dir.join("token");
    fs::write(&path, format!("{token}\n")).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(&path, perms);
        }
    }
    Ok(())
}

fn driver_api_up() -> bool {
    let token = read_auth_token();
    let url = format!("{DRIVER_URL}/api/status");
    let mut req = HTTP.get(&url);
    if let Some(t) = token.filter(|s| !s.is_empty()) {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    req.send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn memory_health_up() -> bool {
    HTTP.get(format!("{MEMORY_URL}/health"))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn wait_driver_api(max_secs: u64) -> bool {
    wait_until(max_secs, driver_api_up)
}

fn wait_memory_health(max_secs: u64, pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(max_secs);
    while Instant::now() < deadline {
        if !pid_alive(pid) {
            return false;
        }
        if memory_health_up() {
            return true;
        }
        thread::sleep(Duration::from_secs(1));
    }
    false
}

fn wait_until(max_secs: u64, mut probe: impl FnMut() -> bool) -> bool {
    for _ in 0..max_secs {
        if probe() {
            return true;
        }
        thread::sleep(Duration::from_secs(1));
    }
    false
}

fn run_docker(args: &[&str]) -> Result<(), String> {
    let status = Command::new("docker")
        .args(args)
        .env("PATH", stack::node_path_env())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("docker {} failed: {e}", args.first().copied().unwrap_or("")))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("docker {} exited {}", args.join(" "), status))
    }
}

fn docker_container_running(name: &str) -> Result<bool, String> {
    let output = Command::new("docker")
        .args(["ps", "-q", "--no-trunc", "-f", &format!("name=^{name}$")])
        .env("PATH", stack::node_path_env())
        .output()
        .map_err(|e| format!("docker ps failed: {e}"))?;
    Ok(!String::from_utf8_lossy(&output.stdout)
        .trim()
        .is_empty())
}

fn driver_container_running() -> Result<bool, String> {
    docker_container_running("agent-wechat")
}

fn try_start_existing_driver_containers() -> Result<bool, String> {
    let redis_id_out = Command::new("docker")
        .args(["ps", "-aq", "-f", "name=^cococat-redis$"])
        .env("PATH", stack::node_path_env())
        .output()
        .map_err(|e| e.to_string())?;
    let redis_id = String::from_utf8_lossy(&redis_id_out.stdout)
        .trim()
        .to_string();
    if !redis_id.is_empty() && !docker_container_running("cococat-redis")? {
        eprintln!("driver: starting existing container cococat-redis");
        run_docker(&["start", "cococat-redis"])?;
    }

    let output = Command::new("docker")
        .args(["ps", "-aq", "-f", "name=^agent-wechat$"])
        .env("PATH", stack::node_path_env())
        .output()
        .map_err(|e| e.to_string())?;
    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if id.is_empty() {
        return Ok(false);
    }
    if driver_container_running()? {
        eprintln!("driver: container agent-wechat already running");
    } else {
        eprintln!("driver: starting existing container agent-wechat");
        run_docker(&["start", "agent-wechat"])?;
    }
    Ok(true)
}

fn run_driver_compose_up() -> Result<(), String> {
    let repo = stack::monorepo_root();
    let data = stack_data_dir();
    let cfg = config_dir();
    let status = Command::new("docker")
        .args(["compose", "up", "-d"])
        .current_dir(&repo)
        .env("PATH", stack::node_path_env())
        .env("COCOCAT_DATA_DIR", &data)
        .env("AGENT_WECHAT_DATA_ROOT", &data)
        .env("COCOCAT_CONFIG_DIR", &cfg)
        .status()
        .map_err(|e| format!("docker compose up failed: {e}"))?;
    if status.success() {
        return Ok(());
    }
    let cli = repo.join("packages/cli/dist/cli.js");
    if cli.is_file() {
        let node = find_node_binary()?;
        let s = Command::new(&node)
            .arg(&cli)
            .arg("up")
            .current_dir(&repo)
            .env("PATH", stack::node_path_env())
            .env("COCOCAT_DATA_DIR", &data)
            .env("COCOCAT_CONFIG_DIR", &cfg)
            .status()
            .map_err(|e| e.to_string())?;
        if s.success() {
            return Ok(());
        }
    }
    Err("driver: docker compose up failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_env_file_parses_key_value() {
        let dir = std::env::temp_dir().join(format!("cococat-env-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.env");
        fs::write(&path, "FOO=bar\n# comment\nBAZ=\"qux\"\n").unwrap();
        let map = load_env_file(&path);
        assert_eq!(map.get("FOO"), Some(&"bar".to_string()));
        assert_eq!(map.get("BAZ"), Some(&"qux".to_string()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn write_pid_atomic_roundtrip() {
        let dir = std::env::temp_dir().join(format!("cococat-pid-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("svc.pid");
        write_pid_atomic(&path, 4242).unwrap();
        assert_eq!(read_pid(&path), Some(4242));
        let _ = fs::remove_dir_all(dir);
    }
}
