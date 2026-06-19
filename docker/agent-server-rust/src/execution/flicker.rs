use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::ia::types::Effect;

const FLICKER_WINDOW: Duration = Duration::from_secs(3);
const FLICKER_THRESHOLD: usize = 5;

pub struct FlickeringDetector {
    timestamps: VecDeque<Instant>,
}

impl FlickeringDetector {
    pub fn new() -> Self {
        Self {
            timestamps: VecDeque::new(),
        }
    }

    pub fn record_transitions(&mut self, effects: &[Effect]) -> Option<Effect> {
        let has_transition = effects
            .iter()
            .any(|e| matches!(e, Effect::ViewTransition { .. }));
        if !has_transition {
            return None;
        }

        let now = Instant::now();
        self.timestamps.push_back(now);

        let cutoff = now - FLICKER_WINDOW;
        while self
            .timestamps
            .front()
            .map(|t| *t < cutoff)
            .unwrap_or(false)
        {
            self.timestamps.pop_front();
        }

        if self.timestamps.len() >= FLICKER_THRESHOLD {
            let count = self.timestamps.len();
            self.timestamps.clear();
            return Some(Effect::Fatal {
                reason: format!(
                    "view flickering detected: {} transitions in {:?}",
                    count, FLICKER_WINDOW,
                ),
            });
        }

        None
    }
}
