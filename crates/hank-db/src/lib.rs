use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{mysql::MySqlPoolOptions, MySqlPool};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

/// Retry a database operation with exponential backoff on connection errors.
macro_rules! db_retry {
    ($op:expr) => {{
        let mut attempts = 0u32;
        const MAX_RETRIES: u32 = 4;
        loop {
            match $op.await {
                Ok(v) => break Ok(v),
                Err(e) if attempts < MAX_RETRIES && is_connection_error(&e) => {
                    attempts += 1;
                    let delay_ms = 200u64 * (1u64 << (attempts - 1)); // 200, 400, 800, 1600ms
                    tracing::warn!("DB connection error (attempt {}/{}), retrying in {}ms: {}", attempts, MAX_RETRIES, delay_ms, e);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
                Err(e) => break Err(anyhow::Error::from(e)),
            }
        }
    }};
}

fn is_connection_error(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Io(_) => true,
        sqlx::Error::PoolClosed => true,
        sqlx::Error::PoolTimedOut => true,
        sqlx::Error::Protocol(_) => false,
        _ => {
            let msg = e.to_string().to_lowercase();
            msg.contains("broken pipe")
                || msg.contains("connection reset")
                || msg.contains("gone away")
                || msg.contains("lost connection")
        }
    }
}

#[derive(Clone)]
pub struct Database {
    pool: MySqlPool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub work_dir: Option<String>,
    pub active_leaf_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DbMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String, // JSON
    pub parent_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub preview: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AgentMetric {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u64,
    pub model: String,
    pub provider: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ToolExecution {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub tool_name: String,
    pub duration_ms: u64,
    pub is_error: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub content: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsOverview {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub avg_latency_ms: f64,
    pub total_llm_calls: u64,
    pub tool_error_count: u64,
    pub tool_total_count: u64,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        let connect_url = Self::maybe_setup_proxy_tunnel(database_url).await?;

        let pool = MySqlPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(10))
            .idle_timeout(Duration::from_secs(300))
            .max_lifetime(Duration::from_secs(1800))
            .test_before_acquire(true)
            .connect(&connect_url)
            .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL DEFAULT '',
                provider VARCHAR(64) NOT NULL DEFAULT 'anthropic',
                model VARCHAR(128) NOT NULL DEFAULT '',
                work_dir TEXT DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT NOW(),
                updated_at DATETIME NOT NULL DEFAULT NOW()
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(36) PRIMARY KEY,
                session_id VARCHAR(36) NOT NULL,
                role VARCHAR(16) NOT NULL,
                content MEDIUMTEXT NOT NULL,
                created_at DATETIME(6) NOT NULL DEFAULT NOW(6),
                seq BIGINT NOT NULL DEFAULT 0,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                INDEX idx_messages_session_seq (session_id, seq, created_at)
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        // Migration: add seq column if missing
        let _ = sqlx::query(
            "ALTER TABLE messages ADD COLUMN seq BIGINT NOT NULL DEFAULT 0"
        )
        .execute(&pool)
        .await;

        // Migration: upgrade created_at to microsecond precision
        let _ = sqlx::query(
            "ALTER TABLE messages MODIFY COLUMN created_at DATETIME(6) NOT NULL DEFAULT NOW(6)"
        )
        .execute(&pool)
        .await;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (
                `key` VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS agent_metrics (
                id VARCHAR(36) PRIMARY KEY,
                session_id VARCHAR(36) NOT NULL,
                message_id VARCHAR(36) DEFAULT NULL,
                input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
                output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
                latency_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
                model VARCHAR(128) NOT NULL DEFAULT '',
                provider VARCHAR(64) NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT NOW(),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                INDEX idx_agent_metrics_session (session_id)
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS tool_executions (
                id VARCHAR(36) PRIMARY KEY,
                session_id VARCHAR(36) NOT NULL,
                message_id VARCHAR(36) DEFAULT NULL,
                tool_name VARCHAR(128) NOT NULL,
                duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
                is_error BOOLEAN NOT NULL DEFAULT FALSE,
                created_at DATETIME NOT NULL DEFAULT NOW(),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                INDEX idx_tool_executions_session (session_id)
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS prompt_templates (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                content MEDIUMTEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT NOW(),
                INDEX idx_prompt_templates_name (name)
            ) DEFAULT CHARSET=utf8mb4",
        )
        .execute(&pool)
        .await?;

        // Migration: add work_dir column if missing
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN work_dir TEXT DEFAULT NULL AFTER model")
            .execute(&pool)
            .await;

        // Migration: add parent_id to messages
        let _ = sqlx::query("ALTER TABLE messages ADD COLUMN parent_id VARCHAR(36) DEFAULT NULL")
            .execute(&pool)
            .await;
        let _ = sqlx::query("CREATE INDEX idx_messages_parent ON messages (parent_id)")
            .execute(&pool)
            .await;

        // Migration: add active_leaf_id to sessions
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN active_leaf_id VARCHAR(36) DEFAULT NULL")
            .execute(&pool)
            .await;

        // Data migration: link existing messages by seq order and set active_leaf_id
        // Only run if there are messages without parent_id that should have one
        let unlinked: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT session_id FROM messages WHERE parent_id IS NULL"
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        for (sid,) in &unlinked {
            let msgs: Vec<(String,)> = sqlx::query_as(
                "SELECT id FROM messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC"
            )
            .bind(sid)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

            for i in 1..msgs.len() {
                let _ = sqlx::query("UPDATE messages SET parent_id = ? WHERE id = ?")
                    .bind(&msgs[i - 1].0)
                    .bind(&msgs[i].0)
                    .execute(&pool)
                    .await;
            }

            if let Some(last) = msgs.last() {
                let _ = sqlx::query("UPDATE sessions SET active_leaf_id = ? WHERE id = ? AND active_leaf_id IS NULL")
                    .bind(&last.0)
                    .bind(sid)
                    .execute(&pool)
                    .await;
            }
        }

        Ok(Self { pool })
    }

    // Sessions
    pub async fn create_session(&self, provider: &str, model: &str, work_dir: Option<&str>) -> Result<Session> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        db_retry!(
            sqlx::query(
                "INSERT INTO sessions (id, title, provider, model, work_dir, created_at, updated_at) VALUES (?, '', ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(provider)
            .bind(model)
            .bind(work_dir)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
        )?;

        Ok(Session {
            id,
            title: String::new(),
            provider: provider.to_string(),
            model: model.to_string(),
            work_dir: work_dir.map(|s| s.to_string()),
            active_leaf_id: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        let sessions = db_retry!(
            sqlx::query_as::<_, Session>(
                "SELECT id, title, provider, model, work_dir, active_leaf_id, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
            )
            .fetch_all(&self.pool)
        )?;
        Ok(sessions)
    }

    pub async fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let session = db_retry!(
            sqlx::query_as::<_, Session>(
                "SELECT id, title, provider, model, work_dir, active_leaf_id, created_at, updated_at FROM sessions WHERE id = ?"
            )
            .bind(id)
            .fetch_optional(&self.pool)
        )?;
        Ok(session)
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        db_retry!(
            sqlx::query("DELETE FROM sessions WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
        )?;
        Ok(())
    }

    pub async fn update_session_title(&self, id: &str, title: &str) -> Result<()> {
        db_retry!(
            sqlx::query("UPDATE sessions SET title = ?, updated_at = NOW() WHERE id = ?")
                .bind(title)
                .bind(id)
                .execute(&self.pool)
        )?;
        Ok(())
    }

    pub async fn update_session_work_dir(&self, id: &str, work_dir: Option<&str>) -> Result<()> {
        db_retry!(
            sqlx::query("UPDATE sessions SET work_dir = ?, updated_at = NOW() WHERE id = ?")
                .bind(work_dir)
                .bind(id)
                .execute(&self.pool)
        )?;
        Ok(())
    }

    // Messages
    pub async fn save_message(
        &self,
        session_id: &str,
        role: &str,
        content: &serde_json::Value,
        created_at: DateTime<Utc>,
        parent_id: Option<&str>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let content_str = serde_json::to_string(content)?;
        let seq = created_at.timestamp_micros();
        db_retry!(
            sqlx::query("INSERT INTO messages (id, session_id, role, content, created_at, seq, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .bind(&id)
                .bind(session_id)
                .bind(role)
                .bind(&content_str)
                .bind(created_at)
                .bind(seq)
                .bind(parent_id)
                .execute(&self.pool)
        )?;
        Ok(id)
    }

    pub async fn touch_session(&self, id: &str) -> Result<()> {
        db_retry!(
            sqlx::query("UPDATE sessions SET updated_at = NOW() WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
        )?;
        Ok(())
    }

    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<DbMessage>> {
        let messages = db_retry!(
            sqlx::query_as::<_, DbMessage>(
                "SELECT id, session_id, role, content, parent_id, created_at FROM messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC"
            )
            .bind(session_id)
            .fetch_all(&self.pool)
        )?;
        Ok(messages)
    }

    /// Walk from leaf_id up to root via parent_id, return messages in root-first order.
    pub async fn get_branch_messages(&self, session_id: &str, leaf_id: &str) -> Result<Vec<DbMessage>> {
        // Load all messages for the session into a map
        let all = self.get_messages(session_id).await?;
        let map: std::collections::HashMap<&str, &DbMessage> =
            all.iter().map(|m| (m.id.as_str(), m)).collect();

        let mut chain = Vec::new();
        let mut current_id = Some(leaf_id);
        while let Some(cid) = current_id {
            if let Some(msg) = map.get(cid) {
                chain.push((*msg).clone());
                current_id = msg.parent_id.as_deref();
            } else {
                break;
            }
        }
        chain.reverse();
        Ok(chain)
    }

    /// Return a flat list of tree nodes for the outline panel.
    pub async fn get_message_tree(&self, session_id: &str) -> Result<Vec<TreeNode>> {
        #[derive(sqlx::FromRow)]
        struct RawNode {
            id: String,
            parent_id: Option<String>,
            role: String,
            content: String,
            created_at: DateTime<Utc>,
        }

        let rows = db_retry!(
            sqlx::query_as::<_, RawNode>(
                "SELECT id, parent_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC"
            )
            .bind(session_id)
            .fetch_all(&self.pool)
        )?;

        let nodes = rows
            .into_iter()
            .map(|r| {
                // Extract preview: first 30 chars of text content
                let preview = extract_preview(&r.content, 30);
                TreeNode {
                    id: r.id,
                    parent_id: r.parent_id,
                    role: r.role,
                    preview,
                    created_at: r.created_at,
                }
            })
            .collect();
        Ok(nodes)
    }

    pub async fn update_active_leaf(&self, session_id: &str, leaf_id: &str) -> Result<()> {
        db_retry!(
            sqlx::query("UPDATE sessions SET active_leaf_id = ?, updated_at = NOW() WHERE id = ?")
                .bind(leaf_id)
                .bind(session_id)
                .execute(&self.pool)
        )?;
        Ok(())
    }

    pub async fn truncate_messages(&self, session_id: &str, keep_count: u32) -> Result<u64> {
        // Get IDs of messages to keep (first N by ordering)
        let kept_ids: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC LIMIT ?"
        )
        .bind(session_id)
        .bind(keep_count)
        .fetch_all(&self.pool)
        .await?;

        if kept_ids.is_empty() {
            // Delete all messages for this session
            let result = sqlx::query("DELETE FROM messages WHERE session_id = ?")
                .bind(session_id)
                .execute(&self.pool)
                .await?;
            return Ok(result.rows_affected());
        }

        let ids: Vec<&str> = kept_ids.iter().map(|r| r.0.as_str()).collect();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "DELETE FROM messages WHERE session_id = ? AND id NOT IN ({})",
            placeholders
        );

        let mut q = sqlx::query(&query).bind(session_id);
        for id in &ids {
            q = q.bind(id);
        }
        let result = q.execute(&self.pool).await?;
        Ok(result.rows_affected())
    }

    // Settings
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row = db_retry!(
            sqlx::query_as::<_, Setting>(
                "SELECT `key`, value FROM settings WHERE `key` = ?"
            )
            .bind(key)
            .fetch_optional(&self.pool)
        )?;
        Ok(row.map(|s| s.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        db_retry!(
            sqlx::query(
                "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)"
            )
            .bind(key)
            .bind(value)
            .execute(&self.pool)
        )?;
        Ok(())
    }

    // Agent Metrics
    pub async fn save_agent_metric(
        &self,
        session_id: &str,
        message_id: Option<&str>,
        input_tokens: u32,
        output_tokens: u32,
        latency_ms: u64,
        model: &str,
        provider: &str,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        db_retry!(
            sqlx::query(
                "INSERT INTO agent_metrics (id, session_id, message_id, input_tokens, output_tokens, latency_ms, model, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(session_id)
            .bind(message_id)
            .bind(input_tokens)
            .bind(output_tokens)
            .bind(latency_ms)
            .bind(model)
            .bind(provider)
            .execute(&self.pool)
        )?;
        Ok(id)
    }

    pub async fn get_session_metrics(&self, session_id: &str) -> Result<Vec<AgentMetric>> {
        let rows = db_retry!(
            sqlx::query_as::<_, AgentMetric>(
                "SELECT id, session_id, message_id, input_tokens, output_tokens, latency_ms, model, provider, created_at FROM agent_metrics WHERE session_id = ? ORDER BY created_at ASC"
            )
            .bind(session_id)
            .fetch_all(&self.pool)
        )?;
        Ok(rows)
    }

    // Tool Executions
    pub async fn save_tool_execution(
        &self,
        session_id: &str,
        message_id: Option<&str>,
        tool_name: &str,
        duration_ms: u64,
        is_error: bool,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        db_retry!(
            sqlx::query(
                "INSERT INTO tool_executions (id, session_id, message_id, tool_name, duration_ms, is_error) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(session_id)
            .bind(message_id)
            .bind(tool_name)
            .bind(duration_ms)
            .bind(is_error)
            .execute(&self.pool)
        )?;
        Ok(id)
    }

    pub async fn get_session_tool_executions(&self, session_id: &str) -> Result<Vec<ToolExecution>> {
        let rows = db_retry!(
            sqlx::query_as::<_, ToolExecution>(
                "SELECT id, session_id, message_id, tool_name, duration_ms, is_error, created_at FROM tool_executions WHERE session_id = ? ORDER BY created_at ASC"
            )
            .bind(session_id)
            .fetch_all(&self.pool)
        )?;
        Ok(rows)
    }

    // Prompt Templates
    pub async fn save_prompt_template(&self, name: &str, content: &str) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        // Get next version for this name
        let max_version: Option<(i32,)> = sqlx::query_as(
            "SELECT COALESCE(MAX(version), 0) FROM prompt_templates WHERE name = ?"
        )
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        let version = max_version.map(|r| r.0).unwrap_or(0) + 1;

        db_retry!(
            sqlx::query(
                "INSERT INTO prompt_templates (id, name, content, version) VALUES (?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(name)
            .bind(content)
            .bind(version)
            .execute(&self.pool)
        )?;
        Ok(id)
    }

    pub async fn list_prompt_templates(&self) -> Result<Vec<PromptTemplate>> {
        let rows = db_retry!(
            sqlx::query_as::<_, PromptTemplate>(
                "SELECT id, name, content, version, created_at FROM prompt_templates ORDER BY name ASC, version DESC"
            )
            .fetch_all(&self.pool)
        )?;
        Ok(rows)
    }

    pub async fn get_prompt_template(&self, id: &str) -> Result<Option<PromptTemplate>> {
        let row = db_retry!(
            sqlx::query_as::<_, PromptTemplate>(
                "SELECT id, name, content, version, created_at FROM prompt_templates WHERE id = ?"
            )
            .bind(id)
            .fetch_optional(&self.pool)
        )?;
        Ok(row)
    }

    // Aggregated metrics for admin overview
    pub async fn get_metrics_overview(&self) -> Result<MetricsOverview> {
        #[derive(sqlx::FromRow)]
        struct AggRow {
            total_input_tokens: Option<i64>,
            total_output_tokens: Option<i64>,
            avg_latency_ms: Option<f64>,
            total_calls: i64,
        }
        let agg: AggRow = sqlx::query_as(
            "SELECT COALESCE(SUM(input_tokens), 0) as total_input_tokens, COALESCE(SUM(output_tokens), 0) as total_output_tokens, AVG(latency_ms) as avg_latency_ms, COUNT(*) as total_calls FROM agent_metrics"
        )
        .fetch_one(&self.pool)
        .await?;

        #[derive(sqlx::FromRow)]
        struct ErrRow {
            error_count: i64,
            total_count: i64,
        }
        let err: ErrRow = sqlx::query_as(
            "SELECT COALESCE(SUM(is_error), 0) as error_count, COUNT(*) as total_count FROM tool_executions"
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(MetricsOverview {
            total_input_tokens: agg.total_input_tokens.unwrap_or(0) as u64,
            total_output_tokens: agg.total_output_tokens.unwrap_or(0) as u64,
            avg_latency_ms: agg.avg_latency_ms.unwrap_or(0.0),
            total_llm_calls: agg.total_calls as u64,
            tool_error_count: err.error_count as u64,
            tool_total_count: err.total_count as u64,
        })
    }

    /// Detect proxy env vars and set up a local TCP tunnel if needed.
    /// Returns the database URL to use (possibly rewritten to point at localhost tunnel).
    async fn maybe_setup_proxy_tunnel(database_url: &str) -> Result<String> {
        let proxy_url = std::env::var("all_proxy")
            .or_else(|_| std::env::var("ALL_PROXY"))
            .or_else(|_| std::env::var("https_proxy"))
            .or_else(|_| std::env::var("HTTPS_PROXY"))
            .or_else(|_| std::env::var("http_proxy"))
            .or_else(|_| std::env::var("HTTP_PROXY"));

        let proxy_url = match proxy_url {
            Ok(u) if !u.is_empty() => u,
            _ => return Ok(database_url.to_string()),
        };

        // Parse the MySQL URL to extract host and port
        let parsed = url::Url::parse(database_url)?;
        let db_host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
        let db_port = parsed.port().unwrap_or(3306);

        // Parse proxy URL
        let proxy_parsed = url::Url::parse(&proxy_url)?;
        let proxy_host = proxy_parsed.host_str().unwrap_or("127.0.0.1").to_string();
        let proxy_port = proxy_parsed.port().unwrap_or(7890);

        // Bind a local listener on a random port
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let local_port = listener.local_addr()?.port();

        tracing::info!(
            "MySQL proxy tunnel: 127.0.0.1:{} -> {}:{} via {}:{}",
            local_port, db_host, db_port, proxy_host, proxy_port
        );

        // Spawn the tunnel forwarder
        let target_host = db_host.clone();
        let target_port = db_port;
        tokio::spawn(async move {
            loop {
                let (client, _) = match listener.accept().await {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!("Tunnel accept error: {}", e);
                        continue;
                    }
                };
                let proxy_h = proxy_host.clone();
                let target_h = target_host.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        Self::handle_tunnel(client, &proxy_h, proxy_port, &target_h, target_port).await
                    {
                        tracing::error!("Tunnel connection error: {}", e);
                    }
                });
            }
        });

        // Rewrite the database URL to connect through the local tunnel
        let mut new_url = parsed.clone();
        new_url.set_host(Some("127.0.0.1"))?;
        new_url.set_port(Some(local_port)).map_err(|_| anyhow::anyhow!("failed to set port"))?;

        Ok(new_url.to_string())
    }

    /// Establish an HTTP CONNECT tunnel through the proxy and relay data.
    async fn handle_tunnel(
        mut client: TcpStream,
        proxy_host: &str,
        proxy_port: u16,
        target_host: &str,
        target_port: u16,
    ) -> Result<()> {
        // Connect to the proxy
        let mut proxy = TcpStream::connect(format!("{}:{}", proxy_host, proxy_port)).await?;

        // Send HTTP CONNECT request
        let connect_req = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n",
            target_host, target_port, target_host, target_port
        );
        proxy.write_all(connect_req.as_bytes()).await?;

        // Read the proxy response
        let mut buf = [0u8; 1024];
        let n = proxy.read(&mut buf).await?;
        let response = String::from_utf8_lossy(&buf[..n]);

        if !response.contains("200") {
            anyhow::bail!("Proxy CONNECT failed: {}", response.trim());
        }

        // Relay data between client and proxy
        tokio::io::copy_bidirectional(&mut client, &mut proxy).await?;
        Ok(())
    }
}

/// Extract a text preview from JSON content (first text block, up to max_chars).
fn extract_preview(content_json: &str, max_chars: usize) -> String {
    if let Ok(blocks) = serde_json::from_str::<Vec<serde_json::Value>>(content_json) {
        for block in &blocks {
            // Only extract from direct text blocks: { "type": "text", "text": "..." }
            // Skip tool_result blocks — they are not user-authored content
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                continue;
            }
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                let preview: String = text.chars().take(max_chars).collect();
                return preview;
            }
        }
    }
    String::new()
}
