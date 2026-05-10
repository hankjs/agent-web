## ADDED Requirements

### Requirement: Display environment selector
The system SHALL determine the execution environment (remote or local) at session creation time based on the work directory tab selection, not via a runtime toggle in the chat interface.

#### Scenario: Create session with Server environment
- **WHEN** user selects the "Server" tab and picks a server-side work directory
- **THEN** session is created with environment="remote" and messages are routed to the Hank Server

#### Scenario: Create session with Local environment
- **WHEN** user selects the "本机" tab and picks a local work directory via Tauri dialog
- **THEN** session is created with environment="local" and messages are routed to the local ACP agent

#### Scenario: Environment is fixed after creation
- **WHEN** a session has been created with a specific environment
- **THEN** the environment cannot be changed for that session

### Requirement: Display local agent status
The system SHALL show the current status of the local ACP agent in the UI.

#### Scenario: Agent running
- **WHEN** local ACP agent process is active and initialized
- **THEN** UI displays a green status indicator with "Running"

#### Scenario: Agent not configured
- **WHEN** no local agent is configured
- **THEN** UI displays a prompt to configure in settings

#### Scenario: Agent stopped/crashed
- **WHEN** local agent process is not running
- **THEN** UI displays status as "Stopped" with a restart button

### Requirement: Separate tool execution display by environment
The system SHALL visually distinguish tool executions from remote and local environments in the chat view.

#### Scenario: Remote tool execution
- **WHEN** a tool call is executed on the remote server
- **THEN** it is displayed with a "Server" label/badge

#### Scenario: Local tool execution
- **WHEN** a tool call is executed by the local ACP agent
- **THEN** it is displayed with a "Local" label/badge

### Requirement: Local work directory picker
The system SHALL allow users to select a local work directory during session creation when the "本机" tab is active.

#### Scenario: Select local directory at session creation
- **WHEN** user is on the "本机" tab in the session creation UI
- **THEN** system displays a button that opens a native folder picker dialog (Tauri dialog plugin)
- **THEN** selected path is stored as the session's local_work_dir

#### Scenario: Local tab hidden in non-Tauri environment
- **WHEN** the application is running outside of Tauri (pure web)
- **THEN** the "本机" tab is hidden and only "Server" tab is available

### Requirement: Local agent settings page
The system SHALL provide a settings page for configuring local ACP agents.

#### Scenario: View settings
- **WHEN** user navigates to local agent settings
- **THEN** system displays configured agents with name, path, and status

#### Scenario: Configure agent path
- **WHEN** user sets the path for an agent type (e.g. claude-agent-acp)
- **THEN** system persists the path and validates the binary exists

#### Scenario: Test agent connection
- **WHEN** user clicks "Test" on a configured agent
- **THEN** system spawns the agent, sends initialize, and reports success or failure
