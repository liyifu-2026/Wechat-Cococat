use crate::ia::selectors::query_selector;
use crate::ia::types::*;

/// Error popup.
struct PopupErrorState;

/// Check if Settings frame is present (popups inside Settings are handled by settings FSM).
fn has_settings_frame(a11y: &A11yNode) -> bool {
    query_selector(a11y, r#"frame[name="Settings"]"#).is_some()
}

impl IAState for PopupErrorState {
    fn fsm(&self) -> &str { "popup" }
    fn id(&self) -> &str { "popup_error" }

    fn identify(&self, args: &IdentifyArgs) -> Result<IdentifyResult, String> {
        // Exclude matches when Settings frame is open (settings_modal handles those)
        if has_settings_frame(args.a11y) {
            return Ok(IdentifyResult { identified: false, frame: None });
        }

        let ok_btn = query_selector(args.a11y, r#"push-button[name="OK"]"#);
        let error_text = query_selector(args.a11y, r#"static[name=/error|failed|timeout|失败|错误/i]"#)
            .or_else(|| query_selector(args.a11y, r#"label[name=/error|failed|timeout|失败|错误/i]"#));

        Ok(IdentifyResult {
            identified: ok_btn.is_some() && error_text.is_some(),
            frame: None,
        })
    }

    fn reduce(&self, args: &ReduceArgs) -> AppState {
        let error_text = query_selector(args.a11y, r#"static[name=/error|failed|timeout|失败|错误/i]"#)
            .or_else(|| query_selector(args.a11y, r#"label[name=/error|failed|timeout|失败|错误/i]"#));

        let mut state = args.prev.clone();
        state.popup = Some(PopupState {
            popup_type: PopupType::Error,
            message: error_text.map(|n| n.name.clone()),
        });
        state
    }
}

/// Confirm/Tip popup.
struct PopupConfirmState;

impl IAState for PopupConfirmState {
    fn fsm(&self) -> &str { "popup" }
    fn id(&self) -> &str { "popup_confirm" }

    fn identify(&self, args: &IdentifyArgs) -> Result<IdentifyResult, String> {
        // Exclude matches when Settings frame is open (settings_modal handles those)
        if has_settings_frame(args.a11y) {
            return Ok(IdentifyResult { identified: false, frame: None });
        }

        let ok_btn = query_selector(args.a11y, r#"push-button[name=/OK|Confirm|确定|确认/i]"#);
        if ok_btn.is_none() {
            return Ok(IdentifyResult { identified: false, frame: None });
        }

        let error_in_static = query_selector(args.a11y, r#"static[name=/error|failed|timeout|失败|错误/i]"#).is_some();
        let error_in_label = query_selector(args.a11y, r#"label[name=/error|failed|timeout|失败|错误/i]"#).is_some();
        if error_in_static || error_in_label {
            return Ok(IdentifyResult { identified: false, frame: None });
        }

        Ok(IdentifyResult { identified: true, frame: None })
    }

    fn reduce(&self, args: &ReduceArgs) -> AppState {
        let message_el = query_selector(args.a11y, r#"static[name=/.+/]"#)
            .or_else(|| query_selector(args.a11y, r#"label[name=/^(?!Tip$).+/]"#));

        let mut state = args.prev.clone();
        state.popup = Some(PopupState {
            popup_type: PopupType::Confirm,
            message: message_el.map(|n| n.name.clone()),
        });
        state
    }
}

/// GroupMention popup — appears when typing @ in a group chat.
struct PopupGroupMentionState;

impl IAState for PopupGroupMentionState {
    fn fsm(&self) -> &str { "popup" }
    fn id(&self) -> &str { "popup_group_mention" }

    fn identify(&self, args: &IdentifyArgs) -> Result<IdentifyResult, String> {
        // Find a list-item with SELECTED that is NOT inside list[name="Chats"]
        let chats_list = query_selector(args.a11y, r#"list[name="Chats"]"#);
        let msg_list = query_selector(args.a11y, r#"list[name="Messages"]"#);

        // Search for any list containing a SELECTED list-item at the bottom area (y > 600)
        let mention_item = find_mention_list_item(args.a11y, chats_list, msg_list);

        Ok(IdentifyResult {
            identified: mention_item.is_some(),
            frame: None,
        })
    }

    fn reduce(&self, args: &ReduceArgs) -> AppState {
        let mut state = args.prev.clone();
        state.popup = Some(PopupState {
            popup_type: PopupType::GroupMention,
            message: None,
        });
        state
    }
}

fn find_mention_list_item<'a>(
    node: &'a A11yNode,
    _chats_list: Option<&A11yNode>,
    _msg_list: Option<&A11yNode>,
) -> Option<&'a A11yNode> {
    if node.role == "list-item"
        && node.states.as_ref().map(|s| s.contains(&"SELECTED".to_string())).unwrap_or(false)
        && node.bounds.as_ref().map(|b| b.y > 600.0).unwrap_or(false)
    {
        return Some(node);
    }
    if let Some(children) = &node.children {
        for child in children {
            if let Some(found) = find_mention_list_item(child, _chats_list, _msg_list) {
                return Some(found);
            }
        }
    }
    None
}

pub static POPUP_STATES: std::sync::LazyLock<Vec<Box<dyn IAState>>> = std::sync::LazyLock::new(|| {
    vec![
        Box::new(PopupErrorState),
        Box::new(PopupConfirmState),
        Box::new(PopupGroupMentionState),
    ]
});
