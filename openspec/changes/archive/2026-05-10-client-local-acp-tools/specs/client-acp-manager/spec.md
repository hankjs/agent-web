## ADDED Requirements

### Requirement: Spawn ACP agent process
The system SHALL spawn a local ACP agent process (e.g. `claude-agent-acp`, `codex`) as a child process with stdio pipes for JSON-RPC communication.

#### Scenario: Spawn configured agent
- **WHEN** user triggers a local agent session and a valid agent path is configured
- **THEN** Tauri spawns the agent process with stdin/stdout pipes and the configured work directory as cwd

#### Scenario: Agent path not configured
- **WHEN** user triggers a local agent session but no agent path is configured
- **THEN** system displays an error directing user to configure the agent path in settings

#### Scenario: Agent binary not found
- **WHEN** the configured agent path does not exist or is not executable
- **THEN** system displays an error indicating the agent binary was not found

### Requirement: Stop ACP agent process
The system SHALL be able to gracefully stop a running ACP agent process.

#### Scenario: Graceful stop
- **WHEN** user requests to stop the local agent or closes the session
- **THEN** system sends SIGTERM to the agent process and waits up to 5 seconds for exit

#### Scenario: Force kill on timeout
- **WHEN** agent process does not exit within 5 seconds after SIGTERM
- **THEN** system sends SIGKILL to force terminate the process

### Requirement: Monitor agent process health
The system SHALL monitor the ACP agent process and detect unexpected exits.

#### Scenario: Agent crashes
- **WHEN** the ACP agent process exits unexpectedly (non-zero exit code)
- **THEN** system emits an error event to the frontend with the exit code and any stderr output

#### Scenario: Agent exits normally
- **WHEN** the ACP agent process exits with code 0
- **THEN** system marks the local session as inactive

### Requirement: Manage multiple agent configurations
The system SHALL support configuring multiple ACP agent types, each with its own binary path.

#### Scenario: List configured agents
- **WHEN** user opens local agent settings
- **THEN** system displays all configured agents with their name, path, and detected status

#### Scenario: Add agent configuration
- **WHEN** user adds a new agent with name and executable path
- **THEN** system persists the configuration to local storage

#### Scenario: Remove agent configuration
- **WHEN** user removes an agent configuration
- **THEN** system removes it from local storage and stops any running process for that agent
