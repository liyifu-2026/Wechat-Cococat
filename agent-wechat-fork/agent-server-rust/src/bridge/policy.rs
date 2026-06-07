use super::config::{GroupPolicy, ReplyWithMention};
use super::mention_names::is_mentionable_display_name;

#[derive(Debug, Clone)]
pub struct MentionSegment {
    pub sender_name: String,
    pub is_mentioned: bool,
}

pub fn should_skip_group_message(require_mention: bool, was_mentioned: bool) -> bool {
    require_mention && !was_mentioned
}

pub fn resolve_reply_mentions(
    segment: &[MentionSegment],
    policy: &GroupPolicy,
) -> Option<Vec<String>> {
    match policy.reply_with_mention {
        ReplyWithMention::None => None,
        ReplyWithMention::All => {
            let mut names = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for entry in segment {
                if !entry.is_mentioned {
                    continue;
                }
                if !is_mentionable_display_name(&entry.sender_name) || seen.contains(&entry.sender_name)
                {
                    continue;
                }
                seen.insert(entry.sender_name.clone());
                names.push(entry.sender_name.clone());
            }
            if names.is_empty() {
                None
            } else {
                Some(names)
            }
        }
        ReplyWithMention::Trigger => {
            let trigger = segment
                .iter()
                .rev()
                .find(|e| e.is_mentioned)
                .or_else(|| segment.last())?;
            if !is_mentionable_display_name(&trigger.sender_name) {
                return None;
            }
            Some(vec![trigger.sender_name.clone()])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::config::GroupPolicy;

    fn seg(name: &str, mentioned: bool) -> MentionSegment {
        MentionSegment {
            sender_name: name.into(),
            is_mentioned: mentioned,
        }
    }

    #[test]
    fn test_skip_without_mention() {
        assert!(should_skip_group_message(true, false));
        assert!(!should_skip_group_message(true, true));
        assert!(!should_skip_group_message(false, false));
    }

    #[test]
    fn test_resolve_trigger_mode() {
        let policy = GroupPolicy {
            require_mention: true,
            reply_with_mention: ReplyWithMention::Trigger,
        };
        let segment = vec![seg("Alice", true), seg("Bob", false), seg("Carol", true)];
        assert_eq!(
            resolve_reply_mentions(&segment, &policy),
            Some(vec!["Carol".into()])
        );
    }

    #[test]
    fn test_resolve_all_mode() {
        let policy = GroupPolicy {
            require_mention: true,
            reply_with_mention: ReplyWithMention::All,
        };
        let segment = vec![seg("Alice", true), seg("Bob", false), seg("Carol", true)];
        assert_eq!(
            resolve_reply_mentions(&segment, &policy),
            Some(vec!["Alice".into(), "Carol".into()])
        );
    }

    #[test]
    fn test_resolve_disabled() {
        let policy = GroupPolicy {
            require_mention: true,
            reply_with_mention: ReplyWithMention::None,
        };
        assert_eq!(resolve_reply_mentions(&[seg("Alice", true)], &policy), None);
    }
}
