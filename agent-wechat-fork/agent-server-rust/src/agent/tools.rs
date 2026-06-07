use crate::agent::llm::{FunctionDef, ToolDef};
use crate::context::session_ctx::SessionCtx;
use crate::db::get_db;
use crate::ia::types::{Chat, Contact};
use crate::sessions::manager::get_session;
use crate::tools::a11y;
use crate::tools::exec::ExecOptions;
use crate::tools::screenshot::capture_screenshot;
use crate::tools::wechat_chats;
use crate::tools::wechat_contacts;
use crate::tools::wechat_messages;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub struct ToolContext {
    pub logged_in_user: Option<String>,
    pub keys: HashMap<String, String>,
    pub exec_options: ExecOptions,
}

impl ToolContext {
    pub async fn load_async() -> Self {
        let ctx = SessionCtx::load().await;

        let (logged_in_user, keys) = match ctx {
            Ok(c) => {
                let exec_options = ExecOptions {
                    session: Some(c.session.clone()),
                    timeout_ms: 60_000,
                };
                return Self {
                    logged_in_user: Some(c.account_dir),
                    keys: c.keys,
                    exec_options,
                };
            }
            Err(_) => (None, HashMap::new()),
        };

        Self {
            logged_in_user,
            keys,
            exec_options: ExecOptions::default(),
        }
    }

    pub fn is_logged_in(&self) -> bool {
        self.logged_in_user.is_some()
            && self.keys.contains_key("session.db")
            && self.keys.contains_key("contact.db")
    }

    pub fn account_dir(&self) -> Option<&str> {
        self.logged_in_user.as_deref()
    }
}

#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDef;
    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String>;
}

pub struct ToolRegistry {
    tools: Vec<Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    pub fn register<T: Tool + 'static>(&mut self, tool: T) {
        self.tools.push(Arc::new(tool));
    }

    pub fn definitions(&self) -> Vec<ToolDef> {
        self.tools.iter().map(|t| t.definition()).collect()
    }

    pub async fn execute(
        &self,
        ctx: &ToolContext,
        name: &str,
        args: Value,
    ) -> Result<String, String> {
        for tool in &self.tools {
            if tool.definition().function.name == name {
                return tool.execute(ctx, args).await;
            }
        }
        Err(format!("Unknown tool: {name}"))
    }

    pub fn json_definitions(&self) -> Vec<Value> {
        self.definitions()
            .iter()
            .map(|d| serde_json::to_value(d).unwrap_or_default())
            .collect()
    }
}

fn json_args<T: serde::de::DeserializeOwned>(args: &Value) -> Result<T, String> {
    serde_json::from_value(args.clone()).map_err(|e| format!("Invalid arguments: {e}"))
}

fn json_obj() -> Value {
    serde_json::json!({"type": "object", "properties": {}, "required": []})
}

fn json_obj_with(props: Value) -> Value {
    serde_json::json!({"type": "object", "properties": props, "required": []})
}

// ============================================================
// WeChat tools
// ============================================================

struct WechatListChats;
#[async_trait::async_trait]
impl Tool for WechatListChats {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_list_chats".into(),
                description: "List your recent WeChat chats with unread messages.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, _args: Value) -> Result<String, String> {
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let chats = wechat_chats::list_chats(dir, &ctx.keys, 200, 0);
        let text = if chats.is_empty() {
            "No chats found".into()
        } else {
            chats
                .iter()
                .map(|c| {
                    let unread = if c.unread_count > 0 {
                        format!(", {} unread", c.unread_count)
                    } else {
                        String::new()
                    };
                    format!("- {} (ID: {}{})", c.name, c.id, unread)
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        Ok(text)
    }
}

struct WechatReadMessages;
#[async_trait::async_trait]
impl Tool for WechatReadMessages {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_read_messages".into(),
                description: "Read recent messages from a chat.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "chatId": {"type": "string", "description": "Chat ID"}
                })),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let chat_id = args["chatId"].as_str().ok_or("Missing chatId")?;
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let msgs = wechat_messages::list_messages(dir, &ctx.keys, chat_id, 50, 0);
        let text = if msgs.is_empty() {
            "No messages".into()
        } else {
            msgs.iter()
                .map(|m| {
                    let sender = m.sender_name.as_deref().unwrap_or("");
                    let sender = if sender.is_empty() {
                        m.sender.as_deref().unwrap_or("Unknown")
                    } else {
                        sender
                    };
                    format!("[{}]: {}", sender, m.content)
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        Ok(text)
    }
}

struct WechatSendImage;
#[async_trait::async_trait]
impl Tool for WechatSendImage {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_send_image".into(),
                description: "Send an image to a WeChat chat by file path.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "chatId": {"type": "string", "description": "Chat ID"},
                    "filePath": {"type": "string", "description": "Local file path of the image"}
                })),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let chat_id = args["chatId"].as_str().ok_or("Missing chatId")?;
        let file_path = args["filePath"].as_str().ok_or("Missing filePath")?;

        let bytes = tokio::fs::read(file_path)
            .await
            .map_err(|e| format!("Cannot read file: {e}"))?;
        let base64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &bytes,
        );

        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let mime = match ext {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/png",
        };

        send_wechat_message(ctx, chat_id, None, Some(&base64), mime, None, None, None).await?;
        Ok(format!("Image sent to {chat_id}"))
    }
}

