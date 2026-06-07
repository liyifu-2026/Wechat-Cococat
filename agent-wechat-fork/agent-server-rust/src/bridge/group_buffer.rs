use std::collections::HashMap;

use serde_json::Value;

pub type BufferedMessage = Value;

pub fn push_buffer(
    buffers: &mut HashMap<String, Vec<BufferedMessage>>,
    chat_id: &str,
    messages: Vec<BufferedMessage>,
    limit: usize,
) {
    if messages.is_empty() {
        return;
    }
    let buf = buffers.entry(chat_id.to_string()).or_default();
    buf.extend(messages);
    if buf.len() > limit {
        let drain = buf.len() - limit;
        buf.drain(0..drain);
    }
}

pub fn drain_buffer(
    buffers: &mut HashMap<String, Vec<BufferedMessage>>,
    chat_id: &str,
) -> Vec<BufferedMessage> {
    buffers.remove(chat_id).unwrap_or_default()
}

pub fn clear_buffer(buffers: &mut HashMap<String, Vec<BufferedMessage>>, chat_id: &str) {
    buffers.remove(chat_id);
}
