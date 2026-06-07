use std::sync::Arc;

use crate::agent::llm::{
    build_assistant_tool_calls, build_system_message,
    build_tool_message, build_user_message, ChatMessage, ContentBlock, ModelProvider, ToolDef,
};
use crate::agent::tools::{ToolContext, ToolRegistry};
use serde_json::Value;

const MAX_TOOL_ROUNDS: usize = 10;

pub struct AgentLoop {
    model: Box<dyn ModelProvider>,
    tools: Arc<ToolRegistry>,
    system_prompt: String,
}

impl AgentLoop {
    pub fn new(
        model: Box<dyn ModelProvider>,
        tools: Arc<ToolRegistry>,
        system_prompt: String,
    ) -> Self {
        Self {
            model,
            tools,
            system_prompt,
        }
    }

    pub async fn process(
        &self,
        user_text: &str,
        history: &[ChatMessage],
        image_base64: Option<&str>,
    ) -> Result<String, String> {
        let mut messages = vec![build_system_message(&self.system_prompt)];
        messages.extend_from_slice(history);

        if let Some(img) = image_base64 {
            messages.push(build_user_with_image(user_text, img));
        } else {
            messages.push(build_user_message(user_text));
        }

        let tool_defs = self.tools.definitions();

        for _round in 0..MAX_TOOL_ROUNDS {
            let resp = self.model.chat(&messages, &tool_defs).await?;

            if let Some(tool_calls) = &resp.tool_calls {
                let tcs = tool_calls.clone();
                messages.push(build_assistant_tool_calls(tcs));

                let ctx = ToolContext::load_async().await;

                for tc in tool_calls {
                    let args: Value = serde_json::from_str(&tc.function.arguments)
                        .unwrap_or(Value::Null);

                    let result = match self.tools.execute(&ctx, &tc.function.name, args).await {
                        Ok(text) => text,
                        Err(e) => format!("Error: {e}"),
                    };

                    messages.push(build_tool_message(&tc.id, &result));
                }
            } else if let Some(content) = &resp.content {
                return Ok(content.clone());
            } else {
                return Err("LLM returned no content and no tool calls".into());
            }
        }

        Err("Too many tool-call rounds".into())
    }

    /// Single-turn completion without assistant system prompt or tools (e.g. history summarization).
    pub async fn complete_plain(&self, user_text: &str) -> Result<String, String> {
        let messages = vec![build_user_message(user_text)];
        let resp = self.model.chat(&messages, &[]).await?;
        resp.content
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "LLM returned no content".into())
    }

    pub fn tool_definitions(&self) -> Vec<ToolDef> {
        self.tools.definitions()
    }
}

fn build_user_with_image(text: &str, base64: &str) -> ChatMessage {
    ChatMessage {
        role: "user".into(),
        content: Some(ContentBlock::MultiModal(vec![
            crate::agent::llm::ContentPart::Text {
                text: text.to_string(),
            },
            crate::agent::llm::ContentPart::ImageUrl {
                image_url: crate::agent::llm::ImageUrl {
                    url: format!("data:image/jpeg;base64,{base64}"),
                },
            },
        ])),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}
