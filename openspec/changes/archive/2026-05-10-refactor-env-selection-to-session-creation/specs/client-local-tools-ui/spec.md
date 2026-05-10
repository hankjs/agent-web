## MODIFIED Requirements

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

### Requirement: Local work directory picker
The system SHALL allow users to select a local work directory during session creation when the "本机" tab is active.

#### Scenario: Select local directory at session creation
- **WHEN** user is on the "本机" tab in the session creation UI
- **THEN** system displays a button that opens a native folder picker dialog (Tauri dialog plugin)
- **THEN** selected path is stored as the session's local_work_dir

#### Scenario: Local tab hidden in non-Tauri environment
- **WHEN** the application is running outside of Tauri (pure web)
- **THEN** the "本机" tab is hidden and only "Server" tab is available

## REMOVED Requirements

### Requirement: Runtime environment switching in chat
**Reason**: Environment is now determined at session creation time, not at runtime in the chat interface.
**Migration**: Users select environment via tab when creating a session. Existing sessions default to "remote".
