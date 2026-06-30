mod flicker;
pub mod rate_limiter;
pub mod sys_impl;
pub mod traits;

use crate::context::Context;
use crate::db::get_db;
use crate::effects::collect_effects;
use crate::ia::types::*;
use crate::ia::{find_state_by_id, identify_states};
use crate::tools::wechat_db::{find_account_dir, find_wechat_pid, resolve_account_dir};
use base64::Engine;
use flicker::FlickeringDetector;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use traits::{Executor, Observer};

/// Only one physical UI action per desktop session can execute at a time.
static EXECUTE_LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub struct ExecutionResult {
    pub success: bool,
    pub error: Option<String>,
}

const EXECUTION_TIMEOUT_MS: u64 = 300_000; // 5 minutes
const UNKNOWN_STATE_TIMEOUT_MS: u64 = 60_000; // 1 minute
const MAX_STEPS: u32 = 500;
const MAX_OBSERVE_FAILURES: u32 = 20;
const MAX_SNAPSHOT_DIRS: usize = 100;

fn prune_snapshot_dirs(root: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().parse::<i64>().ok()?;
            Some((name, path))
        })
        .collect();
    dirs.sort_by_key(|(name, _)| *name);
    let remove_count = dirs.len().saturating_sub(MAX_SNAPSHOT_DIRS);
    for (_, path) in dirs.into_iter().take(remove_count) {
        if let Err(e) = std::fs::remove_dir_all(&path) {
            tracing::warn!("[effects] failed to remove old snapshot {:?}: {}", path, e);
        }
    }
}

