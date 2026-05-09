use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{mysql::MySqlPoolOptions, MySqlPool};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DbMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String, // JSON
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        let connect_url = Self::maybe_setup_proxy_tunnel(database_url).await?;

        let pool = MySqlPoolOptions::new()
            .max_connections(10)
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

        // Migration: add work_dir column if missing
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN work_dir TEXT DEFAULT NULL AFTER model")
            .execute(&pool)
            .await;

        Ok(Self { pool })
    }

    // Sessions
    pub async fn create_session(&self, provider: &str, model: &str, work_dir: Option<&str>) -> Result<Session> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
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
        .await?;

        Ok(Session {
            id,
            title: String::new(),
            provider: provider.to_string(),
            model: model.to_string(),
            work_dir: work_dir.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        let sessions = sqlx::query_as::<_, Session>(
            "SELECT id, title, provider, model, work_dir, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(sessions)
    }

    pub async fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let session = sqlx::query_as::<_, Session>(
            "SELECT id, title, provider, model, work_dir, created_at, updated_at FROM sessions WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(session)
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_session_title(&self, id: &str, title: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET title = ?, updated_at = NOW() WHERE id = ?")
            .bind(title)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // Messages
    pub async fn save_message(
        &self,
        session_id: &str,
        role: &str,
        content: &serde_json::Value,
        created_at: DateTime<Utc>,
    ) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let content_str = serde_json::to_string(content)?;
        let seq = created_at.timestamp_micros();
        sqlx::query("INSERT INTO messages (id, session_id, role, content, created_at, seq) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(session_id)
            .bind(role)
            .bind(&content_str)
            .bind(created_at)
            .bind(seq)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn touch_session(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET updated_at = NOW() WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<DbMessage>> {
        let messages = sqlx::query_as::<_, DbMessage>(
            "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY seq ASC, created_at ASC"
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(messages)
    }

    // Settings
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query_as::<_, Setting>(
            "SELECT `key`, value FROM settings WHERE `key` = ?"
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|s| s.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)"
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
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
