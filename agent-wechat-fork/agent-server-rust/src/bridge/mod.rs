use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::agent::agent_loop::AgentLoop;
use crate::agent::history::HistoryStore;
use crate::agent::llm::ChatMessage;
use crate::agent::prompt::build_system_prompt;
use crate::agent::skills::{format_skills_prompt, load_skills};
use crate::agent::tools::{build_registry, WikiClient};
use crate::agent::wiki::check_wiki_health;

mod chat_processor;
mod config;
mod coordinator;
mod group_buffer;
mod history;
mod login_guard;
mod media;
mod mention_names;
mod message_utils;
mod policy;
mod poller;
mod scheduler;
mod text_utils;

pub(super) const HISTORY_KEEP_RECENT: usize = 15;
pub(super) const HISTORY_COMPRESS_AT: usize = 50;
pub(super) const MAX_CHAT_HISTORIES: usize = 200;
pub(super) const MAX_SEEN_MESSAGES: usize = 10_000;
pub(super) const KEEP_SEEN_MESSAGES: usize = 5_000;
pub(super) const DEBOUNCE_MS: u64 = 1000;
pub(super) const PROCESS_RETRY_SECS: u64 = 2;
pub(super) const POLL_INTERVAL_SECS: u64 = 2;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ProcessChatResult {
    Ok,
    Busy,
}

pub struct BridgeState {
    pub seen_messages: HashSet<String>,
    pub processing_chats: HashSet<String>,
    pub chat_histories: HashMap<String, Vec<ChatMessage>>,
    pub group_buffers: HashMap<String, Vec<serde_json::Value>>,
    pub bridge_config: config::BridgeConfig,
    pub started_at: i64,
    pub llm_api_key: String,
}

impl BridgeState {
    fn new(llm_api_key: String, bridge_config: config::BridgeConfig) -> Self {
        Self {
            seen_messages: HashSet::new(),
            processing_chats: HashSet::new(),
            chat_histories: HashMap::new(),
            group_buffers: HashMap::new(),
            bridge_config,
            started_at: chrono::Utc::now().timestamp_millis(),
            llm_api_key,
        }
    }
}

pub async fn spawn_bridge() {
    let config = crate::agent::AgentConfig::from_env();
    let store = HistoryStore;

    store.prune_stale_histories(7 * 24 * 60 * 60 * 1000);

    let wiki_client = if config.wiki_enabled {
        let wc = WikiClient::new(config.wiki_api_url.clone(), config.wiki_api_token.clone());
        let healthy = check_wiki_health(&wc).await;
        if healthy {
            Some(Arc::new(wc))
        } else {
            None
        }
    } else {
        None
    };

    let skills_prompt = {
        let mut dirs = Vec::new();
        let candidates = [
            "/opt/agent-server/data/skills".to_string(),
            std::env::current_dir()
                .unwrap_or_default()
                .join("data")
                .join("skills")
                .to_string_lossy()
                .to_string(),
        ];
        for d in &candidates {
            if std::path::Path::new(d).exists() {
                dirs.push(d.clone());
            }
        }
        let skills = load_skills(&dirs).await;
        let prompt = format_skills_prompt(&skills);
        if !prompt.is_empty() {
            tracing::info!("Loaded {} skills", skills.len());
        }
        prompt
    };

    let system_prompt = build_system_prompt(config.wiki_enabled, &skills_prompt);
    let registry = build_registry(wiki_client);
    let tools = Arc::new(registry);

    let model = Box::new(crate::agent::llm::MiMoProvider::new(
        config.llm_api_key.clone(),
        config.llm_model.clone(),
    ));

    let agent = Arc::new(AgentLoop::new(model, tools, system_prompt));

    // Non-blocking: a11y verification can take up to 8s; must not delay HTTP bind.
    tokio::spawn(async {
        login_guard::trigger_login().await;
    });

    let bridge_config = config::BridgeConfig::load();
    tracing::info!(
        "Bridge group policy: require_mention={}, reply_with_mention={:?}",
        bridge_config.default_policy.require_mention,
        bridge_config.default_policy.reply_with_mention
    );

    let state = Arc::new(Mutex::new(BridgeState::new(
        config.llm_api_key.clone(),
        bridge_config,
    )));

    {
        let mut s = state.lock().await;
        s.seen_messages = store.load_seen_messages();
        tracing::info!("Loaded {} seen messages", s.seen_messages.len());
    }

    let rx = crate::events::get_sender().subscribe();
    tracing::info!("Bridge subscribed to event bus");

    let scheduler = scheduler::ChatScheduler::new();

    tokio::spawn(coordinator::run_coordinator(
        agent.clone(),
        state.clone(),
        scheduler.clone(),
        rx,
    ));

    tokio::spawn(poller::run_poller(
        agent.clone(),
        state.clone(),
        scheduler.clone(),
    ));


    tracing::info!("Bridge running");
}
