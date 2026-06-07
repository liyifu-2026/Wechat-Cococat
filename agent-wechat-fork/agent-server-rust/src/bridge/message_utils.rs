use md5::{Digest, Md5};

pub(super) fn bridge_message_id(
    chat_id: &str,
    local_id: Option<i64>,
    server_id: Option<i64>,
    timestamp: Option<&str>,
    content: Option<&str>,
    sender: Option<&str>,
    list_index: Option<usize>,
) -> String {
    if let Some(id) = local_id.filter(|id| *id != 0) {
        return format!("{chat_id}_{id}");
    }
    if let Some(id) = server_id.filter(|id| *id != 0) {
        return format!("{chat_id}_{id}");
    }
    if let Some(ts) = timestamp.filter(|ts| !ts.is_empty()) {
        return format!("{chat_id}_{ts}");
    }
    let mut hasher = Md5::new();
    hasher.update(chat_id.as_bytes());
    if let Some(c) = content.filter(|c| !c.is_empty()) {
        hasher.update(c.as_bytes());
    }
    if let Some(s) = sender.filter(|s| !s.is_empty()) {
        hasher.update(s.as_bytes());
    }
    if let Some(idx) = list_index {
        hasher.update(idx.to_le_bytes());
    }
    format!("{chat_id}_fallback_{:x}", hasher.finalize())
}

pub(super) fn parse_message_timestamp_ms(timestamp: &str) -> Option<i64> {
    if timestamp.is_empty() {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

pub(super) fn is_safety_rejection(text: &str) -> bool {
    let lower = text.to_lowercase();
    (lower.contains("rejected") && lower.contains("high risk"))
        || lower.contains("content policy")
        || lower.contains("safety system")
}

pub(super) fn poll_should_process(current: i32, prev: i32) -> bool {
    current > prev
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poll_only_when_unread_increases() {
        assert!(!poll_should_process(0, 0));
        assert!(!poll_should_process(3, 3));
        assert!(!poll_should_process(2, 5));
        assert!(poll_should_process(1, 0));
        assert!(poll_should_process(5, 2));
    }

    #[test]
    fn test_bridge_message_id_fallback_avoids_shared_unknown() {
        let a = bridge_message_id("chat1", None, None, None, Some("hello"), None, Some(0));
        let b = bridge_message_id("chat1", None, None, None, Some("world"), None, Some(1));
        assert_ne!(a, b);
        assert!(a.starts_with("chat1_fallback_"));
    }

    #[test]
    fn test_bridge_message_id_prefers_local_id() {
        let id = bridge_message_id("c", Some(42), None, None, None, None, None);
        assert_eq!(id, "c_42");
    }
}
