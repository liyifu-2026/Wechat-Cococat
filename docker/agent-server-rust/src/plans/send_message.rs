use super::Plan;
use crate::ia::actions;
use crate::ia::selectors::query_selector;
use crate::ia::types::*;
use crate::ia::wechat_compose::find_edit_and_send_button;
use crate::tools::chat_select::{open_chat, OpenChatResult};
use crate::tools::exec::{exec_command, ExecOptions};

pub struct SendMessagePlan;

pub struct SendMessageParams {
    pub chat_id: String,
    pub message: Option<String>,
    pub image_path: Option<String>,
    pub image_mime: Option<String>,
    pub file_path: Option<String>,
    pub mentions: Vec<String>,
    pub session: Option<Session>,
}

#[derive(Debug, PartialEq)]
pub enum SendMessagePhase {
    Opening,
    Focusing,
    Mentioning,
    Inputting,
    Confirming,
    Done,
}

pub struct SendMessagePlanState {
    pub phase: SendMessagePhase,
    pub open_result: Option<OpenChatResult>,
    pub confirm_attempts: u32,
    pub focus_attempts: u32,
    pub mention_index: usize,
    pub mention_attempts: u32,
}

const MENTION_MAX_ATTEMPTS: u32 = 3;
const FOCUS_MAX_ATTEMPTS: u32 = 30;

#[async_trait::async_trait]
impl Plan for SendMessagePlan {
    type PlanState = SendMessagePlanState;
    type Params = SendMessageParams;

    fn id(&self) -> &str {
        "send_message"
    }

    fn initial_plan_state(&self) -> SendMessagePlanState {
        SendMessagePlanState {
            phase: SendMessagePhase::Opening,
            open_result: None,
            confirm_attempts: 0,
            focus_attempts: 0,
            mention_index: 0,
            mention_attempts: 0,
        }
    }

    fn is_goal_reached(&self, _state: &AppState, plan_state: &SendMessagePlanState) -> bool {
        matches!(plan_state.phase, SendMessagePhase::Done)
    }

