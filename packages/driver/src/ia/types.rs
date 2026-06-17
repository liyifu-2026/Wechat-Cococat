use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

// ============================================
// A11y Tree Types (from a11y-dump) — internal only
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A11yWindowInfo {
    pub pid: i64,

    pub id: Option<i64>,

    pub attributes: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A11yNode {
    pub role: String,
    pub name: String,

    pub bounds: Option<Bounds>,

    pub children: Option<Vec<A11yNode>>,
    /// Parent is not serialized — set via add_parent_refs after deserialization
    #[serde(skip)]
    pub parent_index: Option<usize>,

    pub window: Option<A11yWindowInfo>,

    pub states: Option<Vec<String>>,
}

// ============================================
// Actions — internal only
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Action {
    #[serde(rename = "click_selector")]
    ClickSelector { selector: String },
    #[serde(rename = "click_coords")]
    ClickCoords { x: f64, y: f64 },
    #[serde(rename = "type_text")]
    Type {
        text: String,
    
        selector: Option<String>,
    },
    #[serde(rename = "key")]
    Key { combo: String },
    #[serde(rename = "scroll")]
    Scroll {
        direction: ScrollDirection,
    
        x: Option<f64>,
    
        y: Option<f64>,
    
        amount: Option<i32>,
    },
    #[serde(rename = "wait")]
    Wait { ms: u64 },
    #[serde(rename = "emit")]
    Emit { event: SubscriptionEvent },
    #[serde(rename = "sequence")]
    Sequence { actions: Vec<Action> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrollDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub data: HashMap<String, serde_json::Value>,
}

// ============================================
// Multi-Window State Model — internal only
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MainWindowView {
    LoginQr,
    LoginAccount,
    LoginPhoneConfirm,
    LoginLoading,
    NetworkProxySettings,
    Chat,
    ChatOpen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub name: String,

    pub bounds: Option<Bounds>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MainWindowState {
    pub view: MainWindowView,
    pub is_logged_in: bool,

    pub qr_data: Option<String>,

    pub qr_binary_data: Option<Vec<u8>>,

    pub account_name: Option<String>,

    pub selected_chat_id: Option<String>,

    pub search_query: Option<String>,

    pub search_results: Option<Vec<SearchResult>>,

    pub opened_chat_name: Option<String>,

    pub opened_chat_is_group: Option<bool>,

    pub selected_chat_bounds: Option<Bounds>,

    pub close_button_bounds: Option<Bounds>,

    pub minimize_button_bounds: Option<Bounds>,

    pub maximize_button_bounds: Option<Bounds>,

    pub more_button_bounds: Option<Bounds>,

    pub settings_menu_item_bounds: Option<Bounds>,

    pub proxy_enabled: Option<bool>,

    pub proxy_save_failed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopupState {
    #[serde(rename = "type")]
    pub popup_type: PopupType,

    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PopupType {
    Error,
    Confirm,
    Info,
    GroupMention,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactCardState {

    pub wechat_id: Option<String>,

    pub contact_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub main_window: MainWindowState,
    pub popup: Option<PopupState>,
    pub contact_card: Option<ContactCardState>,
    pub settings: Option<SettingsState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            main_window: MainWindowState {
                view: MainWindowView::LoginQr,
                is_logged_in: false,
                qr_data: None,
                qr_binary_data: None,
                account_name: None,
                selected_chat_id: None,
                search_query: None,
                search_results: None,
                opened_chat_name: None,
                opened_chat_is_group: None,
                selected_chat_bounds: None,
                close_button_bounds: None,
                minimize_button_bounds: None,
                maximize_button_bounds: None,
                more_button_bounds: None,
                settings_menu_item_bounds: None,
                proxy_enabled: None,
                proxy_save_failed: None,
            },
            popup: None,
            contact_card: None,
            settings: None,
        }
    }
}

// ============================================
// State Definition — internal only
// ============================================

pub struct IdentifyArgs<'a> {
    pub a11y: &'a A11yNode,
    pub screenshot: &'a str,
}

/// Frame hint — identifies which window to activate before executing an action.
/// Extracted by IA states during identify and passed through plans to execute_action.
#[derive(Debug, Clone)]
pub struct FrameHint {
    pub name: Option<String>,
    pub bounds: Bounds,
    pub pid: Option<i64>,
}

pub struct IdentifyResult {
    pub identified: bool,
    pub frame: Option<FrameHint>,
}

pub struct ReduceArgs<'a> {
    pub prev: &'a AppState,
    pub a11y: &'a A11yNode,
    pub screenshot: &'a [u8],
}

/// IAState defines a UI state in the FSM.
pub trait IAState: Send + Sync {
    fn fsm(&self) -> &str;
    fn id(&self) -> &str;
    fn identify(&self, args: &IdentifyArgs) -> Result<IdentifyResult, String>;
    fn reduce(&self, args: &ReduceArgs) -> AppState;
}

// ============================================
// Identified States — internal only
// ============================================

#[derive(Debug, Clone)]
pub struct IdentifiedState {
    pub state_id: String,
    pub fsm: String,
    pub frame: Option<FrameHint>,
}

#[derive(Debug, Clone)]
pub struct IdentifiedStates {
    pub main_window: Option<IdentifiedState>,
    pub popup: Option<IdentifiedState>,
    pub contact_card: Option<IdentifiedState>,
    pub settings: Option<IdentifiedState>,
}

// ============================================
// Effects — internal only
// ============================================

pub enum Effect {
    Emit { event: SubscriptionEvent },
    UpdateSessionLoginState,
    PopupAppeared {
        popup_type: PopupType,
        message: Option<String>,
    },
    ViewTransition {
        from: MainWindowView,
        to: MainWindowView,
    },
    Fatal {
        reason: String,
    },
}

// ============================================
// Plan — internal only
// ============================================

pub struct SelectedAction {
    pub action: Action,
    pub frame: Option<FrameHint>,
}

// ============================================
// Execution status — internal only
// ============================================

#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionStatus {
    Running,
    Succeeded,
    Failed,
    Aborted,
}

// ============================================
// Session types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub linux_user: String,
    pub display: String,

    #[ts(optional)]
    pub dbus_address: Option<String>,
    pub vnc_port: i32,
    pub status: String,
    pub login_state: String,

    #[ts(optional)]
    pub logged_in_user: Option<String>,

    #[ts(optional, type = "number")]
    pub wechat_pid: Option<i64>,

    #[ts(optional, type = "number")]
    pub xvfb_pid: Option<i64>,

    #[ts(optional, type = "number")]
    pub dbus_pid: Option<i64>,

    #[ts(optional)]
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================
// Chat types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Chat {
    pub id: String,
    pub username: String,
    pub name: String,

    #[ts(optional)]
    pub remark: Option<String>,

    #[ts(optional)]
    pub last_message_preview: Option<String>,

    #[ts(optional)]
    pub last_message_sender: Option<String>,

    #[ts(optional)]
    pub last_activity_at: Option<String>,
    pub unread_count: i32,
    pub is_group: bool,

    #[ts(optional)]
    pub small_head_url: Option<String>,

    #[ts(optional, type = "number")]
    pub last_msg_local_id: Option<i64>,
}

