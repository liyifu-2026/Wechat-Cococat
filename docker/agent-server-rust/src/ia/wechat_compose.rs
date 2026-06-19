use super::selectors::query_selector;
use super::types::A11yNode;

/// Send button in WeChat compose bar (EN + zh-CN Linux builds).
pub const SEND_BUTTON_SELECTOR: &str = r#"push-button[name=/^(Send|发送)\(S\)$/]"#;

pub fn is_send_button_name(name: &str) -> bool {
    name == "Send(S)" || name == "发送(S)"
}

pub fn is_send_button(node: &A11yNode) -> bool {
    node.role == "push-button" && is_send_button_name(&node.name)
}

pub fn find_edit_and_send_button(a11y: &A11yNode) -> Option<(&A11yNode, &A11yNode)> {
    if let Some(send_btn) = query_selector(a11y, SEND_BUTTON_SELECTOR) {
        if let Some(pair) = find_edit_near_send(a11y, send_btn) {
            return Some(pair);
        }
    }
    find_edit_send_pair(a11y)
}

fn find_edit_near_send<'a>(
    root: &'a A11yNode,
    _send_btn: &A11yNode,
) -> Option<(&'a A11yNode, &'a A11yNode)> {
    find_edit_send_pair(root)
}

fn find_edit_send_pair(node: &A11yNode) -> Option<(&A11yNode, &A11yNode)> {
    if let Some(children) = &node.children {
        let send_btn = children.iter().find(|node| is_send_button(node));
        let edit_node = children.iter().find(|c| {
            c.role == "text"
                && c.states
                    .as_ref()
                    .map(|s| s.iter().any(|st| st == "EDITABLE"))
                    .unwrap_or(false)
        });

        if let (Some(edit), Some(send)) = (edit_node, send_btn) {
            return Some((edit, send));
        }

        for child in children {
            if let Some(result) = find_edit_send_pair(child) {
                return Some(result);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(role: &str, name: &str, children: Vec<A11yNode>) -> A11yNode {
        A11yNode {
            role: role.to_string(),
            name: name.to_string(),
            bounds: None,
            states: None,
            children: if children.is_empty() {
                None
            } else {
                Some(children)
            },
            parent_index: None,
            window: None,
        }
    }

    #[test]
    fn recognizes_chinese_send_button() {
        assert!(is_send_button_name("发送(S)"));
        assert!(is_send_button_name("Send(S)"));
        assert!(!is_send_button_name("Send File"));

        let mut edit = node("text", "", vec![]);
        edit.states = Some(vec!["EDITABLE".to_string()]);

        let tree = node(
            "filler",
            "",
            vec![edit, node("push-button", "发送(S)", vec![])],
        );

        assert!(find_edit_and_send_button(&tree).is_some());
    }
}
