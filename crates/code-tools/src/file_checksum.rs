use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;
use tokio::sync::RwLock;

/// 共享的文件 checksum 存储，用于检测外部修改冲突
pub type ChecksumStore = Arc<RwLock<HashMap<String, u64>>>;

/// 创建新的 ChecksumStore
pub fn new_checksum_store() -> ChecksumStore {
    Arc::new(RwLock::new(HashMap::new()))
}

/// 计算内容的 checksum
pub fn compute_checksum(content: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}
