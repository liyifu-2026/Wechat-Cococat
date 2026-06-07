use async_trait::async_trait;

use agent_server::execution::traits::{Executor, Observation, Observer};
use agent_server::ia::identify_states;
use agent_server::ia::types::{A11yNode, Action, AppState, FrameHint, MainWindowView, PopupType};
use agent_server::plans::login::{LoginParams, LoginPlan};
use agent_server::plans::send_message::{SendMessageParams, SendMessagePhase, SendMessagePlan};
use agent_server::plans::Plan;
use tokio::sync::Mutex;

struct FixtureObserver {
    a11y: A11yNode,
}

impl FixtureObserver {
    fn new(fixture_path: &str) -> Self {
        let json = std::fs::read_to_string(fixture_path).expect("fixture not found");
        let a11y: A11yNode = serde_json::from_str(&json).expect("invalid fixture JSON");
        Self { a11y }
    }
}

#[async_trait]
impl Observer for FixtureObserver {
    async fn observe(&self) -> Result<Observation, String> {
        Ok(Observation {
            a11y: self.a11y.clone(),
            screenshot: String::new(),
        })
    }
}

struct RecordingExecutor {
    actions: Mutex<Vec<Action>>,
}

impl RecordingExecutor {
    fn new() -> Self {
        Self {
            actions: Mutex::new(Vec::new()),
        }
    }

    #[allow(dead_code)]
    fn actions(&self) -> Vec<Action> {
        self.actions.blocking_lock().clone()
    }
}

#[async_trait]
impl Executor for RecordingExecutor {
    async fn execute(
        &self,
        action: &Action,
        _frame: Option<&FrameHint>,
        _a11y: &A11yNode,
    ) -> Result<(), String> {
        self.actions.blocking_lock().push(action.clone());
        Ok(())
    }
}

fn load_fixture(name: &str) -> A11yNode {
    let path = format!("tests/fixtures/{name}");
    let json =
        std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("fixture not found: {path}"));
    serde_json::from_str(&json).expect("invalid fixture JSON")
}

#[tokio::test]
async fn test_login_account_identified_correctly() {
    let a11y = load_fixture("login_account.json");
    let screenshot = "";

    let identified = identify_states(&a11y, screenshot);

    let mw = identified
        .main_window
        .expect("should identify a main window state");
    assert_eq!(mw.state_id, "login_account", "should be login_account state");
    assert!(mw.frame.is_some(), "should have frame hint");
}

