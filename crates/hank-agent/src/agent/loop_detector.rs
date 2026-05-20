use std::collections::VecDeque;
use std::hash::{DefaultHasher, Hash, Hasher};
use serde_json::Value;

/// Detects infinite loops in agent tool execution using a sliding window
/// of fingerprints. A loop is detected when the same fingerprint appears
/// more than `repeat_threshold` times within the window.
pub struct LoopDetector {
    window: VecDeque<String>,
    window_size: usize,
    repeat_threshold: usize,
    pub consecutive_loops: usize,
}

impl LoopDetector {
    /// Create a new LoopDetector with default window_size=6 and repeat_threshold=2
    pub fn new() -> Self {
        Self {
            window: VecDeque::with_capacity(6),
            window_size: 6,
            repeat_threshold: 2,
            consecutive_loops: 0,
        }
    }

    /// Record a tool execution and check if a loop is detected.
    /// Returns true if loop detected, false otherwise.
    pub fn record(&mut self, tool_name: &str, input: &Value) -> bool {
        let fingerprint = Self::fingerprint(tool_name, input);

        // Add to window
        if self.window.len() >= self.window_size {
            self.window.pop_front();
        }
        self.window.push_back(fingerprint);

        // Check if loop detected
        self.detect_loop()
    }

    /// Get a string representation of the current detected loop pattern
    pub fn loop_pattern(&self) -> String {
        if self.window.is_empty() {
            return String::new();
        }

        // Find the most repeated fingerprint
        let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for fp in &self.window {
            *counts.entry(fp.as_str()).or_insert(0) += 1;
        }

        if let Some((pattern, count)) = counts.iter().max_by_key(|&(_, &c)| c) {
            format!("{} (appears {} times)", pattern, count)
        } else {
            String::new()
        }
    }

    /// Reset the detector state
    pub fn reset(&mut self) {
        self.window.clear();
        self.consecutive_loops = 0;
    }

    /// Generate a fingerprint for a tool invocation: "name:hash8"
    fn fingerprint(tool_name: &str, input: &Value) -> String {
        let input_str = input.to_string();
        let mut hasher = DefaultHasher::new();
        input_str.hash(&mut hasher);
        let hash = hasher.finish();
        let hash_short = format!("{:08x}", hash % 0xFFFFFFFF);
        format!("{}:{}", tool_name, hash_short)
    }

    /// Check if a loop is detected in the current window.
    /// 两种检测策略：
    /// 1. 单指纹重复：任一指纹出现 >= repeat_threshold 次
    /// 2. 重复率：窗口内 >70% 的指纹是重复的（unique / total < 0.3）
    fn detect_loop(&self) -> bool {
        if self.window.len() < self.repeat_threshold {
            return false;
        }

        let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for fp in &self.window {
            *counts.entry(fp.as_str()).or_insert(0) += 1;
        }

        // 策略1: 单指纹重复次数超过阈值
        if counts.values().any(|&count| count >= self.repeat_threshold) {
            return true;
        }

        // 策略2: 窗口内重复率 >70%（unique 种类 < 30% 的窗口大小）
        if self.window.len() >= 4 {
            let unique_count = counts.len();
            let total = self.window.len();
            let unique_ratio = unique_count as f64 / total as f64;
            if unique_ratio < 0.3 {
                return true;
            }
        }

        false
    }
}

impl Default for LoopDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loop_detection() {
        let mut detector = LoopDetector::new();
        let input = serde_json::json!({"test": "value"});

        // First call: no loop (count=1)
        assert!(!detector.record("tool1", &input));

        // Second identical call: loop detected (count=2, triggers threshold)
        assert!(detector.record("tool1", &input));

        // Third call: still detected (count=3)
        assert!(detector.record("tool1", &input));
    }

    #[test]
    fn test_different_tools_no_loop() {
        let mut detector = LoopDetector::new();
        let input = serde_json::json!({"test": "value"});

        // Different tools: no loop
        assert!(!detector.record("tool1", &input));
        assert!(!detector.record("tool2", &input));
        assert!(!detector.record("tool3", &input));
    }

    #[test]
    fn test_window_sliding() {
        let mut detector = LoopDetector::new();
        let input1 = serde_json::json!({"test": "1"});
        let input2 = serde_json::json!({"test": "2"});

        // Fill window beyond threshold
        for _ in 0..7 {
            detector.record("tool1", &input1);
        }
        // Mix in different tool to dilute
        detector.record("tool2", &input2);

        // Window should have slid
        assert_eq!(detector.window.len(), 6);
    }
}