struct WechatFindChats;
#[async_trait::async_trait]
impl Tool for WechatFindChats {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_find_chats".into(),
                description: "Search WeChat chats by name.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "query": {"type": "string", "description": "Search query"}
                })),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let query = args["query"].as_str().ok_or("Missing query")?;
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let chats = wechat_chats::list_chats(dir, &ctx.keys, 500, 0);
        let q = query.to_lowercase();
        let matched: Vec<&Chat> = chats
            .iter()
            .filter(|c| {
                c.name.to_lowercase().contains(&q)
                    || c.id.to_lowercase().contains(&q)
                    || c.remark.as_deref().map(|r| r.to_lowercase().contains(&q)).unwrap_or(false)
            })
            .collect();

        if matched.is_empty() {
            Ok(format!("No chats found matching \"{query}\""))
        } else {
            Ok(matched
                .iter()
                .map(|c| format!("- {} (ID: {})", c.name, c.id))
                .collect::<Vec<_>>()
                .join("\n"))
        }
    }
}

struct WechatListContacts;
#[async_trait::async_trait]
impl Tool for WechatListContacts {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_list_contacts".into(),
                description: "List all WeChat contacts.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let _ = args;
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let contacts = wechat_contacts::list_contacts(dir, &ctx.keys, 500, 0);
        if contacts.is_empty() {
            Ok("No contacts found".into())
        } else {
            Ok(contacts
                .iter()
                .map(|c| {
                    let name = c.remark.as_deref().filter(|r| !r.is_empty()).unwrap_or(&c.nick_name);
                    format!("- {} (ID: {})", name, c.username)
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
    }
}

struct WechatFindContacts;
#[async_trait::async_trait]
impl Tool for WechatFindContacts {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_find_contacts".into(),
                description: "Search WeChat contacts by name.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "query": {"type": "string", "description": "Search query"}
                })),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let query = args["query"].as_str().ok_or("Missing query")?;
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let contacts = wechat_contacts::list_contacts(dir, &ctx.keys, 500, 0);
        let q = query.to_lowercase();
        let matched: Vec<&Contact> = contacts
            .iter()
            .filter(|c| {
                c.nick_name.to_lowercase().contains(&q)
                    || c.remark.as_deref().map(|r| r.to_lowercase().contains(&q)).unwrap_or(false)
                    || c.username.to_lowercase().contains(&q)
            })
            .collect();

        if matched.is_empty() {
            Ok(format!("No contacts found matching \"{query}\""))
        } else {
            Ok(matched
                .iter()
                .map(|c| {
                    let name = c.remark.as_deref().filter(|r| !r.is_empty()).unwrap_or(&c.nick_name);
                    format!("- {} (ID: {})", name, c.username)
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
    }
}

struct WechatGetChat;
#[async_trait::async_trait]
impl Tool for WechatGetChat {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_get_chat".into(),
                description: "Get detailed information about a specific chat.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "chatId": {"type": "string", "description": "Chat ID"}
                })),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, args: Value) -> Result<String, String> {
        let chat_id = args["chatId"].as_str().ok_or("Missing chatId")?;
        let dir = ctx.account_dir().ok_or("Not logged in")?;
        let chats = wechat_chats::list_chats(dir, &ctx.keys, 500, 0);
        let found = chats.iter().find(|c| c.id == chat_id);
        match found {
            Some(c) => {
                let json = serde_json::json!({
                    "id": c.id,
                    "name": c.name,
                    "isGroup": c.is_group,
                    "unreadCount": c.unread_count,
                    "lastActivityAt": c.last_activity_at,
                });
                Ok(serde_json::to_string_pretty(&json).unwrap_or_default())
            }
            None => Ok(format!("Chat {chat_id} not found")),
        }
    }
}

