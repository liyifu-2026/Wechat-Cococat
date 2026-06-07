pub fn is_image_msg(msg_type: i32) -> bool {
    matches!(msg_type, 3)
}

pub fn is_voice_msg(msg_type: i32) -> bool {
    matches!(msg_type, 34)
}

pub fn is_video_msg(msg_type: i32) -> bool {
    matches!(msg_type, 43)
}

pub fn is_file_msg(msg_type: i32) -> bool {
    matches!(msg_type, 2004 | 49)
}

const MIMO_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";

pub async fn transcribe_voice(base64: &str, api_key: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "system",
                "content": "Output ONLY the transcribed text in Chinese. No explanations, no reasoning."
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": format!("data:audio/mp3;base64,{base64}")}},
                    {"type": "text", "text": "转写这段语音为中文文字，只输出内容。"}
                ]
            }
        ],
        "max_completion_tokens": 256,
        "thinking": {"type": "disabled"}
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{MIMO_BASE_URL}/chat/completions"))
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Voice HTTP: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Voice API {status}: {}", truncate_to_char_boundary(&err_text, 200)));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Voice JSON: {e}"))?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    if content.is_empty() {
        return Err("Voice transcription returned empty".into());
    }

    Ok(content.trim().to_string())
}

pub async fn describe_video(base64: &str, api_key: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "system",
                "content": "You are a video describer. Describe the video content in Chinese. Be concise, under 150 chars."
            },
            {
                "role": "user",
                "content": [
                    {"type": "video_url", "video_url": {"url": format!("data:video/mp4;base64,{base64}")}, "fps": 2, "media_resolution": "default"},
                    {"type": "text", "text": "请描述这个视频的内容，中文回复，简洁在150字以内。"}
                ]
            }
        ],
        "max_completion_tokens": 1024
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{MIMO_BASE_URL}/chat/completions"))
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Video HTTP: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Video API {status}: {}", truncate_to_char_boundary(&err_text, 200)));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Video JSON: {e}"))?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    if content.is_empty() {
        return Err("Video description returned empty".into());
    }

    Ok(content.trim().to_string())
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
