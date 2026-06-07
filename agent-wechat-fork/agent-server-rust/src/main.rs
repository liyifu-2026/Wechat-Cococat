#[tokio::main]
async fn main() {
    agent_server::run().await;
}

// force rebuild bridge v1