    async fn select_action(
        &self,
        state: &AppState,
        params: &SendMessageParams,
        identified: &IdentifiedStates,
        plan_state: &mut SendMessagePlanState,
        a11y: &A11yNode,
        _session_id: &str,
    ) -> Option<SelectedAction> {
        let main_state_id = identified.main_window.as_ref().map(|m| m.state_id.as_str());

        // Handle popups: dismiss errors/confirms, handle mentions
        if let Some(ref popup) = state.popup {
            match popup.popup_type {
                PopupType::Error | PopupType::Confirm | PopupType::Info => {
                    if identified.popup.is_some() {
                        return Some(SelectedAction {
                            action: actions::dismiss_popup(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                }
                PopupType::GroupMention => {
                    // Mention popup is active; select the target member
                    if plan_state.phase != SendMessagePhase::Mentioning {
                        return Some(SelectedAction {
                            action: actions::dismiss_popup(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                    return handle_mention(a11y, params, plan_state, identified);
                }
            }
        }

        loop {
            match &plan_state.phase {
                SendMessagePhase::Opening => {
                    if main_state_id != Some("chat") && main_state_id != Some("chat_open") {
                        tracing::warn!(
                            "[send_message] main window not on chat view: {:?}",
                            main_state_id
                        );
                        return None;
                    }

                    let chat_list_item = query_selector(a11y, r#"list[name="Chats"] > list-item"#);
                    let click_xy = chat_list_item.and_then(|item| {
                        item.bounds.as_ref().map(|b| {
                            (
                                (b.x + b.width / 2.0).round(),
                                (b.y + b.height / 2.0).round(),
                            )
                        })
                    });

                    // Always force-open target chat (Console may send to a different session than UI focus).
                    let result = open_chat(&params.chat_id, true, click_xy).await;

                    if !result.ok {
                        if main_state_id == Some("chat_open") {
                            tracing::warn!(
                                "[send_message] open_chat failed but chat_open already — proceeding: {}",
                                result.error.as_deref().unwrap_or("unknown")
                            );
                        } else {
                            tracing::warn!(
                                "[send_message] open_chat failed for {}: {:?}",
                                params.chat_id,
                                result.error
                            );
                            return None;
                        }
                    }

                    let skipped = result.skipped.unwrap_or(false);
                    plan_state.open_result = Some(result);
                    plan_state.phase = SendMessagePhase::Focusing;

                    if !skipped {
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                    continue;
                }

                SendMessagePhase::Focusing => {
                    if main_state_id != Some("chat_open") {
                        // When target was already selected (skipped=true), WeChat may
                        // report "chat" state while the conversation is actually open.
                        if main_state_id == Some("chat")
                            && plan_state
                                .open_result
                                .as_ref()
                                .map_or(false, |r| r.skipped.unwrap_or(false))
                        {
                            tracing::info!(
                                "[send_message] Focusing: chat view (target already selected), proceeding"
                            );
                            plan_state.phase = SendMessagePhase::Inputting;
                            plan_state.focus_attempts = 0;
                            continue;
                        }
                        plan_state.focus_attempts += 1;
                        if plan_state.focus_attempts < FOCUS_MAX_ATTEMPTS {
                            tracing::debug!(
                                "[send_message] waiting for chat_open, got {:?} ({}/{})",
                                main_state_id,
                                plan_state.focus_attempts,
                                FOCUS_MAX_ATTEMPTS
                            );
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                        tracing::warn!(
                            "[send_message] expected chat_open, got {:?}",
                            main_state_id
                        );
                        return None;
                    }

                    let found = find_edit_and_send_button(a11y);
                    let (edit_node, _) = match found {
                        Some(f) => f,
                        None => {
                            plan_state.focus_attempts += 1;
                            if plan_state.focus_attempts < FOCUS_MAX_ATTEMPTS {
                                tracing::debug!(
                                    "[send_message] compose not ready yet ({}/{})",
                                    plan_state.focus_attempts,
                                    FOCUS_MAX_ATTEMPTS
                                );
                                return Some(SelectedAction {
                                    action: actions::wait_short(),
                                    frame: identified
                                        .main_window
                                        .as_ref()
                                        .and_then(|m| m.frame.clone()),
                                });
                            }
                            tracing::warn!(
                                "[send_message] compose input / Send button not found in a11y tree"
                            );
                            return None;
                        }
                    };

                    plan_state.focus_attempts = 0;

                    // If we have mentions, go to Mentioning phase
                    if !params.mentions.is_empty() {
                        plan_state.phase = SendMessagePhase::Mentioning;
                    } else {
                        plan_state.phase = SendMessagePhase::Inputting;
                    }

                    let is_focused = edit_node
                        .states
                        .as_ref()
                        .map(|s| s.iter().any(|st| st == "FOCUSED"))
                        .unwrap_or(false);

                    if is_focused {
                        continue;
                    }

                    if let Some(bounds) = &edit_node.bounds {
                        return Some(SelectedAction {
                            action: actions::click_bounds(bounds),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                    return None;
                }

                SendMessagePhase::Mentioning => {
                    if plan_state.mention_index < params.mentions.len() {
                        if plan_state.mention_attempts >= MENTION_MAX_ATTEMPTS {
                            tracing::warn!(
                                "mention fallback: sending without @ for {:?}",
                                params.mentions.get(plan_state.mention_index)
                            );
                            plan_state.mention_index = params.mentions.len();
                            continue;
                        }
                        plan_state.mention_attempts += 1;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Key {
                                    combo: "at".to_string(),
                                },
                                Action::Wait { ms: 500 },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    // Mentions are in the composer; Inputting sends the body once.
                    plan_state.phase = SendMessagePhase::Inputting;
                    continue;
                }

                SendMessagePhase::Inputting => {
                    let found = find_edit_and_send_button(a11y);
                    if found.is_none() {
                        return None;
                    }

                    plan_state.phase = SendMessagePhase::Confirming;

                    if let Some(fp) = &params.file_path {
                        let exec_options = ExecOptions {
                            session: params.session.clone(),
                            ..ExecOptions::default()
                        };
                        exec_command("paste-file", &[fp], &exec_options).await;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Wait { ms: 100 },
                                Action::Key {
                                    combo: "Return".to_string(),
                                },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    if let Some(ip) = &params.image_path {
                        let mut args: Vec<&str> = vec![ip];
                        if let Some(mime) = &params.image_mime {
                            args.push(mime);
                        }
                        let exec_options = ExecOptions {
                            session: params.session.clone(),
                            ..ExecOptions::default()
                        };
                        exec_command("paste-image", &args, &exec_options).await;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Wait { ms: 100 },
                                Action::Key {
                                    combo: "Return".to_string(),
                                },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    if let Some(msg) = &params.message {
                        let mut seq = Vec::new();
                        // ctrl+a wipes WeChat @-mention widgets; append after mentions instead.
                        if params.mentions.is_empty() {
                            seq.push(Action::Key {
                                combo: "ctrl+a".to_string(),
                            });
                        }
                        seq.push(Action::Type {
                            text: msg.clone(),
                            selector: None,
                        });
                        seq.push(Action::Wait { ms: 100 });
                        seq.push(Action::Key {
                            combo: "Return".to_string(),
                        });
                        return Some(SelectedAction {
                            action: actions::sequence(seq),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    return None;
                }

                SendMessagePhase::Confirming => {
                    let found = find_edit_and_send_button(a11y);
                    let (_, send_btn) = match found {
                        Some(f) => f,
                        None => return None,
                    };

                    let is_disabled = send_btn
                        .states
                        .as_ref()
                        .map(|s| s.iter().any(|st| st == "DISABLED"))
                        .unwrap_or(false);

                    if is_disabled {
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    plan_state.confirm_attempts += 1;
                    if plan_state.confirm_attempts >= 5 {
                        return None;
                    }

                    return Some(SelectedAction {
                        action: actions::wait_short(),
                        frame: identified
                            .main_window
                            .as_ref()
                            .and_then(|m| m.frame.clone()),
                    });
                }

                SendMessagePhase::Done => return None,
            }
        }
    }
}

fn handle_mention(
    _a11y: &A11yNode,
    params: &SendMessageParams,
    plan_state: &mut SendMessagePlanState,
    identified: &IdentifiedStates,
) -> Option<SelectedAction> {
    let target = params.mentions.get(plan_state.mention_index)?;
    plan_state.mention_index += 1;
    plan_state.mention_attempts = 0;

    // Type the name into the mention search to narrow down,
    // then hit Enter to select
    Some(SelectedAction {
        action: actions::sequence(vec![
            Action::Type {
                text: target.clone(),
                selector: None,
            },
            Action::Wait { ms: 200 },
            Action::Key {
                combo: "Return".to_string(),
            },
        ]),
        frame: identified
            .main_window
            .as_ref()
            .and_then(|m| m.frame.clone()),
    })
}
