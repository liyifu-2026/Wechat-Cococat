//! Resolve display names for group @-mentions when sending replies.

const HAIR_SPACE: char = '\u{2005}';

/// Names that cannot be used in the WeChat @ picker search.
pub fn is_mentionable_display_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wxid_")
}

/// Extract `@Name` tokens terminated by hair space (WeChat mention protocol).
pub fn extract_at_display_names(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for segment in text.split(HAIR_SPACE) {
        let token = segment.trim();
        if token.starts_with('@') || token.starts_with('\u{FF20}') {
            let name = token.trim_start_matches(['@', '\u{FF20}']).trim();
            if is_mentionable_display_name(name) {
                names.push(name.to_string());
            }
        }
    }
    names
}

/// Pick the best single name to @ when replying to a group message sender.
pub fn resolve_for_reply(
    sender_name: Option<&str>,
    raw_content: Option<&str>,
    mention_display_name: Option<&str>,
) -> Vec<String> {
    if let Some(name) = mention_display_name.filter(|n| is_mentionable_display_name(n)) {
        return vec![name.to_string()];
    }
    if let Some(name) = sender_name.filter(|n| is_mentionable_display_name(n)) {
        return vec![name.to_string()];
    }
    if let Some(content) = raw_content {
        if let Some(name) = extract_at_display_names(content).into_iter().next() {
            return vec![name];
        }
    }
    Vec::new()
}

/// Remove leading `@Name` tokens the LLM echoed when FSM will insert real mentions.
pub fn strip_leading_at_mentions(text: &str, mentions: &[String]) -> String {
    let mut rest = text.trim_start();
    for name in mentions {
        for prefix in [format!("@{name}"), format!("@{name}\u{2005}")] {
            if rest.starts_with(&prefix) {
                rest = rest[prefix.len()..].trim_start();
            }
        }
    }
    rest.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_at_tokens_hair_space() {
        let text = "@Agent\u{2005}hello world";
        assert_eq!(extract_at_display_names(text), vec!["Agent"]);
    }

    #[test]
    fn test_resolve_prefers_mention_display_name() {
        let names = resolve_for_reply(Some("wxid_abc"), Some("@Bot\u{2005}hi"), Some("Leaif"));
        assert_eq!(names, vec!["Leaif"]);
    }

    #[test]
    fn test_resolve_uses_sender_name() {
        let names = resolve_for_reply(Some("Alice"), None, None);
        assert_eq!(names, vec!["Alice"]);
    }

    #[test]
    fn test_rejects_wxid_sender() {
        assert!(resolve_for_reply(Some("wxid_abc"), None, None).is_empty());
    }
}
