use std::fs;
use std::path::PathBuf;

use crate::ia::types::MediaResult;

const ARTIFACTS_ROOT: &str = "/data/artifacts";

fn sanitize_chat_id(chat_id: &str) -> String {
    chat_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '@' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn extension_for_media(media: &MediaResult) -> Option<&'static str> {
    match media.media_type.as_str() {
        "image" => Some(if media.format == "png" { "png" } else { "jpg" }),
        "voice" => Some(if media.format == "mp3" { "mp3" } else { "silk" }),
        "video" => Some(if media.format == "mp4" { "mp4" } else { "jpg" }),
        "emoji" => Some("gif"),
        _ => None,
    }
}

fn artifact_relative_path(chat_id: &str, local_id: i64, ext: &str) -> String {
    format!(
        "artifacts/{}/{}.{}",
        sanitize_chat_id(chat_id),
        local_id,
        ext
    )
}

fn artifact_absolute_path(chat_id: &str, local_id: i64, ext: &str) -> PathBuf {
    PathBuf::from(ARTIFACTS_ROOT)
        .join(sanitize_chat_id(chat_id))
        .join(format!("{local_id}.{ext}"))
}

/// Map WeChat message type to a coarse media kind for the brain layer.
pub fn media_kind_for_msg_type(msg_type: i32) -> Option<&'static str> {
    match msg_type & 0x7FFFFFFF {
        3 => Some("image"),
        34 => Some("voice"),
        43 => Some("video"),
        _ => None,
    }
}

/// Return artifact ref if a normalized file already exists on disk.
pub fn existing_artifact_ref(chat_id: &str, local_id: i64, msg_type: i32) -> Option<String> {
    let exts: &[&str] = match msg_type & 0x7FFFFFFF {
        3 => &["jpg", "jpeg", "png", "webp"],
        34 => &["mp3", "silk"],
        43 => &["mp4", "jpg", "jpeg"],
        _ => return None,
    };
    for ext in exts {
        let path = artifact_absolute_path(chat_id, local_id, ext);
        if path.is_file() {
            return Some(artifact_relative_path(chat_id, local_id, ext));
        }
    }
    None
}

/// Write decrypted media bytes to `/data/artifacts` and return a host-visible relative path.
pub fn write_artifact(chat_id: &str, local_id: i64, media: &MediaResult) -> Option<String> {
    if media.media_type == "pending" || media.media_type == "unsupported" {
        return None;
    }
    let data_b64 = media.data.as_ref()?;
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data_b64,
    )
    .ok()?;
    let ext = extension_for_media(media)?;
    let path = artifact_absolute_path(chat_id, local_id, ext);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    fs::write(&path, &bytes).ok()?;
    Some(artifact_relative_path(chat_id, local_id, ext))
}
