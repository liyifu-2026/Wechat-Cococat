pub mod agent_loop;
pub mod history;
pub mod llm;
pub mod prompt;
pub mod skills;
pub mod tools;
pub mod wiki;

pub use agent_loop::AgentLoop;

#[derive(Clone)]
pub struct AgentConfig {
    pub llm_provider: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub wiki_enabled: bool,
    pub wiki_api_url: String,
    pub wiki_api_token: String,
    pub system_prompt_override: Option<String>,
}

impl AgentConfig {
    pub fn from_env() -> Self {
        Self {
            llm_provider: std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "xiaomi".into()),
            llm_api_key: std::env::var("LLM_API_KEY").unwrap_or_default(),
            llm_model: std::env::var("LLM_MODEL").unwrap_or_else(|_| "mimo-v2.5".into()),
            wiki_enabled: std::env::var("WIKI_ENABLED")
                .map(|v| v == "true")
                .unwrap_or(false),
            wiki_api_url: std::env::var("WIKI_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:19828".into()),
            wiki_api_token: std::env::var("WIKI_API_TOKEN").unwrap_or_default(),
            system_prompt_override: std::env::var("SYSTEM_PROMPT").ok(),
        }
    }
}
