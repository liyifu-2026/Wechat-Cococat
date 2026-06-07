use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, Notify};

use super::{DEBOUNCE_MS, PROCESS_RETRY_SECS};

pub(super) struct PendingChat {
    pub chat_name: String,
    pub is_group: bool,
    pub fire_at: tokio::time::Instant,
}

pub(super) struct ChatScheduler {
    pending: Mutex<HashMap<String, PendingChat>>,
    notify: Notify,
}

impl ChatScheduler {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            pending: Mutex::new(HashMap::new()),
            notify: Notify::new(),
        })
    }

    pub async fn schedule_debounce(&self, chat_id: String, chat_name: String, is_group: bool) {
        let fire_at = tokio::time::Instant::now() + Duration::from_millis(DEBOUNCE_MS);
        self.upsert(chat_id, chat_name, is_group, fire_at, true).await;
    }

    pub async fn schedule_retry(&self, chat_id: String, chat_name: String, is_group: bool) {
        let fire_at = tokio::time::Instant::now() + Duration::from_secs(PROCESS_RETRY_SECS);
        self.upsert(chat_id, chat_name, is_group, fire_at, false).await;
    }

    async fn upsert(
        &self,
        chat_id: String,
        chat_name: String,
        is_group: bool,
        fire_at: tokio::time::Instant,
        debounce: bool,
    ) {
        let mut pending = self.pending.lock().await;
        match pending.entry(chat_id) {
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let item = entry.get_mut();
                item.chat_name = chat_name;
                item.is_group = is_group;
                item.fire_at = merge_fire_at(item.fire_at, fire_at, debounce);
            }
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(PendingChat {
                    chat_name,
                    is_group,
                    fire_at,
                });
            }
        }
        drop(pending);
        self.notify.notify_one();
    }

    pub async fn next_deadline(&self, idle: tokio::time::Instant) -> tokio::time::Instant {
        let pending = self.pending.lock().await;
        pending
            .values()
            .map(|p| p.fire_at)
            .min()
            .unwrap_or(idle)
    }

    pub fn notified(&self) -> tokio::sync::futures::Notified<'_> {
        self.notify.notified()
    }

    pub async fn drain_due(&self) -> Vec<(String, String, bool)> {
        let now = tokio::time::Instant::now();
        let mut pending = self.pending.lock().await;
        let due: Vec<(String, String, bool)> = pending
            .iter()
            .filter(|(_, p)| p.fire_at <= now)
            .map(|(id, p)| (id.clone(), p.chat_name.clone(), p.is_group))
            .collect();
        for (id, _, _) in &due {
            pending.remove(id);
        }
        due
    }
}

pub(super) fn merge_fire_at(
    existing: tokio::time::Instant,
    new: tokio::time::Instant,
    debounce: bool,
) -> tokio::time::Instant {
    if debounce {
        existing.max(new)
    } else {
        existing.min(new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_fire_at_prefers_later_for_debounce() {
        let base = tokio::time::Instant::now();
        let earlier = base + std::time::Duration::from_millis(500);
        let later = base + std::time::Duration::from_millis(1500);
        assert_eq!(merge_fire_at(earlier, later, true), later);
        assert_eq!(merge_fire_at(later, earlier, true), later);
    }

    #[test]
    fn test_merge_fire_at_prefers_sooner_for_retry() {
        let base = tokio::time::Instant::now();
        let earlier = base + std::time::Duration::from_millis(500);
        let later = base + std::time::Duration::from_millis(1500);
        assert_eq!(merge_fire_at(earlier, later, false), earlier);
        assert_eq!(merge_fire_at(later, earlier, false), earlier);
    }
}