struct WechatScreenshot;
#[async_trait::async_trait]
impl Tool for WechatScreenshot {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_screenshot".into(),
                description: "Take a screenshot of the current WeChat interface. Returns file path for sending.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, _args: Value) -> Result<String, String> {
        let base64_str = capture_screenshot(&ctx.exec_options).await?;

        let dir = std::path::Path::new("/tmp");
        tokio::fs::create_dir_all(dir).await.ok();
        let file_path = format!("/tmp/screenshot_{}.png", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());

        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &base64_str,
        )
        .map_err(|e| format!("Decode error: {e}"))?;
        tokio::fs::write(&file_path, &bytes)
            .await
            .map_err(|e| format!("Write error: {e}"))?;

        let size_kb = bytes.len() / 1024;
        Ok(format!("Screenshot saved: {file_path} ({size_kb}KB). Use wechat_send_image to send it."))
    }
}

struct WechatA11y;
#[async_trait::async_trait]
impl Tool for WechatA11y {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_a11y".into(),
                description: "Get the accessibility tree of the WeChat interface for debugging.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, ctx: &ToolContext, _args: Value) -> Result<String, String> {
        let tree = a11y::get_a11y_desktop(&ctx.exec_options).await?;
        let json = serde_json::to_string_pretty(&tree).unwrap_or_default();
        Ok(json)
    }
}

// ============================================================
// General tools
// ============================================================

struct ListFiles;
#[async_trait::async_trait]
impl Tool for ListFiles {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "list_files".into(),
                description: "List files in a directory. Use before sending images to find available files.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "dirPath": {"type": "string", "description": "Directory path"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let dir_path = args["dirPath"].as_str().ok_or("Missing dirPath")?;
        let mut entries = tokio::fs::read_dir(dir_path)
            .await
            .map_err(|e| format!("Cannot read dir: {e}"))?;
        let mut files = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.file_type().await.map(|t| t.is_file()).unwrap_or(false) {
                files.push(entry.file_name().to_string_lossy().to_string());
            }
        }
        files.truncate(50);
        if files.is_empty() {
            Ok(format!("No files found in {dir_path}"))
        } else {
            Ok(files.join("\n"))
        }
    }
}

struct BashTool;
#[async_trait::async_trait]
impl Tool for BashTool {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "bash".into(),
                description: "Execute a shell command. Use for running scripts, processing files, etc.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "command": {"type": "string", "description": "Shell command"},
                    "workdir": {"type": "string", "description": "Working directory (optional)"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let command = args["command"].as_str().ok_or("Missing command")?;
        let workdir = args["workdir"].as_str();

        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", command]);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.args(["-c", command]);
            c
        };

        if let Some(dir) = workdir {
            cmd.current_dir(dir);
        }
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("Command failed: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let mut result = String::new();
        if !stdout.is_empty() {
            result.push_str(stdout.trim());
        }
        if !stderr.is_empty() {
            if !result.is_empty() {
                result.push_str("\n[stderr]\n");
            }
            result.push_str(stderr.trim());
        }
        if result.is_empty() {
            result = "(no output)".into();
        }

        let max_len = 4000;
        if result.len() > max_len {
            result.truncate(char_boundary(&result, max_len));
            result.push_str("\n...(truncated)");
        }
        Ok(result)
    }
}

