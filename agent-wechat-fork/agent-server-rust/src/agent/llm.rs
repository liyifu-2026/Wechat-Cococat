use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<ContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ContentBlock {
    Text(String),
    MultiModal(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl {
        image_url: ImageUrl,
    },
    #[serde(rename = "input_audio")]
    InputAudio {
        input_audio: InputAudioData,
    },
    #[serde(rename = "video_url")]
    VideoUrl {
        video_url: VideoUrl,
        #[serde(skip_serializing_if = "Option::is_none")]
        fps: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        media_resolution: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputAudioData {
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoUrl {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub def_type: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone)]
pub struct ModelResponse {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub thinking: Option<String>,
}

#[async_trait::async_trait]
pub trait ModelProvider: Send + Sync {
    async fn chat(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDef],
    ) -> Result<ModelResponse, String>;
}

pub struct MiMoProvider {
    api_key: String,
    base_url: String,
    model: String,
    client: reqwest::Client,
}

impl MiMoProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            base_url: "https://token-plan-cn.xiaomimimo.com/v1".into(),
            model,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }
}

#[async_trait::async_trait]
impl ModelProvider for MiMoProvider {
    async fn chat(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDef],
    ) -> Result<ModelResponse, String> {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": messages,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools).unwrap();
        }

        let resp = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {e}"))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| format!("Read error: {e}"))?;

        if !status.is_success() {
            return Err(format!(
                "API error {}: {}",
                status.as_u16(),
                truncate_to_char_boundary(&text, 500)
            ));
        }

        let json: Value =
            serde_json::from_str(&text).map_err(|e| {
                format!("JSON parse: {e}. Body: {}", truncate_to_char_boundary(&text, 200))
            })?;

        parse_response(&json)
    }
}

