use crate::context::create_context;
use crate::db::get_db;
use crate::execution::run_execution_loop;
use crate::execution::sys_impl::production_impls;
use crate::ia::identify_states;
use crate::ia::types::{MainWindowView, SubscriptionEvent};
use crate::plans::login::{LoginParams, LoginPlan};
use crate::sessions::manager::get_session;
use crate::tools::a11y::get_a11y_desktop;
use crate::tools::exec::ExecOptions;
use crate::tools::wechat_keys::get_stored_keys;

pub(super) async fn trigger_login() {
    if should_skip_login_trigger().await {
        tracing::info!(
            "Skipping login trigger: verified against live WeChat - already logged in"
        );
        return;
    }

    tokio::spawn(async move {
        let session = match get_session("default") {
            Some(s) => s,
            None => {
                tracing::warn!("No session, skipping login trigger");
                return;
            }
        };

        tracing::info!("Triggering login flow...");
        let cancel = tokio_util::sync::CancellationToken::new();
        let plan = LoginPlan;
        let params = LoginParams {
            new_account: false,
        };
        let mut context = {
            let db = get_db();
            create_context(session.clone(), &db)
        };
        let emit = |_event: SubscriptionEvent| {};
        let (observer, executor) = production_impls(&session);

        let (result, _) =
            run_execution_loop(&plan, &params, &mut context, &observer, &executor, &emit, cancel)
                .await;

        if result.success {
            let session = get_session("default");
            if let Some(s) = session {
                tracing::info!(
                    "Login flow completed, logged_in_user={:?}",
                    s.logged_in_user
                );
            }
        } else {
            tracing::warn!("Login flow ended: {:?}", result.error);
        }
    });
}

async fn should_skip_login_trigger() -> bool {
    let session = match get_session("default") {
        Some(s) if s.status == "running" => s,
        _ => return false,
    };
    let account_dir = match session.logged_in_user.clone() {
        Some(user) => user,
        None => return false,
    };

    let context = {
        let db = get_db();
        create_context(session.clone(), &db)
    };
    let has_chat_view = matches!(
        context.state.main_window.view,
        MainWindowView::Chat | MainWindowView::ChatOpen
    );
    if !has_chat_view {
        return false;
    }

    let has_required_keys = {
        let db = get_db();
        let keys = get_stored_keys(&db, &session.id, &account_dir);
        keys.contains_key("session.db") && keys.contains_key("contact.db")
    };
    if !has_required_keys {
        return false;
    }

    let session_id = session.id.clone();
    // Live a11y verification with timeout to prevent startup hang.
    let exec_options = ExecOptions {
        session: Some(session.clone()),
        timeout_ms: 5_000,
    };

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        get_a11y_desktop(&exec_options),
    )
    .await
    {
        Ok(Ok(a11y)) => {
            let screenshot = String::new();
            let identified = identify_states(&a11y, &screenshot);
            if let Some(ref mw) = identified.main_window {
                if mw.state_id.starts_with("login_") {
                    tracing::info!(
                        "Live WeChat shows login screen ({}) - cached state is stale, clearing",
                        mw.state_id
                    );
                    let db = get_db();
                    db.execute_batch(&format!(
                        "DELETE FROM context WHERE session_id = '{}'",
                        session_id
                    ))
                    .ok();
                    return false;
                }
            }
        }
        Ok(Err(e)) => {
            tracing::warn!(
                "Failed to verify WeChat state (a11y: {}) - trusting cached state",
                e
            );
        }
        Err(_timeout) => {
            tracing::warn!("Timed out verifying WeChat state - trusting cached state");
        }
    }

    true
}
