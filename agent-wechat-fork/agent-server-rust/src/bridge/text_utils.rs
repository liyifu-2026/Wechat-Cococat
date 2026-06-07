pub(super) fn split_reply(text: &str) -> Vec<String> {
    let parts: Vec<&str> = text.split("\n\n").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.len() <= 1 {
        return vec![text.trim().to_string()];
    }
    let mut merged = Vec::new();
    let mut buffer = String::new();
    for part in parts {
        if !buffer.is_empty() && buffer.len() < 10 {
            buffer.push_str("\n\n");
            buffer.push_str(part);
        } else if !buffer.is_empty() {
            merged.push(buffer);
            buffer = part.to_string();
        } else {
            buffer = part.to_string();
        }
    }
    if !buffer.is_empty() {
        merged.push(buffer);
    }
    if merged.len() > 3 {
        let rest: Vec<String> = merged.drain(2..).collect();
        merged.push(rest.join("\n\n"));
    }
    merged
}

pub(super) fn smart_truncate(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }
    let truncated = truncate_to_char_boundary(text, max_len);
    let min_pos = max_len * 7 / 10;
    let puncts = ['\u{3002}', '\u{FF01}', '\u{FF1F}', '.', '!', '?', '\u{FF0C}', ',', '\u{FF1B}', ';', ' '];
    let mut best = None;
    for p in &puncts {
        if let Some(pos) = truncated.rfind(*p) {
            if pos > min_pos && Some(pos) > best {
                best = Some(pos);
            }
        }
    }
    if let Some(pos) = best {
        truncated[..pos].to_string()
    } else {
        format!("{}...", truncate_to_char_boundary(text, max_len - 3))
    }
}

pub(super) fn truncate_to_char_boundary(text: &str, max_len: usize) -> &str {
    if text.len() <= max_len {
        return text;
    }
    let mut end = max_len;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