#[tokio::test]
async fn test_login_plan_clicks_log_in_on_account_view() {
    let a11y = load_fixture("login_account.json");
    let screenshot = "";

    let identified = identify_states(&a11y, screenshot);
    assert!(identified.main_window.is_some());

    let plan = LoginPlan;
    let params = LoginParams {
        new_account: false,
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::LoginAccount;
    let mut plan_state = plan.initial_plan_state();

    let selected = plan
        .select_action(
            &state,
            &params,
            &identified,
            &mut plan_state,
            &a11y,
            "test-session",
        )
        .await;

    assert!(selected.is_some(), "should select an action");
    let sel = selected.unwrap();

    match &sel.action {
        Action::ClickSelector { selector } => {
            assert!(
                selector.contains("Log In") || selector.contains("Open WeChat"),
                "expected selector matching 'Log In' or 'Open WeChat', got: {selector}"
            );
        }
        other => panic!("expected ClickSelector, got {:?}", other),
    }
}

#[tokio::test]
async fn test_login_plan_clicks_switch_account_when_new_account() {
    let a11y = load_fixture("login_account.json");
    let screenshot = "";

    let identified = identify_states(&a11y, screenshot);

    let plan = LoginPlan;
    let params = LoginParams {
        new_account: true,
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::LoginAccount;
    let mut plan_state = plan.initial_plan_state();

    let selected = plan
        .select_action(&state, &params, &identified, &mut plan_state, &a11y, "test-session")
        .await;

    assert!(selected.is_some());
    let sel = selected.unwrap();

    match &sel.action {
        Action::ClickSelector { selector } => {
            assert!(
                selector.contains("Switch Account"),
                "expected selector matching 'Switch Account', got: {selector}"
            );
        }
        other => panic!("expected ClickSelector for Switch Account, got {:?}", other),
    }
}

// ?? Mention tests ??

#[tokio::test]
async fn test_mention_popup_identified_from_fixture() {
    let a11y = load_fixture("group_mention_popup.json");

    let identified = identify_states(&a11y, "");

    assert!(identified.main_window.is_some(), "should have main window state");
    assert_eq!(
        identified.main_window.unwrap().state_id,
        "chat_open",
        "should be chat_open with mention popup"
    );

    assert!(identified.popup.is_some(), "should detect popup");
    assert_eq!(
        identified.popup.unwrap().state_id,
        "popup_group_mention",
        "should be group_mention popup"
    );
}

#[tokio::test]
async fn test_send_message_enters_mentioning_phase_with_mentions() {
    let a11y = load_fixture("group_mention_popup.json");
    let identified = identify_states(&a11y, "");

    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: "test@chatroom".into(),
        message: Some("hi".into()),
        image_path: None,
        image_mime: None,
        file_path: None,
        mentions: vec!["Leaif".into()],
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::ChatOpen;
    let mut plan_state = plan.initial_plan_state();
    // Skip to Focusing phase
    plan_state.phase = SendMessagePhase::Focusing;

    let selected = plan
        .select_action(&state, &params, &identified, &mut plan_state, &a11y, "test")
        .await;

    assert!(selected.is_some(), "should select an action");
    assert_eq!(
        plan_state.phase,
        SendMessagePhase::Mentioning,
        "Focusing with mentions should enter Mentioning phase"
    );
    let sel = selected.unwrap();
    let triggers_mention = match &sel.action {
        Action::ClickCoords { .. } | Action::ClickSelector { .. } => true,
        Action::Sequence { actions } => actions
            .iter()
            .any(|a| matches!(a, Action::Key { combo } if combo == "at")),
        other => panic!("unexpected action {:?}", other),
    };
    assert!(
        triggers_mention,
        "should focus input or trigger @ popup, got {:?}",
        sel.action
    );
}

#[tokio::test]
async fn test_send_message_skips_mentioning_without_mentions() {
    let a11y = load_fixture("group_mention_popup.json");
    let identified = identify_states(&a11y, "");

    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: "test@chatroom".into(),
        message: Some("hi".into()),
        image_path: None,
        image_mime: None,
        file_path: None,
        mentions: Vec::new(),
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::ChatOpen;
    let mut plan_state = plan.initial_plan_state();
    plan_state.phase = SendMessagePhase::Focusing;

    let selected = plan
        .select_action(&state, &params, &identified, &mut plan_state, &a11y, "test")
        .await;

    // Without mentions, should NOT inject @mention prefix
    assert!(selected.is_some(), "should select an action");
    let sel = selected.unwrap();
    match &sel.action {
        Action::Sequence { actions } => {
            let has_mention = actions.iter().any(|a| {
                matches!(a, Action::Type { text, .. } if text.starts_with('@'))
            });
            assert!(!has_mention, "should NOT include @mention when mentions list is empty");
        }
        _ => {}
    }
}

#[tokio::test]
async fn test_mention_handling_types_target_name() {
    let a11y = load_fixture("group_mention_popup.json");
    let identified = identify_states(&a11y, "");

    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: "test@chatroom".into(),
        message: Some("hi".into()),
        image_path: None,
        image_mime: None,
        file_path: None,
        mentions: vec!["Leaif".into()],
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::ChatOpen;
    // Set popup to GroupMention to simulate the mention popup being active
    state.popup = Some(agent_server::ia::types::PopupState {
        popup_type: PopupType::GroupMention,
        message: None,
    });
    let mut plan_state = plan.initial_plan_state();
    plan_state.phase = SendMessagePhase::Mentioning;

    let selected = plan
        .select_action(&state, &params, &identified, &mut plan_state, &a11y, "test")
        .await;

    assert!(selected.is_some(), "should select an action for mention");
    let sel = selected.unwrap();

    match &sel.action {
        Action::Sequence { actions } => {
            assert!(actions.len() >= 2, "should have type + enter");
            let type_action = &actions[0];
            match type_action {
                Action::Type { text, .. } => {
                    assert_eq!(text, "Leaif", "should type the target mention name");
                }
                _ => panic!("expected Type action, got {:?}", type_action),
            }
            let enter_action = &actions[2]; // Wait is [1]
            match enter_action {
                Action::Key { combo } => {
                    assert_eq!(combo, "Return", "should press Enter to select");
                }
                _ => panic!("expected Key action, got {:?}", enter_action),
            }
        }
        other => panic!("expected Sequence, got {:?}", other),
    }
}

#[tokio::test]
async fn test_mentioning_phase_types_message_after_mentions_selected() {
    let a11y = load_fixture("group_mention_popup.json");
    let identified = identify_states(&a11y, "");

    let plan = SendMessagePlan;
    let message = "\u{6d4b}\u{8bd5}\u{6d88}\u{606f}".to_string();
    let params = SendMessageParams {
        chat_id: "test@chatroom".into(),
        message: Some(message.clone()),
        image_path: None,
        image_mime: None,
        file_path: None,
        mentions: vec!["Leaif".into(), "\u{5c0f}\u{767d}".into()],
    };
    let mut state = AppState::default();
    state.main_window.view = MainWindowView::ChatOpen;
    let mut plan_state = plan.initial_plan_state();
    plan_state.phase = SendMessagePhase::Mentioning;
    plan_state.mention_index = params.mentions.len();

    let selected = plan
        .select_action(&state, &params, &identified, &mut plan_state, &a11y, "test")
        .await;

    assert_eq!(plan_state.phase, SendMessagePhase::Inputting);
    assert!(selected.is_some());
    let sel = selected.unwrap();

    match &sel.action {
        Action::Sequence { actions } => {
            let type_action = actions.iter().find(|a| matches!(a, Action::Type { .. }));
            assert!(type_action.is_some(), "should have Type action");
            if let Some(Action::Type { text, .. }) = type_action {
                assert_eq!(
                    text, &message,
                    "after UI mention picks, only the message body is typed"
                );
            }
        }
        other => panic!("expected Sequence, got {:?}", other),
    }
}
