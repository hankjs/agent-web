## ADDED Requirements

### Requirement: Display environment selector
The system SHALL display an environment selector in the chat interface allowing the user to choose between remote (Server) and local (Client ACP) execution targets.

#### Scenario: Switch to local environment
- **WHEN** user selects "Local" environment in the chat interface
- **THEN** subsequent messages are routed to the local ACP agent

#### Scenario: Switch to remote environment
- **WHEN** user selects "Remote" environment in the chat interface
- **THEN** subsequent messages are routed to the Hank Server as before

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
The system SHALL allow users to select a local work directory for the ACP agent.

#### Scenario: Select local directory
- **WHEN** user clicks the local work directory picker
- **THEN** system opens a native folder picker dialog (Tauri dialog plugin)
- **THEN** selected path is stored as the local work directory for the session

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
