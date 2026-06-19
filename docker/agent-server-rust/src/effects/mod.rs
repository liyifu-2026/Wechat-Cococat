use crate::ia::types::{AppState, Effect};

pub fn collect_effects(prev: &AppState, next: &AppState) -> Vec<Effect> {
    let mut effects = Vec::new();

    if prev.main_window.is_logged_in != next.main_window.is_logged_in {
        effects.push(Effect::UpdateSessionLoginState);
    }

    if prev.popup.is_none() && next.popup.is_some() {
        if let Some(ref p) = next.popup {
            effects.push(Effect::PopupAppeared {
                popup_type: p.popup_type.clone(),
                message: p.message.clone(),
            });
        }
    }

    if prev.main_window.view != next.main_window.view {
        effects.push(Effect::ViewTransition {
            from: prev.main_window.view.clone(),
            to: next.main_window.view.clone(),
        });
    }

    effects
}
