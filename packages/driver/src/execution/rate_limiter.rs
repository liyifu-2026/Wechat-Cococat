use std::cmp::min;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const OUTBOUND_WINDOW: Duration = Duration::from_secs(10 * 60);
const OUTBOUND_MIN_CHAT_INTERVAL: Duration = Duration::from_secs(1);
const OUTBOUND_MIN_GLOBAL_INTERVAL: Duration = Duration::from_millis(300);
const OUTBOUND_MAX_PER_CHAT: usize = 20;
const OUTBOUND_MAX_GLOBAL: usize = 80;

pub struct RateLimiter {
    cooldown_until: Option<Instant>,
    consecutive_triggers: u32,
    hard_trigger_active: bool,
    outbound_records: Vec<(String, Instant)>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            cooldown_until: None,
            consecutive_triggers: 0,
            hard_trigger_active: false,
            outbound_records: Vec::new(),
        }
    }

    pub fn record_popup(&mut self, message: &str) -> bool {
        let msg = message.to_lowercase();
        let soft_trigger = msg.contains("频繁") || msg.contains("警告") || msg.contains("限制");
        let hard_trigger = msg.contains("封")
            || msg.contains("账号异常")
            || msg.contains("账户异常")
            || msg.contains("安全")
            || msg.contains("违规")
            || msg.contains("外挂")
            || msg.contains("risk")
            || msg.contains("abnormal")
            || msg.contains("violation");

        if soft_trigger || hard_trigger {
            self.consecutive_triggers += 1;
            if hard_trigger {
                self.hard_trigger_active = true;
            }
            let base_secs = if hard_trigger { 6 * 60 * 60 } else { 30 * 60 };
            let penalty_secs = min(base_secs * self.consecutive_triggers, 24 * 60 * 60);
            self.cooldown_until = Some(Instant::now() + Duration::from_secs(penalty_secs as u64));
            tracing::warn!(
                "[rate-limiter] Triggered! hard={}, consecutive={}, cooldown={}s",
                hard_trigger,
                self.consecutive_triggers,
                penalty_secs,
            );
            return true;
        }
        false
    }

    pub fn is_cooling_down(&self) -> bool {
        if let Some(until) = self.cooldown_until {
            if Instant::now() < until {
                return true;
            }
        }
        false
    }

    fn prune_outbound(&mut self, now: Instant) {
        self.outbound_records
            .retain(|(_, at)| now.duration_since(*at) <= OUTBOUND_WINDOW);
    }

    pub fn check_outbound_allowed(&mut self, chat_id: &str) -> Result<(), String> {
        if self.is_cooling_down() {
            return Err("WeChat rate limit cooldown active — try again later".to_string());
        }

        let now = Instant::now();
        self.prune_outbound(now);

        if let Some((_, last_chat_at)) = self
            .outbound_records
            .iter()
            .rev()
            .find(|(record_chat_id, _)| record_chat_id == chat_id)
        {
            if now.duration_since(*last_chat_at) < OUTBOUND_MIN_CHAT_INTERVAL {
                return Err("Driver outbound safety: chat send interval too short".to_string());
            }
        }

        if let Some((_, last_at)) = self.outbound_records.last() {
            if now.duration_since(*last_at) < OUTBOUND_MIN_GLOBAL_INTERVAL {
                return Err("Driver outbound safety: global send interval too short".to_string());
            }
        }

        if self.outbound_records.len() >= OUTBOUND_MAX_GLOBAL {
            return Err("Driver outbound safety: global send budget exhausted".to_string());
        }

        let chat_count = self
            .outbound_records
            .iter()
            .filter(|(record_chat_id, _)| record_chat_id == chat_id)
            .count();
        if chat_count >= OUTBOUND_MAX_PER_CHAT {
            return Err("Driver outbound safety: chat send budget exhausted".to_string());
        }

        Ok(())
    }

    pub fn record_outbound_success(&mut self, chat_id: &str) {
        let now = Instant::now();
        self.prune_outbound(now);
        self.outbound_records.push((chat_id.to_string(), now));
    }

    pub fn record_success(&mut self) {
        if self.hard_trigger_active && self.is_cooling_down() {
            return;
        }
        if self.consecutive_triggers > 0 {
            self.consecutive_triggers -= 1;
        }
        if self.consecutive_triggers == 0 {
            self.cooldown_until = None;
            self.hard_trigger_active = false;
        }
    }
}

pub fn get_rate_limiter() -> &'static Mutex<RateLimiter> {
    static LIMITER: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    LIMITER.get_or_init(|| Mutex::new(RateLimiter::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbound_guard_blocks_immediate_same_chat_repeat() {
        let mut limiter = RateLimiter::new();
        assert!(limiter.check_outbound_allowed("c1").is_ok());
        limiter.record_outbound_success("c1");

        let err = limiter.check_outbound_allowed("c1").unwrap_err();
        assert!(err.contains("chat send interval"));
    }

    #[test]
    fn outbound_guard_blocks_immediate_global_repeat() {
        let mut limiter = RateLimiter::new();
        assert!(limiter.check_outbound_allowed("c1").is_ok());
        limiter.record_outbound_success("c1");

        let err = limiter.check_outbound_allowed("c2").unwrap_err();
        assert!(err.contains("global send interval"));
    }
}
