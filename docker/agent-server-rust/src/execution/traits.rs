use async_trait::async_trait;

use crate::ia::types::{A11yNode, Action, FrameHint};

pub struct Observation {
    pub a11y: A11yNode,
    pub screenshot: String,
}

#[async_trait]
pub trait Observer: Send + Sync {
    async fn observe(&self) -> Result<Observation, String>;
}

#[async_trait]
pub trait Executor: Send + Sync {
    async fn execute(
        &self,
        action: &Action,
        frame: Option<&FrameHint>,
        a11y: &A11yNode,
    ) -> Result<(), String>;
}