async fn execute_lock_for_session(session_id: &str) -> Arc<Mutex<()>> {
    let mut locks = EXECUTE_LOCKS.lock().await;
    locks
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

struct ResumeMonitoringOnDrop;

impl Drop for ResumeMonitoringOnDrop {
    fn drop(&mut self) {
        crate::sessions::health_monitor::resume_monitoring();
    }
}

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
    let session_id = context.session_id.clone();

    let mut plan_state = plan.initial_plan_state();

    let execution_start = std::time::Instant::now();
    let mut unknown_state_since: Option<std::time::Instant> = None;
    let mut flicker_detector = FlickeringDetector::new();
    let mut observe_failures = 0u32;
    let mut last_identified = "none".to_string();
    let mut last_action = "none".to_string();

    for step in 0..MAX_STEPS {
        if execution_start.elapsed().as_millis() as u64 > EXECUTION_TIMEOUT_MS {
            return (
                ExecutionResult {
                    success: false,
                    error: Some(format!(
                        "Execution timeout after {}s",
                        execution_start.elapsed().as_secs()
                    )),
                },
                plan_state,
            );
        }

        if cancel.is_cancelled() {
            return (
                ExecutionResult {
                    success: false,
                    error: Some("Aborted".to_string()),
                },
                plan_state,
            );
        }

        // 1. OBSERVE
        let obs = match observer.observe().await {
            Ok(o) => {
                observe_failures = 0;
                o
            }
            Err(e) => {
                observe_failures += 1;
                tracing::warn!("[exec] observe failed on step {step}: {e}");
                if observe_failures >= MAX_OBSERVE_FAILURES {
                    return (ExecutionResult {
                        success: false,
                        error: Some(format!(
                            "Observe failed {observe_failures} consecutive times for plan={} session={session_id}: {e}",
                            plan.id()
                        )),
                    }, plan_state);
                }
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
        last_identified = format!(
            "main={}, popup={}, contactCard={}, settings={}",
            identified
                .main_window
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .popup
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .contact_card
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .settings
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
        );

        if identified.main_window.is_none() {
            if unknown_state_since.is_none() {
                unknown_state_since = Some(std::time::Instant::now());
            }
            let elapsed = unknown_state_since.unwrap().elapsed();
            if elapsed.as_millis() as u64 > UNKNOWN_STATE_TIMEOUT_MS {
                tracing::error!("[exec] Unknown state timeout after {}s", elapsed.as_secs());
                return (
                    ExecutionResult {
                        success: false,
                        error: Some(format!(
                            "Unknown state for {}s - no matching IAState found",
                            elapsed.as_secs()
                        )),
                    },
                    plan_state,
                );
            }
            tracing::warn!("[exec] Unknown state ({}s), waiting...", elapsed.as_secs());
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            continue;
        }

        unknown_state_since = None;

        tracing::info!(
            "[exec] step={step} mainWindow={}, popup={}, contactCard={}, settings={}",
            identified
                .main_window
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .popup
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .contact_card
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
            identified
                .settings
                .as_ref()
                .map(|s| s.state_id.as_str())
                .unwrap_or("none"),
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
                    let logged_in_user: Option<String> = if logged_in {
                        find_wechat_pid().and_then(find_account_dir).or_else(|| {
                            context
                                .state
                                .main_window
                                .account_name
                                .as_deref()
                                .and_then(resolve_account_dir)
                        })
                    } else {
                        None
                    };
                    let db = get_db();
                    if let Err(e) = db.execute(
                        "UPDATE sessions SET login_state = ?1, logged_in_user = ?2, updated_at = datetime('now') WHERE id = ?3",
                        rusqlite::params![
                            if logged_in { "logged_in" } else { "logged_out" },
                            logged_in_user.as_deref(),
                            session_id,
                        ],
                    ) {
                        tracing::error!(
                            "[effects] failed to persist login state for session {}: {}",
                            session_id,
                            e
                        );
                    }
                }

                Effect::PopupAppeared {
                    popup_type,
                    message,
                } => {
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
                    let root = "/data/snapshots";
                    let dir = format!("{root}/{}", ts);
                    if std::fs::create_dir_all(&dir).is_ok() {
                        let _ = std::fs::write(format!("{dir}/screenshot.png"), &screenshot_bytes);
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
                        prune_snapshot_dirs(root);
                    }
                }

                Effect::ViewTransition { from, to } => {
                    tracing::debug!("[effects] view transition: {:?} -> {:?}", from, to);
                }

                Effect::Fatal { reason } => {
                    tracing::error!("[effects] FATAL: {reason}");
                }
            }
        }

        if effects.iter().any(|e| matches!(e, Effect::Fatal { .. })) {
            return (
                ExecutionResult {
                    success: false,
                    error: Some("session terminated by effect watcher".to_string()),
                },
                plan_state,
            );
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
        last_action = selected
            .as_ref()
            .map(|s| format!("{:?}", s.action))
            .unwrap_or_else(|| "none".to_string());

        // 7. EXECUTE — loop flattens Sequence, handles Emit, delegates physical actions
        if let Some(sel) = &selected {
            let execute_lock = execute_lock_for_session(&session_id).await;
            let _execute_guard = execute_lock.lock().await;
            crate::sessions::health_monitor::pause_monitoring();
            let _health_guard = ResumeMonitoringOnDrop;
            if let Err(e) =
                dispatch_action(&sel.action, sel.frame.as_ref(), &a11y, executor, emit).await
            {
                return (
                    ExecutionResult {
                        success: false,
                        error: Some(format!(
                            "Executor failed for plan={} session={} action={}: {}",
                            plan.id(),
                            session_id,
                            last_action,
                            e
                        )),
                    },
                    plan_state,
                );
            }
        }

        // 8. GOAL CHECK (after action)
        if plan.is_goal_reached(&context.state, &plan_state) {
            decay_success_if_send_message(plan.id());
            return (
                ExecutionResult {
                    success: true,
                    error: None,
                },
                plan_state,
            );
        }

        if selected.is_none() {
            return (
                ExecutionResult {
                    success: false,
                    error: Some("No action selected".to_string()),
                },
                plan_state,
            );
        }
    }

    (
        ExecutionResult {
            success: false,
            error: Some(format!(
                "Max steps reached for plan={} session={} last_state=[{}] last_action={}",
                plan.id(),
                session_id,
                last_identified,
                last_action,
            )),
        },
        plan_state,
    )
}

async fn dispatch_action(
    action: &Action,
    frame: Option<&FrameHint>,
    a11y: &A11yNode,
    executor: &dyn Executor,
    emit: &(dyn Fn(SubscriptionEvent) + Send + Sync),
) -> Result<(), String> {
    match action {
        Action::Emit { event } => {
            emit(event.clone());
            Ok(())
        }
        Action::Sequence { actions } => {
            for a in actions {
                Box::pin(dispatch_action(a, frame, a11y, executor, emit)).await?;
            }
            Ok(())
        }
        physical => executor.execute(physical, frame, a11y).await,
    }
}

fn decay_success_if_send_message(plan_id: &str) {
    if plan_id == "send_message" {
        if let Ok(mut limiter) = rate_limiter::get_rate_limiter().lock() {
            limiter.record_success();
        }
    }
}
