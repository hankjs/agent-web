use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{mysql::MySqlPoolOptions, MySqlPool};
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
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL DEFAULT '',
                provider VARCHAR(64) NOT NULL DEFAULT 'anthropic',
                model VARCHAR(128) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
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
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
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

        sqlx::query("UPDATE sessions SET updated_at = NOW() WHERE id = ?")
            .bind(session_id)
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
}
