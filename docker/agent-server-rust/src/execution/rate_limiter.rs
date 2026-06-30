use std::cmp::min;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    cooldown_until: Option<Instant>,
    consecutive_triggers: u32,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            cooldown_until: None,
            consecutive_triggers: 0,
        }
    }

    pub fn record_popup(&mut self, message: &str) -> bool {
        let msg = message.to_lowercase();
        if msg.contains("频繁") || msg.contains("警告") || msg.contains("限制") {
            self.consecutive_triggers += 1;
            let penalty_secs = min(10 * 60 * self.consecutive_triggers, 3600);
            self.cooldown_until = Some(Instant::now() + Duration::from_secs(penalty_secs as u64));
            tracing::warn!(
                "[rate-limiter] Triggered! consecutive={}, cooldown={}s",
                self.consecutive_triggers,
                penalty_secs
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

    pub fn record_success(&mut self) {
        if self.consecutive_triggers > 0 {
            self.consecutive_triggers -= 1;
        }
        if self.consecutive_triggers == 0 {
            self.cooldown_until = None;
        }
    }
}

pub fn get_rate_limiter() -> &'static Mutex<RateLimiter> {
    static LIMITER: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    LIMITER.get_or_init(|| Mutex::new(RateLimiter::new()))
}
