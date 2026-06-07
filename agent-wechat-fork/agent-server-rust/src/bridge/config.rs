use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyWithMention {
    Trigger,
    All,
    None,
}

impl ReplyWithMention {
    fn from_env(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "false" | "0" | "no" => Self::None,
            "all" => Self::All,
            _ => Self::Trigger,
        }
    }

    fn from_json(v: &serde_json::Value) -> Self {
        if v.as_bool() == Some(false) {
            Self::None
        } else if v.as_str() == Some("all") {
            Self::All
        } else {
            Self::Trigger
        }
    }
}

#[derive(Debug, Clone)]
pub struct GroupPolicy {
    pub require_mention: bool,
    pub reply_with_mention: ReplyWithMention,
}

impl Default for GroupPolicy {
    fn default() -> Self {
        Self {
            require_mention: true,
            reply_with_mention: ReplyWithMention::Trigger,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub default_policy: GroupPolicy,
    pub group_overrides: HashMap<String, GroupPolicy>,
    pub groups_config_path: String,
    pub group_history_limit: usize,
}

#[derive(Debug, Deserialize, Clone)]
struct GroupsFileEntry {
    #[serde(default)]
    require_mention: Option<bool>,
    #[serde(default)]
    reply_with_mention: Option<serde_json::Value>,
}

impl GroupsFileEntry {
    fn into_policy(self) -> GroupPolicy {
        GroupPolicy {
            require_mention: self.require_mention.unwrap_or(true),
            reply_with_mention: self
                .reply_with_mention
                .as_ref()
                .map(ReplyWithMention::from_json)
                .unwrap_or(ReplyWithMention::Trigger),
        }
    }
}

impl BridgeConfig {
    pub fn load() -> Self {
        let mut default_policy = GroupPolicy {
            require_mention: std::env::var("BRIDGE_REQUIRE_MENTION")
                .map(|v| v != "false" && v != "0")
                .unwrap_or(true),
            reply_with_mention: std::env::var("BRIDGE_REPLY_WITH_MENTION")
                .map(|v| ReplyWithMention::from_env(&v))
                .unwrap_or(ReplyWithMention::Trigger),
        };
        let groups_config_path = std::env::var("BRIDGE_GROUPS_CONFIG")
            .unwrap_or_else(|_| "/data/bridge-groups.json".into());
        let group_history_limit = std::env::var("BRIDGE_GROUP_HISTORY_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50);

        let (group_overrides, wildcard) = load_groups_file(&groups_config_path);
        if let Some(w) = wildcard {
            if let Some(rm) = w.require_mention {
                default_policy.require_mention = rm;
            }
            if let Some(ref rwm) = w.reply_with_mention {
                default_policy.reply_with_mention = ReplyWithMention::from_json(rwm);
            }
        }

        Self {
            default_policy,
            group_overrides,
            groups_config_path,
            group_history_limit,
        }
    }

    pub fn policy_for(&self, chat_id: &str) -> GroupPolicy {
        self.group_overrides
            .get(chat_id)
            .cloned()
            .unwrap_or_else(|| self.default_policy.clone())
    }
}

fn load_groups_file(path: &str) -> (HashMap<String, GroupPolicy>, Option<GroupsFileEntry>) {
    if !Path::new(path).exists() {
        return (HashMap::new(), None);
    }
    let Ok(text) = fs::read_to_string(path) else {
        tracing::warn!("Failed to read bridge groups config: {path}");
        return (HashMap::new(), None);
    };
    let Ok(raw) = serde_json::from_str::<HashMap<String, GroupsFileEntry>>(&text) else {
        tracing::warn!("Failed to parse bridge groups config: {path}");
        return (HashMap::new(), None);
    };
    let wildcard = raw.get("*").cloned();
    let overrides = raw
        .into_iter()
        .filter(|(k, _)| k != "*")
        .map(|(k, entry)| (k, entry.into_policy()))
        .collect();
    (overrides, wildcard)
}
