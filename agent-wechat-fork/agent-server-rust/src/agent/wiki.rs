use crate::agent::tools::WikiClient;

pub async fn check_wiki_health(client: &WikiClient) -> bool {
    let url = format!("{}/api/v1/health", client.api_url);
    let mut headers = reqwest::header::HeaderMap::new();
    if !client.api_token.is_empty() {
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", client.api_token)) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
    }

    let http_client = reqwest::Client::new();
    match http_client.get(&url).headers(headers).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if json.get("enabled").and_then(|v| v.as_bool()) == Some(true) {
                    tracing::info!("LLM Wiki connected");
                    return true;
                }
            }
            tracing::warn!("LLM Wiki not ready");
            false
        }
        Err(_) => {
            tracing::warn!("LLM Wiki not reachable");
            false
        }
    }
}