struct ReadFile;
#[async_trait::async_trait]
impl Tool for ReadFile {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "read".into(),
                description: "Read a file from the filesystem.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "filePath": {"type": "string", "description": "Absolute path to file"},
                    "offset": {"type": "number", "description": "Line number to start from (1-indexed)"},
                    "limit": {"type": "number", "description": "Max lines to read"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let file_path = args["filePath"].as_str().ok_or("Missing filePath")?;
        let offset = args["offset"].as_u64().unwrap_or(1) as usize;
        let limit = args["limit"].as_u64().map(|l| l as usize);

        let content = tokio::fs::read_to_string(file_path)
            .await
            .map_err(|e| format!("Read failed: {e}"))?;
        let lines: Vec<&str> = content.lines().collect();
        let start = (offset.saturating_sub(1)).min(lines.len());
        let end = limit.map(|l| (start + l).min(lines.len())).unwrap_or(lines.len());
        let sliced = &lines[start..end];
        let total = lines.len();

        let text = sliced.join("\n");
        let max_len = 4000;
        let preview = if text.len() > max_len {
            format!(
                "{}\n...(truncated, {total} lines total)",
                truncate_to_char_boundary(&text, max_len)
            )
        } else if text.is_empty() {
            "(empty file)".into()
        } else {
            text
        };
        Ok(preview)
    }
}

struct WriteFile;
#[async_trait::async_trait]
impl Tool for WriteFile {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "write".into(),
                description: "Write content to a file.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "filePath": {"type": "string", "description": "Absolute path to file"},
                    "content": {"type": "string", "description": "Content to write"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let file_path = args["filePath"].as_str().ok_or("Missing filePath")?;
        let content = args["content"].as_str().ok_or("Missing content")?;
        if let Some(parent) = std::path::Path::new(file_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create dir: {e}"))?;
        }
        tokio::fs::write(file_path, content)
            .await
            .map_err(|e| format!("Write failed: {e}"))?;
        Ok(format!("File written: {file_path} ({} bytes)", content.len()))
    }
}

struct GrepTool;
#[async_trait::async_trait]
impl Tool for GrepTool {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "grep".into(),
                description: "Search for a pattern in files.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "pattern": {"type": "string", "description": "Regex pattern"},
                    "path": {"type": "string", "description": "Directory or file to search"},
                    "include": {"type": "string", "description": "File pattern, e.g. *.js"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let pattern = args["pattern"].as_str().ok_or("Missing pattern")?;
        let search_path = args["path"].as_str().unwrap_or(".");
        let include = args["include"].as_str();

        let re = regex::Regex::new(&format!("(?i){pattern}"))
            .map_err(|e| format!("Invalid regex: {e}"))?;

        let mut results = Vec::new();
        let max_results = 30;
        search_files(search_path, include, &re, &mut results, max_results).await?;

        if results.is_empty() {
            Ok(format!("No matches for \"{pattern}\" in {search_path}"))
        } else {
            let text = results.join("\n");
            if results.len() >= max_results {
                Ok(format!("{text}\n...(max {max_results} results)"))
            } else {
                Ok(text)
            }
        }
    }
}

async fn search_files(
    dir: &str,
    include: Option<&str>,
    re: &regex::Regex,
    results: &mut Vec<String>,
    max: usize,
) -> Result<(), String> {
    let mut entries = tokio::fs::read_dir(dir)
        .await
        .map_err(|e| format!("Cannot read dir: {e}"))?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        if results.len() >= max {
            return Ok(());
        }
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.starts_with('.') || file_name == "node_modules" || file_name == "target" {
            continue;
        }

        let ft = entry.file_type().await.unwrap_or(std::fs::FileType::from(std::fs::metadata(".").unwrap().file_type()));

        if ft.is_dir() {
            let full = path.to_string_lossy().to_string();
            Box::pin(search_files(&full, include, re, results, max)).await?;
        } else if ft.is_file() {
            if let Some(inc) = include {
                let ext = inc.trim_start_matches('*');
                if !file_name.ends_with(ext) && inc != "*" {
                    continue;
                }
            }

            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                for line in content.lines() {
                    if results.len() >= max {
                        return Ok(());
                    }
                    if re.is_match(line) {
                        let truncated = if line.len() > 120 {
                            format!("{}...", truncate_to_char_boundary(line, 120))
                        } else {
                            line.to_string()
                        };
                        results.push(format!("{}: {}", path.display(), truncated));
                    }
                }
            }
        }
    }
    Ok(())
}

// ============================================================
// Wiki tools
// ============================================================

