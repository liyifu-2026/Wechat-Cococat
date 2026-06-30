use async_trait::async_trait;

use crate::ia::selectors::query_selector;
use crate::ia::types::{A11yNode, Action, FrameHint, ScrollDirection};
use crate::tools::a11y::get_a11y_desktop;
use crate::tools::exec::{exec_command, ExecOptions};
use crate::tools::screenshot::capture_screenshot;

use super::traits::{Executor, Observation, Observer};

pub struct SysObserver {
    options: ExecOptions,
}

impl SysObserver {
    pub fn new(options: ExecOptions) -> Self {
        Self { options }
    }
}

#[async_trait]
impl Observer for SysObserver {
    async fn observe(&self) -> Result<Observation, String> {
        let a11y = get_a11y_desktop(&self.options).await?;
        let screenshot = capture_screenshot(&self.options).await.unwrap_or_default();
        Ok(Observation { a11y, screenshot })
    }
}

fn window_activate_args(hint: &FrameHint) -> Vec<String> {
    if let Some(pid) = hint.pid {
        vec![
            "--window".to_string(),
            pid.to_string(),
            (hint.bounds.x as i32).to_string(),
            (hint.bounds.y as i32).to_string(),
            (hint.bounds.width as i32).to_string(),
            (hint.bounds.height as i32).to_string(),
            "--".to_string(),
        ]
    } else {
        vec![]
    }
}

pub struct SysExecutor {
    options: ExecOptions,
}

impl SysExecutor {
    pub fn new(options: ExecOptions) -> Self {
        Self { options }
    }
}

#[async_trait]
impl Executor for SysExecutor {
    async fn execute(
        &self,
        action: &Action,
        frame: Option<&FrameHint>,
        a11y: &A11yNode,
    ) -> Result<(), String> {
        let activate_args = frame.map(|f| window_activate_args(f)).unwrap_or_default();

        match action {
            Action::ClickSelector { selector } => {
                let node = query_selector(a11y, selector)
                    .ok_or_else(|| format!("selector '{selector}' no match"))?;
                let bounds = node
                    .bounds
                    .as_ref()
                    .ok_or_else(|| format!("selector '{selector}' matched but no bounds"))?;
                let cx = (bounds.x + bounds.width / 2.0).round() as i32;
                let cy = (bounds.y + bounds.height / 2.0).round() as i32;

                let mut args = activate_args;
                args.push(cx.to_string());
                args.push(cy.to_string());
                let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let result = exec_command("click", &args_ref, &self.options).await;
                if result.exit_code != 0 {
                    return Err(result.stderr);
                }
                Ok(())
            }

            Action::ClickCoords { x, y } => {
                let mut args = activate_args;
                args.push((*x as i32).to_string());
                args.push((*y as i32).to_string());
                let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let result = exec_command("click", &args_ref, &self.options).await;
                if result.exit_code != 0 {
                    return Err(result.stderr);
                }
                Ok(())
            }

            Action::Type { text, .. } => {
                let result = exec_command("input", &[text.as_str()], &self.options).await;
                if result.exit_code != 0 {
                    return Err(result.stderr);
                }
                Ok(())
            }

            Action::Key { combo } => {
                let mut args = activate_args;
                args.push(combo.clone());
                let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let result = exec_command("key", &args_ref, &self.options).await;
                if result.exit_code != 0 {
                    return Err(result.stderr);
                }
                Ok(())
            }

            Action::Scroll {
                direction, amount, ..
            } => {
                let dir = match direction {
                    ScrollDirection::Up => "up",
                    ScrollDirection::Down => "down",
                };
                let mut args = vec![dir.to_string()];
                if let Some(amt) = amount {
                    args.push(amt.to_string());
                }
                let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let result = exec_command("scroll", &args_ref, &self.options).await;
                if result.exit_code != 0 {
                    return Err(result.stderr);
                }
                Ok(())
            }

            Action::Wait { ms } => {
                tokio::time::sleep(std::time::Duration::from_millis(*ms)).await;
                Ok(())
            }

            Action::Emit { .. } | Action::Sequence { .. } => Err(
                "Emit and Sequence must be handled by the execution loop, not the Executor"
                    .to_string(),
            ),
        }
    }
}

use crate::ia::types::Session;

pub fn production_impls(session: &Session) -> (SysObserver, SysExecutor) {
    let options = ExecOptions {
        session: Some(session.clone()),
        timeout_ms: 60_000,
    };
    (SysObserver::new(options.clone()), SysExecutor::new(options))
}
