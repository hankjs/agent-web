## MODIFIED Requirements

### Requirement: Display environment selector
The system SHALL determine the execution environment (remote or local) at session creation time based on the work directory tab selection, not via a runtime toggle in the chat interface. The Chat header SHALL also include a "Changes" button (right side) when the session has a `work_dir` set, which opens the Changes panel.

#### Scenario: Create session with Server environment
- **WHEN** user selects the "Server" tab and picks a server-side work directory
- **THEN** session is created with environment="remote" and messages are routed to the Hank Server

#### Scenario: Create session with Local environment
- **WHEN** user selects the "本机" tab and picks a local work directory via Tauri dialog
- **THEN** session is created with environment="local" and messages are routed to the local ACP agent

#### Scenario: Environment is fixed after creation
- **WHEN** a session has been created with a specific environment
- **THEN** the environment cannot be changed for that session

#### Scenario: Changes button in Chat header
- **WHEN** a session has a `work_dir` set (either remote or local)
- **THEN** a "Changes" button is displayed in the Chat header right area, opening the Changes panel on click