pub struct WikiClient {
    pub api_url: String,
    pub api_token: String,
}

impl WikiClient {
    pub fn new(api_url: String, api_token: String) -> Self {
        Self { api_url, api_token }
    }
}

struct WikiSearch { client: Option<Arc<WikiClient>> }
#[async_trait::async_trait]
impl Tool for WikiSearch {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wiki_search".into(),
                description: "Search the knowledge base for relevant pages.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "query": {"type": "string", "description": "Search query"},
                    "topK": {"type": "number", "description": "Max results (1-20, default 5)"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Wiki not configured")?;
        let query = args["query"].as_str().unwrap_or("");
        let top_k = args["topK"].as_u64().unwrap_or(5) as usize;
        wiki_search(&client, query, top_k).await
    }
}

struct WikiReadPage { client: Option<Arc<WikiClient>> }
#[async_trait::async_trait]
impl Tool for WikiReadPage {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wiki_read_page".into(),
                description: "Read a specific wiki page by path.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "path": {"type": "string", "description": "Page path, e.g. wiki/concepts/ml.md"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Wiki not configured")?;
        let path = args["path"].as_str().ok_or("Missing path")?;
        wiki_read_page(&client, path).await
    }
}

struct WikiGetGraph { client: Option<Arc<WikiClient>> }
#[async_trait::async_trait]
impl Tool for WikiGetGraph {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wiki_get_graph".into(),
                description: "Get nodes and edges from the knowledge graph.".into(),
                parameters: json_obj_with(serde_json::json!({
                    "query": {"type": "string", "description": "Optional keyword filter"},
                    "limit": {"type": "number", "description": "Max nodes (default 50)"}
                })),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, args: Value) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Wiki not configured")?;
        let query = args["query"].as_str().unwrap_or("");
        let limit = args["limit"].as_u64().unwrap_or(50) as usize;
        wiki_get_graph(&client, query, limit).await
    }
}

struct WikiRescan { client: Option<Arc<WikiClient>> }
#[async_trait::async_trait]
impl Tool for WikiRescan {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wiki_rescan".into(),
                description: "Trigger re-scan of source documents.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, _args: Value) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Wiki not configured")?;
        wiki_rescan(&client).await
    }
}

struct WikiListProjects { client: Option<Arc<WikiClient>> }
#[async_trait::async_trait]
impl Tool for WikiListProjects {
    fn definition(&self) -> ToolDef {
        ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wiki_list_projects".into(),
                description: "List available wiki projects.".into(),
                parameters: json_obj(),
            },
        }
    }

    async fn execute(&self, _ctx: &ToolContext, _args: Value) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Wiki not configured")?;
        wiki_list_projects(&client).await
    }
}

// ============================================================
// Wiki HTTP client
// ============================================================

async fn wiki_auth_headers(client: &WikiClient) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if !client.api_token.is_empty() {
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", client.api_token)) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
    }
    headers
}

async fn wiki_request(
    client: &WikiClient,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("{}/api/v1{}", client.api_url, path);
    let headers = wiki_auth_headers(client).await;
    let http_client = reqwest::Client::new();

    let req = match method {
        "GET" => http_client.get(&url).headers(headers),
        "POST" => {
            let mut r = http_client.post(&url).headers(headers);
            if let Some(b) = body {
                r = r.json(&b);
            }
            r
        }
        _ => return Err(format!("Unsupported method: {method}")),
    };

    let resp = req.send().await.map_err(|e| format!("Wiki HTTP error: {e}"))?;
    let json: Value = resp.json().await.map_err(|e| format!("Wiki JSON error: {e}"))?;

    if let Some(ok) = json.get("ok") {
        if ok.as_bool() == Some(false) {
            return Err(json["error"].as_str().unwrap_or("unknown error").into());
        }
    }

    Ok(json)
}

async fn wiki_resolve_project_id(client: &WikiClient) -> Result<String, String> {
    let r = wiki_request(client, "GET", "/projects", None).await?;
    let projects = r["projects"].as_array().ok_or("No projects found")?;
    let current = projects.iter().find(|p| p["current"].as_bool() == Some(true));
    if let Some(c) = current {
        Ok(c["id"].as_str().unwrap_or("").to_string())
    } else if let Some(first) = projects.first() {
        Ok(first["id"].as_str().unwrap_or("").to_string())
    } else {
        Err("No wiki projects found".into())
    }
}

