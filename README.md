# Hank Agent Web

远程 AI Agent 服务 + Tauri 客户端。Agent 运行在服务器上执行 shell 命令，客户端通过 WebSocket 实时展示工作状态。

## 项目结构

```
server/              axum HTTP/WS 服务
crates/
  hank-provider/     LLM 多厂商抽象 (Anthropic, OpenAI 兼容)
  hank-agent/        Agent loop (消息历史 + tool calling)
  hank-web-tools/    服务端工具 (shell)
  hank-db/           SQLite 持久化
client/              Tauri v2 + Vue 3 客户端
```

## 前置要求

- Rust 1.75+
- Node.js 18+
- 至少一个 LLM API key (Anthropic / OpenAI / 兼容服务)

## 快速开始

### 1. 配置

```bash
cp config.example.toml config.toml
```

编辑 `config.toml`，填入 API key：

```toml
[[providers]]
name = "anthropic"
type = "anthropic"
api_key = "sk-ant-your-key-here"
base_url = "https://api.anthropic.com"
default_model = "sonnet"

[providers.models]
sonnet = "claude-sonnet-4-20250514"
opus = "claude-opus-4-20250514"
haiku = "claude-haiku-4-5-20251001"
```

### 2. 启动 Server

```bash
cargo run -p hank-server
```

默认监听 `0.0.0.0:3000`。

### 3. 启动 Client

```bash
cd client
npm install
npm run tauri dev
```

## 构建

### Server (Release)

```bash
cargo build --release -p hank-server
# 产物: target/release/hank-server
```

### Client (桌面应用)

```bash
cd client
npm run tauri build
# 产物在 src-tauri/target/release/bundle/
```

## API

### REST

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| POST | /api/auth/login | 获取 JWT token |
| GET | /api/providers | 可用 provider 和模型列表 |
| POST | /api/sessions | 创建会话 |
| GET | /api/sessions | 会话列表 |
| GET | /api/sessions/:id | 会话详情 |
| DELETE | /api/sessions/:id | 删除会话 |
| GET | /api/sessions/:id/messages | 会话消息历史 |
| PUT | /api/settings | 更新设置 |

### WebSocket

连接: `ws://localhost:3000/ws?token=<jwt>`

发送消息：

```json
{
  "type": "send_message",
  "content": "列出当前目录文件",
  "session_id": "xxx",
  "provider": "anthropic",
  "model": "sonnet"
}
```

`provider` 和 `model` 可选，不传则使用默认值。`model` 支持别名。

## 多 Provider 配置

支持同时配置多个 provider，每个有独立的 base_url、api_key 和默认模型：

```toml
[[providers]]
name = "deepseek"
type = "openai"
api_key = "sk-xxx"
base_url = "https://api.deepseek.com"
default_model = "chat"

[providers.models]
chat = "deepseek-chat"
reasoner = "deepseek-reasoner"
```

`type = "openai"` 兼容所有 OpenAI 格式的 API（DeepSeek、Groq 等）。