fn parse_response(json: &Value) -> Result<ModelResponse, String> {
    let choice = json["choices"]
        .get(0)
        .ok_or_else(|| format!("No choices in response: {}", json))?;

    let msg = &choice["message"];

    let content = msg["content"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let thinking = choice["message"]["thinking"].as_str().map(|s| s.to_string());

    let tool_calls = msg["tool_calls"].as_array().map(|arr| {
        arr.iter()
            .filter_map(|tc| {
                Some(ToolCall {
                    id: tc["id"].as_str()?.to_string(),
                    call_type: tc["type"]
                        .as_str()
                        .unwrap_or("function")
                        .to_string(),
                    function: FunctionCall {
                        name: tc["function"]["name"].as_str()?.to_string(),
                        arguments: tc["function"]["arguments"]
                            .as_str()
                            .unwrap_or("{}")
                            .to_string(),
                    },
                })
            })
            .collect::<Vec<_>>()
    });

    let tool_calls = tool_calls.filter(|v| !v.is_empty());

    Ok(ModelResponse {
        content,
        tool_calls,
        thinking,
    })
}

pub fn build_tool_message(tool_call_id: &str, content: &str) -> ChatMessage {
    ChatMessage {
        role: "tool".into(),
        content: Some(ContentBlock::Text(content.to_string())),
        tool_calls: None,
        tool_call_id: Some(tool_call_id.to_string()),
        name: None,
    }
}

pub fn build_user_message(text: &str) -> ChatMessage {
    ChatMessage {
        role: "user".into(),
        content: Some(ContentBlock::Text(text.to_string())),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

pub fn build_assistant_message(content: &str) -> ChatMessage {
    ChatMessage {
        role: "assistant".into(),
        content: Some(ContentBlock::Text(content.to_string())),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

pub fn build_system_message(content: &str) -> ChatMessage {
    ChatMessage {
        role: "system".into(),
        content: Some(ContentBlock::Text(content.to_string())),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

pub fn build_assistant_tool_calls(tool_calls: Vec<ToolCall>) -> ChatMessage {
    ChatMessage {
        role: "assistant".into(),
        content: None,
        tool_calls: Some(tool_calls),
        tool_call_id: None,
        name: None,
    }
}

pub fn build_user_with_image(text: &str, base64: &str, mime_type: &str) -> ChatMessage {
    ChatMessage {
        role: "user".into(),
        content: Some(ContentBlock::MultiModal(vec![
            ContentPart::Text {
                text: text.to_string(),
            },
            ContentPart::ImageUrl {
                image_url: ImageUrl {
                    url: format!("data:{};base64,{}", mime_type, base64),
                },
            },
        ])),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

fn truncate_to_char_boundary(text: &str, max_len: usize) -> &str {
    if text.len() <= max_len {
        return text;
    }
    let mut end = max_len;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_text_response() {
        let json = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "hello"
                }
            }]
        });

        let resp = parse_response(&json).unwrap();
        assert_eq!(resp.content.as_deref(), Some("hello"));
        assert!(resp.tool_calls.is_none());
    }

    #[test]
    fn test_parse_tool_calls_response() {
        let json = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "wechat_list_chats",
                            "arguments": "{}"
                        }
                    }]
                }
            }]
        });

        let resp = parse_response(&json).unwrap();
        assert!(resp.content.is_none());
        let tcs = resp.tool_calls.unwrap();
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0].id, "call_abc123");
        assert_eq!(tcs[0].function.name, "wechat_list_chats");
        assert_eq!(tcs[0].function.arguments, "{}");
    }

    #[test]
    fn test_parse_multiple_tool_calls() {
        let json = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "wechat_list_chats", "arguments": "{}"}
                        },
                        {
                            "id": "call_2",
                            "type": "function",
                            "function": {"name": "wechat_find_contacts", "arguments": "{\"query\":\"张三\"}"}
                        }
                    ]
                }
            }]
        });

        let resp = parse_response(&json).unwrap();
        let tcs = resp.tool_calls.unwrap();
        assert_eq!(tcs.len(), 2);
        assert_eq!(tcs[0].function.name, "wechat_list_chats");
        assert_eq!(tcs[1].function.name, "wechat_find_contacts");
    }

    #[test]
    fn test_parse_empty_tool_calls_returns_none() {
        let json = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello",
                    "tool_calls": []
                }
            }]
        });

        let resp = parse_response(&json).unwrap();
        assert_eq!(resp.content.as_deref(), Some("Hello"));
        assert!(resp.tool_calls.is_none());
    }

    #[test]
    fn test_build_user_message() {
        let msg = build_user_message("hello");
        assert_eq!(msg.role, "user");
        match msg.content.unwrap() {
            ContentBlock::Text(t) => assert_eq!(t, "hello"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn test_build_user_with_image() {
        let msg = build_user_with_image("what is this?", "abc123base64", "image/jpeg");
        match msg.content.unwrap() {
            ContentBlock::MultiModal(parts) => {
                assert_eq!(parts.len(), 2);
                match &parts[1] {
                    ContentPart::ImageUrl { image_url } => {
                        assert!(image_url.url.contains("data:image/jpeg;base64,abc123base64"));
                    }
                    _ => panic!("expected image_url"),
                }
            }
            _ => panic!("expected multimodal"),
        }
    }

    #[test]
    fn test_tool_def_serialization() {
        let def = ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_list_chats".into(),
                description: "List chats".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        };

        let json = serde_json::to_value(&def).unwrap();
        assert_eq!(json["type"], "function");
        assert_eq!(json["function"]["name"], "wechat_list_chats");
        assert_eq!(json["function"]["parameters"]["type"], "object");
    }

    #[tokio::test]
    async fn test_mimo_provider_mock_server_text_response() {
        use tokio::net::TcpListener;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{}", addr);

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]);

            // Verify the request contains expected fields
            assert!(request.contains("/chat/completions"), "Path should be /chat/completions");
            assert!(request.contains("Bearer test-key"), "Should contain auth header");
            assert!(request.contains("mimo-v2.5"), "Should contain model name");
            assert!(request.contains("hello world"), "Should contain user message");

            let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"hi back\"}}]}";
            socket.write_all(response.as_bytes()).await.unwrap();
        });

        let provider = MiMoProvider::new("test-key".into(), "mimo-v2.5".into())
            .with_base_url(base_url);

        let resp = provider
            .chat(&[build_user_message("hello world")], &[])
            .await
            .unwrap();

        assert_eq!(resp.content.as_deref(), Some("hi back"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_mimo_provider_mock_server_tool_call() {
        use tokio::net::TcpListener;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{}", addr);

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]);

            assert!(request.contains("\"tools\""), "Should contain tools field");

            let response = r#"HTTP/1.1 200 OK\r
Content-Type: application/json\r
\r
{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_x","type":"function","function":{"name":"wechat_list_chats","arguments":"{}"}}]}}]}"#;

            socket.write_all(response.as_bytes()).await.unwrap();
        });

        let provider = MiMoProvider::new("test-key".into(), "mimo-v2.5".into())
            .with_base_url(base_url);

        let tools = vec![ToolDef {
            def_type: "function".into(),
            function: FunctionDef {
                name: "wechat_list_chats".into(),
                description: "List chats".into(),
                parameters: serde_json::json!({}),
            },
        }];

        let resp = provider
            .chat(&[build_user_message("list my chats")], &tools)
            .await
            .unwrap();

        assert!(resp.content.is_none());
        let tcs = resp.tool_calls.unwrap();
        assert_eq!(tcs[0].function.name, "wechat_list_chats");
        server.await.unwrap();
    }
}
