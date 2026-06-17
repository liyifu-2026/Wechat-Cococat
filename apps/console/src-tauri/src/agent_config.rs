use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[cfg(unix)]
use fs2::FileExt;

fn home_dir() -> PathBuf {
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
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `12345678@chatroom` → `_12345678_chatroom`
pub fn encode_chat_dir(chat_id: &str) -> String {
    format!("_{}", chat_id.replace('@', "_"))
}

fn chat_dir_path(chat_id: &str) -> PathBuf {
    cococat_data_dir()
        .join("chats")
        .join(encode_chat_dir(chat_id))
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatProfileFile {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_type: Option<String>,
}

#[derive(Deserialize, Default)]
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

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatEscalationStateFile {
    #[serde(default)]
    pub deflect_sent: bool,
    #[serde(default)]
    pub probe_streak: u32,
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

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatMemorySummary {
    pub lines: Vec<String>,
}

fn extract_memory_section_body(persona_md: &str) -> String {
    let marker = "## 相处记忆";
    let start = match persona_md.find(marker) {
        Some(i) => i + marker.len(),
        None => return String::new(),
    };
    let rest = &persona_md[start..];
    let end = rest
        .find("\n## ")
        .map(|i| &rest[..i])
        .unwrap_or(rest);
    end.trim().to_string()
}

fn parse_memory_section(persona_md: &str, max: usize) -> Vec<String> {
    let body = extract_memory_section_body(persona_md);
    if body.is_empty() || body.contains("首次 fork 时为空") {
        return vec![];
    }
    body.lines()
        .map(|l| l.trim().trim_start_matches('-').trim_start_matches('*').trim())
        .filter(|l| !l.is_empty() && !l.starts_with('（'))
        .take(max)
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
pub fn read_chat_memory_summary(
    chat_id: String,
    max_lines: Option<usize>,
) -> Result<ChatMemorySummary, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let limit = max_lines.unwrap_or(3).max(1);
    let path = chat_dir_path(&chat_id).join("persona.md");
    if !path.is_file() {
        return Ok(ChatMemorySummary::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines = parse_memory_section(&raw, limit);
    Ok(ChatMemorySummary { lines })
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

#[derive(Serialize, Deserialize)]
pub struct AgentChatSummary {
    pub chat_id: String,
    pub dir_name: String,
    pub created_at: Option<String>,
    pub last_local_id: Option<u64>,
}

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

#[tauri::command]
pub fn list_agent_chats() -> Result<Vec<AgentChatSummary>, String> {
    let root = cococat_data_dir().join("chats");
    if !root.is_dir() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let meta_path = path.join("meta.json");
        let (chat_id, created_at, last_local_id) = if meta_path.is_file() {
            let raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
            let meta: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("meta.json: {e}"))?;
            let chat_id = meta
                .get("chatId")
                .and_then(|v| v.as_str())
                .unwrap_or(&dir_name)
                .to_string();
            let created_at = meta
                .get("createdAt")
                .and_then(|v| v.as_str())
                .map(String::from);
            let last_local_id = meta.get("lastLocalId").and_then(|v| v.as_u64());
            (chat_id, created_at, last_local_id)
        } else {
            (dir_name.clone(), None, None)
        };
        out.push(AgentChatSummary {
            chat_id,
            dir_name,
            created_at,
            last_local_id,
        });
    }
    out.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.chat_id.cmp(&b.chat_id))
    });
    Ok(out)
}

const AGENT_CHAT_FILES: &[&str] = &[
    "meta.json",
    "persona.md",
    "wiki.json",
    "style.json",
    "transcript.json",
    "profile.json",
    "escalation-state.json",
];

fn validate_agent_chat_path(dir_name: &str, file: &str) -> Result<PathBuf, String> {
    if dir_name.contains('/') || dir_name.contains('\\') || dir_name.contains("..") {
        return Err("invalid chat dir".into());
    }
    if !AGENT_CHAT_FILES.contains(&file) {
        return Err("file not allowed".into());
    }
    Ok(cococat_data_dir().join("chats").join(dir_name).join(file))
}

#[tauri::command]
pub fn read_agent_chat_file(dir_name: String, file: String) -> Result<String, String> {
    let path = validate_agent_chat_path(&dir_name, &file)?;
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_agent_chat_file(
    dir_name: String,
    file: String,
    content: String,
) -> Result<(), String> {
    let path = validate_agent_chat_path(&dir_name, &file)?;
    ensure_parent(&path)?;
    fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))
}

static CHAT_DIR_BIND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn validate_wiki_json(content: &str) -> Result<serde_json::Value, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("wiki.json content required".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("wiki.json: {e}"))?;
    let projects = value
        .get("projects")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "wiki.json must contain a projects array".to_string())?;
    for item in projects {
        if !item.is_string() {
            return Err("wiki.json projects must be strings".into());
        }
    }
    Ok(value)
}