// ============================================
// Contact types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Contact {
    pub username: String,
    pub nick_name: String,

    #[ts(optional)]
    pub remark: Option<String>,

    #[ts(optional)]
    pub alias: Option<String>,

    #[ts(optional)]
    pub small_head_url: Option<String>,
    /// "individual", "official", "chatroom", or "openim"
    pub contact_type: String,
}

// ============================================
// Message types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReplyInfo {

    #[ts(optional)]
    pub sender: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Message {
    #[ts(type = "number")]
    pub local_id: i64,
    #[ts(type = "number")]
    pub server_id: i64,
    pub chat_id: String,

    #[ts(optional)]
    pub sender: Option<String>,

    #[ts(optional)]
    pub sender_name: Option<String>,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub msg_type: i32,
    pub content: String,
    pub timestamp: String,

    #[ts(optional)]
    pub is_mentioned: Option<bool>,

    #[ts(optional)]
    pub is_self: Option<bool>,

    #[ts(optional)]
    pub reply: Option<ReplyInfo>,

    /// Relative path under `/data` (e.g. `artifacts/{chatId}/{localId}.jpg`) when exported.
    #[ts(optional)]
    pub artifact_ref: Option<String>,

    #[ts(optional)]
    pub media_kind: Option<String>,

    /// Console optimistic-send id; attached after send reconciles with DB row.
    #[ts(optional)]
    pub client_msg_id: Option<String>,
}

// ============================================
// Settings types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SettingsState {

    #[ts(optional)]
    pub logout_button_bounds: Option<Bounds>,

    #[ts(optional)]
    pub my_account_bounds: Option<Bounds>,

    #[ts(optional)]
    pub modal_ok_bounds: Option<Bounds>,

    #[ts(optional)]
    pub modal_cancel_bounds: Option<Bounds>,
}

// ============================================
// Login subscription event types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export)]
pub enum LoginSubscriptionEvent {
    #[serde(rename = "status")]
    Status { message: String },
    #[serde(rename = "qr")]
    Qr {
        #[serde(rename = "qrData")]
        qr_data: String,
        #[serde(rename = "qrBinaryData")]
    
        #[ts(optional, type = "number[]")]
        qr_binary_data: Option<Vec<u8>>,
        #[serde(rename = "qrDataUrl")]
    
        #[ts(optional)]
        qr_data_url: Option<String>,
    },
    #[serde(rename = "phone_confirm")]
    PhoneConfirm {
    
        #[ts(optional)]
        message: Option<String>,
    },
    #[serde(rename = "login_account")]
    LoginAccount {
    
        #[ts(optional)]
        message: Option<String>,
    },
    #[serde(rename = "login_success")]
    LoginSuccess {
        #[serde(rename = "userId")]
    
        #[ts(optional)]
        user_id: Option<String>,
    },
    #[serde(rename = "login_timeout")]
    LoginTimeout,
    #[serde(rename = "error")]
    Error { message: String },
}

// ============================================
// Send types (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SendParams {
    pub chat_id: String,

    #[ts(optional)]
    pub text: Option<String>,

    #[ts(optional)]
    pub image: Option<ImageData>,

    #[ts(optional)]
    pub file: Option<FileData>,

    #[ts(optional)]
    pub mentions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImageData {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileData {
    pub data: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SendResult {
    pub success: bool,

    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaResult {
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub media_type: String,

    #[ts(optional)]
    pub data: Option<String>,

    #[ts(optional)]
    pub url: Option<String>,
    pub format: String,
    pub filename: String,

    /// Relative path under `/data` when written to `/data/artifacts`.
    #[ts(optional)]
    pub artifact_ref: Option<String>,
}

// ============================================
// Open chat result (shared — generates TypeScript)
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpenChatResult {
    pub ok: bool,

    #[ts(optional)]
    pub username: Option<String>,

    #[ts(optional)]
    pub index: Option<i32>,

    #[ts(optional)]
    pub error: Option<String>,
}
