mod flicker;
pub mod rate_limiter;
pub mod sys_impl;
pub mod traits;

use base64::Engine;
use crate::context::Context;
use crate::ia::{find_state_by_id, identify_states};
use crate::ia::types::*;
use crate::effects::collect_effects;
use crate::db::get_db;
use flicker::FlickeringDetector;
use traits::{Executor, Observer};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Only one plan can run at a time — they all drive the GUI.
static PLAN_LOCK: Mutex<()> = Mutex::const_new(());

pub struct ExecutionResult {
    pub success: bool,
    pub error: Option<String>,
}

const EXECUTION_TIMEOUT_MS: u64 = 300_000; // 5 minutes
const UNKNOWN_STATE_TIMEOUT_MS: u64 = 60_000; // 1 minute
const MAX_STEPS: u32 = 500;

/// Run the FSM execution loop with a generic plan, observer, and executor.
///
/// 1. OBSERVE    → observer.observe() — a11y tree + screenshot
/// 2. IDENTIFY   → match IAState from tree
/// 3. REDUCE     → update AppState via identified state's reduce()
/// 4. EFFECTS    → emit events on state change
/// 5. PERSIST    → save AppState to SQLite
/// 6. SELECT     → plan picks next action
/// 7. EXECUTE    → run action via executor (Sequence/Emit handled by loop)
/// 8. GOAL?      → plan checks if done
/// 9. LOOP
pub async fn run_execution_loop<P, PS, PA>(
    plan: &P,
    params: &PA,
    context: &mut Context,
    observer: &dyn Observer,
    executor: &dyn Executor,
    emit: &(dyn Fn(SubscriptionEvent) + Send + Sync),
    cancel: CancellationToken,
) -> (ExecutionResult, PS)
where
    P: crate::plans::Plan<PlanState = PS, Params = PA>,
    PS: Send,
    PA: Send,
{
    let _plan_guard = PLAN_LOCK.lock().await;

    crate::sessions::health_monitor::pause_monitoring();
    struct ResumeOnDrop;
    impl Drop for ResumeOnDrop {
        fn drop(&mut self) {
            crate::sessions::health_monitor::resume_monitoring();
        }
    }
    let _health_guard = ResumeOnDrop;

    let mut plan_state = plan.initial_plan_state();
    let session_id = context.session_id.clone();

    let execution_start = std::time::Instant::now();
    let mut unknown_state_since: Option<std::time::Instant> = None;
    let mut flicker_detector = FlickeringDetector::new();

    for step in 0..MAX_STEPS {
        if execution_start.elapsed().as_millis() as u64 > EXECUTION_TIMEOUT_MS {
            return (ExecutionResult {
                success: false,
                error: Some(format!(
                    "Execution timeout after {}s",
                    execution_start.elapsed().as_secs()
                )),
            }, plan_state);
        }

        if cancel.is_cancelled() {
            return (ExecutionResult {
                success: false,
                error: Some("Aborted".to_string()),
            }, plan_state);
        }

        // 1. OBSERVE
        let obs = match observer.observe().await {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!("[exec] observe failed on step {step}: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        };

        let a11y = obs.a11y;
        let screenshot = obs.screenshot;
        let screenshot_bytes = base64::engine::general_purpose::STANDARD
            .decode(&screenshot)
            .unwrap_or_default();

        // 2. IDENTIFY
        let identified = identify_states(&a11y, &screenshot);

        if identified.main_window.is_none() {
            if unknown_state_since.is_none() {
                unknown_state_since = Some(std::time::Instant::now());
            }
            let elapsed = unknown_state_since.unwrap().elapsed();
            if elapsed.as_millis() as u64 > UNKNOWN_STATE_TIMEOUT_MS {
                tracing::error!("[exec] Unknown state timeout after {}s", elapsed.as_secs());
                return (ExecutionResult {
                    success: false,
                    error: Some(format!(
                        "Unknown state for {}s - no matching IAState found",
                        elapsed.as_secs()
                    )),
                }, plan_state);
            }
            tracing::warn!("[exec] Unknown state ({}s), waiting...", elapsed.as_secs());
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            continue;
        }

        unknown_state_since = None;

        tracing::info!(
            "[exec] step={step} mainWindow={}, popup={}, contactCard={}, settings={}",
            identified.main_window.as_ref().map(|s| s.state_id.as_str()).unwrap_or("none"),
            identified.popup.as_ref().map(|s| s.state_id.as_str()).unwrap_or("none"),
            identified.contact_card.as_ref().map(|s| s.state_id.as_str()).unwrap_or("none"),
            identified.settings.as_ref().map(|s| s.state_id.as_str()).unwrap_or("none"),
        );

        // 3. REDUCE
        let prev_state = context.state.clone();

        if let Some(ref mw) = identified.main_window {
            if let Some(state_impl) = find_state_by_id(&mw.state_id) {
                context.state = state_impl.reduce(&ReduceArgs {
                    prev: &prev_state,
                    a11y: &a11y,
                    screenshot: &screenshot_bytes,
                });
            }
        }

        if let Some(ref popup) = identified.popup {
            if let Some(state_impl) = find_state_by_id(&popup.state_id) {
                let current = context.state.clone();
                context.state = state_impl.reduce(&ReduceArgs {
                    prev: &current,
                    a11y: &a11y,
                    screenshot: &screenshot_bytes,
                });
            }
        } else {
            context.state.popup = None;
        }

        if let Some(ref cc) = identified.contact_card {
            if let Some(state_impl) = find_state_by_id(&cc.state_id) {
                let current = context.state.clone();
                context.state = state_impl.reduce(&ReduceArgs {
                    prev: &current,
                    a11y: &a11y,
                    screenshot: &screenshot_bytes,
                });
            }
        } else {
            context.state.contact_card = None;
        }

        if let Some(ref s) = identified.settings {
            if let Some(state_impl) = find_state_by_id(&s.state_id) {
                let current = context.state.clone();
                context.state = state_impl.reduce(&ReduceArgs {
                    prev: &current,
                    a11y: &a11y,
                    screenshot: &screenshot_bytes,
                });
            }
        } else {
            context.state.settings = None;
        }

        // 4. EFFECTS
        let mut effects = collect_effects(&prev_state, &context.state);

        if let Some(fatal) = flicker_detector.record_transitions(&effects) {
            effects.push(fatal);
        }

        for effect in &effects {
            match effect {
                Effect::Emit { event } => emit(event.clone()),

                Effect::UpdateSessionLoginState => {
                    let logged_in = context.state.main_window.is_logged_in;
                    let account = context.state.main_window.account_name.as_deref();
                    let db = get_db();
                    db.execute(
                        "UPDATE sessions SET login_state = ?1, logged_in_user = ?2, updated_at = datetime('now') WHERE id = ?3",
                        rusqlite::params![
                            if logged_in { "logged_in" } else { "logged_out" },
                            if logged_in { account } else { None::<&str> },
                            session_id,
                        ],
                    ).ok();
                }

                Effect::PopupAppeared { popup_type, message } => {
                    tracing::warn!(
                        "[effects] popup appeared: type={:?}, message={:?}",
                        popup_type,
                        message
                    );
                    if popup_type == &PopupType::Error {
                        if let Some(ref msg) = message {
                            rate_limiter::get_rate_limiter()
                                .lock()
                                .unwrap()
                                .record_popup(msg);
                        }
                    }
                    let ts = chrono::Utc::now().timestamp();
                    let dir = format!("/data/snapshots/{}", ts);
                    if std::fs::create_dir_all(&dir).is_ok() {
                        let _ = std::fs::write(
                            format!("{dir}/screenshot.png"),
                            &screenshot_bytes,
                        );
                        let meta = serde_json::json!({
                            "timestamp": ts,
                            "popup_type": serde_json::to_value(popup_type).unwrap_or_default(),
                            "popup_message": message,
                            "session_id": session_id,
                            "plan_id": plan.id(),
                            "current_step": step,
                            "is_logged_in": context.state.main_window.is_logged_in,
                            "wechat_pid": context.state.main_window.account_name,
                        });
                        let _ = std::fs::write(
                            format!("{dir}/meta.json"),
                            serde_json::to_string_pretty(&meta).unwrap_or_default(),
                        );
                    }
                }

                Effect::ViewTransition { from, to } => {
                    tracing::debug!(
                        "[effects] view transition: {:?} -> {:?}",
                        from,
                        to
                    );
                }

                Effect::Fatal { reason } => {
                    tracing::error!("[effects] FATAL: {reason}");
                }
            }
        }

        if effects.iter().any(|e| matches!(e, Effect::Fatal { .. })) {
            return (ExecutionResult {
                success: false,
                error: Some("session terminated by effect watcher".to_string()),
            }, plan_state);
        }

        // 5. PERSIST
        {
            let db = get_db();
            context.save(&db);
        }

        // 6. SELECT
        let selected = plan
            .select_action(
                &context.state,
                params,
                &identified,
                &mut plan_state,
                &a11y,
                &session_id,
            )
            .await;

        tracing::debug!(
            "[exec] selected action: {}",
            selected
                .as_ref()
                .map(|s| format!("{:?}", s.action))
                .unwrap_or_else(|| "none".to_string())
        );

        // 7. EXECUTE — loop flattens Sequence, handles Emit, delegates physical actions
        if let Some(sel) = &selected {
            dispatch_action(&sel.action, sel.frame.as_ref(), &a11y, executor, emit).await;
        }

        // 8. GOAL CHECK (after action)
        if plan.is_goal_reached(&context.state, &plan_state) {
            decay_success_if_send_message(plan.id());
            return (ExecutionResult {
                success: true,
                error: None,
            }, plan_state);
        }

        if selected.is_none() {
            return (ExecutionResult {
                success: false,
                error: Some("No action selected".to_string()),
            }, plan_state);
        }
    }

    (ExecutionResult {
        success: false,
        error: Some("Max steps reached".to_string()),
    }, plan_state)
}

async fn dispatch_action(
    action: &Action,
    frame: Option<&FrameHint>,
    a11y: &A11yNode,
    executor: &dyn Executor,
    emit: &(dyn Fn(SubscriptionEvent) + Send + Sync),
) {
    match action {
        Action::Emit { event } => {
            emit(event.clone());
        }
        Action::Sequence { actions } => {
            for a in actions {
                Box::pin(dispatch_action(a, frame, a11y, executor, emit)).await;
            }
        }
        physical => {
            if let Err(e) = executor.execute(physical, frame, a11y).await {
                tracing::warn!("[exec] executor error: {e}");
            }
        }
    }
}

fn decay_success_if_send_message(plan_id: &str) {
    if plan_id == "send_message" {
        if let Ok(mut limiter) = rate_limiter::get_rate_limiter().lock() {
            limiter.record_success();
        }
    }
}