/// Atomically ensure agent chat dir exists, write compliant meta.json (if new), then wiki.json.
/// Serialized with CHAT_DIR_BIND_LOCK to avoid TS/Agent concurrent mkdir races.
#[tauri::command]
pub fn ensure_and_bind_agent_chat_dir(
    chat_id: String,
    wiki_json_content: String,
) -> Result<String, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let wiki = validate_wiki_json(&wiki_json_content)?;
    let _guard = CHAT_DIR_BIND_LOCK
        .lock()
        .map_err(|e| format!("chat bind lock poisoned: {e}"))?;
    let dir = chat_dir_path(&chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_meta(&chat_id, &dir)?;
    let wiki_path = dir.join("wiki.json");
    let serialized = serde_json::to_string_pretty(&wiki)
        .map_err(|e| format!("wiki.json serialize: {e}"))?
        + "\n";
    fs::write(&wiki_path, serialized)
        .map_err(|e| format!("{}: {e}", wiki_path.display()))?;
    Ok(encode_chat_dir(&chat_id))
}

fn read_agent_proxy_enabled_from_style(style_path: &Path) -> Result<bool, String> {
    if !style_path.is_file() {
        return Ok(true);
    }
    let raw = fs::read_to_string(style_path).map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("style.json: {e}"))?;
    Ok(v.get("agentProxyEnabled")
        .and_then(|b| b.as_bool())
        .unwrap_or(true))
}

fn ensure_chat_meta(chat_id: &str, dir: &Path) -> Result<(), String> {
    let meta_path = dir.join("meta.json");
    if meta_path.is_file() {
        return Ok(());
    }
    let meta = serde_json::json!({
        "chatId": chat_id,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    });
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", meta_path.display()))
}

/// Per-chat Agent 代发开关（style.json `agentProxyEnabled`；缺省 true）。
#[tauri::command]
pub fn read_chat_agent_proxy_enabled(chat_id: String) -> Result<bool, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(&chat_id);
    read_agent_proxy_enabled_from_style(&dir.join("style.json"))
}

#[tauri::command]
pub fn set_chat_agent_proxy_enabled(chat_id: String, enabled: bool) -> Result<(), String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let dir = chat_dir_path(&chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_meta(&chat_id, &dir)?;

    let style_path = dir.join("style.json");
    let mut style: serde_json::Value = if style_path.is_file() {
        let raw = fs::read_to_string(&style_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = style.as_object_mut() {
        obj.insert("agentProxyEnabled".to_string(), serde_json::json!(enabled));
    }
    fs::write(
        &style_path,
        serde_json::to_string_pretty(&style).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", style_path.display()))
}

/// Per-chat `## 相处记忆` — 与 Agent `buildSystemPrompt` 注入对齐（SSOT）。
#[tauri::command]
pub fn read_memory_persona(chat_id: String) -> Result<String, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = chat_dir_path(&chat_id).join("persona.md");
    if !path.is_file() {
        return Ok(String::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(extract_memory_section_body(&raw))
}

#[derive(Serialize, Deserialize)]
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

#[derive(Serialize, Deserialize, Clone)]
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

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEventDto {
    pub ts: String,
    pub kind: String,
    #[serde(default)]
    pub chat_id: Option<String>,
    #[serde(default)]
    pub chat_name: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn list_console_events(max_lines: Option<usize>) -> Result<Vec<ConsoleEventDto>, String> {
    let path = cococat_data_dir().join("events.jsonl");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let limit = max_lines.unwrap_or(120).max(1);
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = if lines.len() <= limit {
        lines
    } else {
        lines[lines.len() - limit..].to_vec()
    };
    let mut out = Vec::with_capacity(tail.len());
    for line in tail {
        if let Ok(ev) = serde_json::from_str::<ConsoleEventDto>(line) {
            if !ev.kind.is_empty() && !ev.ts.is_empty() {
                out.push(ev);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn read_chat_wiki_hits(chat_id: String) -> Result<Vec<String>, String> {
    if chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    let path = chat_dir_path(&chat_id).join("wiki-hits.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let hits = json
        .get("hits")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(hits)
}

#[cfg(test)]
mod ensure_bind_tests {
    use super::{encode_chat_dir, validate_wiki_json};

    #[test]
    fn validate_wiki_json_requires_projects_array() {
        assert!(validate_wiki_json(r#"{"projects":["FAQ"]}"#).is_ok());
        assert!(validate_wiki_json(r#"{"projects":[]}"#).is_ok());
        assert!(validate_wiki_json("{}").is_err());
        assert!(validate_wiki_json(r#"{"projects":[1]}"#).is_err());
    }

    #[test]
    fn encode_chat_dir_matches_agent() {
        assert_eq!(encode_chat_dir("12345678@chatroom"), "_12345678_chatroom");
    }
}

#[cfg(test)]
mod memory_section_tests {
    use super::extract_memory_section_body;

    #[test]
    fn extract_memory_section_body_returns_section_only() {
        let md = "## 核心性格\n\n猫\n\n## 相处记忆\n\n- 喜欢咖啡\n- 讨厌早起\n\n## 其他\n\nx";
        assert_eq!(
            extract_memory_section_body(md),
            "- 喜欢咖啡\n- 讨厌早起"
        );
    }
}

#[tauri::command]
pub fn read_stack_log(max_lines: Option<usize>) -> Result<String, String> {
    let path = cococat_data_dir().join("stack/agent.log");
    if !path.is_file() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let limit = max_lines.unwrap_or(80).max(1);
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= limit {
        Ok(content)
    } else {
        Ok(lines[lines.len() - limit..].join("\n"))
    }
}