async fn wiki_search(client: &WikiClient, query: &str, top_k: usize) -> Result<String, String> {
    let project_id = wiki_resolve_project_id(client).await?;
    let r = wiki_request(
        client,
        "POST",
        &format!("/projects/{project_id}/search"),
        Some(serde_json::json!({"query": query, "topK": top_k, "includeContent": true})),
    )
    .await?;

    let results = r["results"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);
    if results.is_empty() {
        return Ok(format!("No wiki pages found for \"{query}\"."));
    }

    let text = results
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let path = r["path"].as_str().unwrap_or("?");
            let score = r["score"].as_f64().unwrap_or(0.0);
            let content = r["content"].as_str().unwrap_or("");
            let preview = if content.len() > 500 {
                format!("{}...", truncate_to_char_boundary(content, 500))
            } else {
                content.to_string()
            };
            format!("[{}] {} (score: {:.3})\n{}", i + 1, path, score, preview)
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    Ok(text)
}

async fn wiki_read_page(client: &WikiClient, path: &str) -> Result<String, String> {
    let project_id = wiki_resolve_project_id(client).await?;
    let r = wiki_request(
        client,
        "GET",
        &format!("/projects/{project_id}/files/content?path={}", urlencoding(path)),
        None,
    )
    .await?;
    Ok(r["content"].as_str().unwrap_or("(empty page)").to_string())
}

async fn wiki_get_graph(client: &WikiClient, query: &str, limit: usize) -> Result<String, String> {
    let project_id = wiki_resolve_project_id(client).await?;
    let path = if query.is_empty() {
        format!("/projects/{project_id}/graph?limit={limit}")
    } else {
        let q = urlencoding(query);
        format!("/projects/{project_id}/graph?q={q}&limit={limit}")
    };
    let r = wiki_request(client, "GET", &path, None).await?;
    let nodes = r["nodes"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);
    let edges = r["edges"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);

    if nodes.is_empty() {
        return Ok("No graph data found.".into());
    }

    let node_list: Vec<String> = nodes
        .iter()
        .take(20)
        .map(|n| {
            format!(
                "- {} ({}, {} links)",
                n["label"].as_str().unwrap_or("?"),
                n["type"].as_str().unwrap_or("?"),
                n["linkCount"].as_u64().unwrap_or(0)
            )
        })
        .collect();

    let edge_list: Vec<String> = edges
        .iter()
        .take(20)
        .map(|e| {
            let src = nodes
                .iter()
                .find(|n| n["id"] == e["source"])
                .and_then(|n| n["label"].as_str())
                .unwrap_or("?");
            let tgt = nodes
                .iter()
                .find(|n| n["id"] == e["target"])
                .and_then(|n| n["label"].as_str())
                .unwrap_or("?");
            let w = e["weight"].as_f64().unwrap_or(0.0);
            format!("- {src} -> {tgt} (w:{w:.1})")
        })
        .collect();

    Ok(format!(
        "Graph: {} nodes, {} edges\n\nNodes:\n{}\n\nEdges:\n{}",
        nodes.len(),
        edges.len(),
        node_list.join("\n"),
        edge_list.join("\n")
    ))
}

async fn wiki_rescan(client: &WikiClient) -> Result<String, String> {
    let project_id = wiki_resolve_project_id(client).await?;
    let r = wiki_request(
        client,
        "POST",
        &format!("/projects/{project_id}/sources/rescan"),
        None,
    )
    .await?;
    let added = r["added"].as_u64().unwrap_or(0);
    let modified = r["modified"].as_u64().unwrap_or(0);
    let deleted = r["deleted"].as_u64().unwrap_or(0);
    Ok(format!("Sources rescanned: {added} added, {modified} modified, {deleted} deleted."))
}

async fn wiki_list_projects(client: &WikiClient) -> Result<String, String> {
    let r = wiki_request(client, "GET", "/projects", None).await?;
    let projects = r["projects"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);
    if projects.is_empty() {
        return Ok("No wiki projects found.".into());
    }
    let text = projects
        .iter()
        .map(|p| {
            let name = p["name"].as_str().unwrap_or("unknown");
            let is_current = if p["current"].as_bool() == Some(true) {
                " (active)"
            } else {
                ""
            };
            let path = p["path"].as_str().unwrap_or("");
            format!("- {name}{is_current} -> {path}")
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(text)
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' => c.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn char_boundary(text: &str, max_len: usize) -> usize {
    if text.len() <= max_len {
        return text.len();
    }
    let mut end = max_len;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    end
}

fn truncate_to_char_boundary(text: &str, max_len: usize) -> &str {
    &text[..char_boundary(text, max_len)]
}

// ============================================================
// Send helper (text via FSM)
// ============================================================

pub async fn send_wechat_message(
    _ctx: &ToolContext,
    chat_id: &str,
    text: Option<&str>,
    image_data: Option<&str>,
    image_mime: &str,
    file_data: Option<&str>,
    file_filename: Option<&str>,
    mentions: Option<&[String]>,
) -> Result<(), String> {
    use crate::context::create_context;
    use crate::execution::run_execution_loop;
    use crate::execution::sys_impl::production_impls;
    use crate::ia::types::SubscriptionEvent;
    use crate::plans::send_message::{SendMessageParams, SendMessagePlan};

    let session = get_session("default").ok_or("No session")?;

    let mut image_path: Option<String> = None;
    let mut image_mime_val: Option<String> = None;
    if let Some(data) = image_data {
        let ext = match image_mime {
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            _ => "png",
        };
        let path = format!("/tmp/send_image_{}.{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), ext);
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| format!("Decode: {e}"))?;
        tokio::fs::write(&path, &bytes).await.map_err(|e| format!("Write: {e}"))?;
        image_mime_val = Some(image_mime.to_string());
        image_path = Some(path);
    }

    let mut file_path: Option<String> = None;
    if let Some(data) = file_data {
        let fname = file_filename.unwrap_or("file");
        let safe: String = fname.chars().map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }
        }).collect();
        let path = format!("/tmp/send_file_{}_{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), safe);
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| format!("Decode: {e}"))?;
        tokio::fs::write(&path, &bytes).await.map_err(|e| format!("Write: {e}"))?;
        file_path = Some(path);
    }

    let mut context = {
        let db = get_db();
        create_context(session.clone(), &db)
    };
    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: chat_id.to_string(),
        message: text.map(|t| t.to_string()),
        image_path: image_path.clone(),
        image_mime: image_mime_val,
        file_path: file_path.clone(),
        mentions: mentions.unwrap_or(&[]).to_vec(),
    };
    let cancel = tokio_util::sync::CancellationToken::new();
    let noop_emit = |_: SubscriptionEvent| {};
    let (observer, executor) = production_impls(&session);

    let (result, _) = run_execution_loop(&plan, &params, &mut context, &observer, &executor, &noop_emit, cancel).await;

    if let Some(p) = &image_path { let _ = tokio::fs::remove_file(p).await; }
    if let Some(p) = &file_path { let _ = tokio::fs::remove_file(p).await; }

    if !result.success {
        Err(result.error.unwrap_or_else(|| "Send failed".into()))
    } else {
        Ok(())
    }
}

// ============================================================
// Registry builder
// ============================================================

pub fn build_registry(wiki: Option<Arc<WikiClient>>) -> ToolRegistry {
    let mut reg = ToolRegistry::new();

    reg.register(WechatListChats);
    reg.register(WechatReadMessages);
    reg.register(WechatSendImage);
    reg.register(WechatFindChats);
    reg.register(WechatListContacts);
    reg.register(WechatFindContacts);
    reg.register(WechatGetChat);
    reg.register(WechatScreenshot);
    reg.register(WechatA11y);

    reg.register(ListFiles);
    reg.register(BashTool);
    reg.register(ReadFile);
    reg.register(WriteFile);
    reg.register(GrepTool);

    if let Some(w) = wiki {
        let w = Some(w.clone());
        reg.register(WikiSearch { client: w.clone() });
        reg.register(WikiReadPage { client: w.clone() });
        reg.register(WikiGetGraph { client: w.clone() });
        reg.register(WikiRescan { client: w.clone() });
        reg.register(WikiListProjects { client: w.clone() });
    }

    reg
}
