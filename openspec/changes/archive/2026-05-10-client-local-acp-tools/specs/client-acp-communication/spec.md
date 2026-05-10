## ADDED Requirements

### Requirement: Initialize ACP connection
The system SHALL send an ACP `initialize` request to the agent process after spawn, declaring client capabilities.

#### Scenario: Successful initialization
- **WHEN** agent process is spawned and stdio is ready
- **THEN** system sends `initialize` with client capabilities (fs.readTextFile, fs.writeTextFile) and receives agent capabilities in response

#### Scenario: Initialization timeout
- **WHEN** agent does not respond to `initialize` within 10 seconds
- **THEN** system kills the process and emits an error event

### Requirement: Create ACP session
The system SHALL create a new ACP session with the user's local work directory.

#### Scenario: New session
- **WHEN** user starts a local agent conversation with a selected work directory
- **THEN** system sends `session/new` with the work directory path and receives a session ID

### Requirement: Send prompt to ACP agent
The system SHALL forward user messages to the ACP agent via the `prompt` method.

#### Scenario: Send user message
- **WHEN** user sends a message routed to the local agent
- **THEN** system sends a `prompt` request with the message content to the active ACP session

### Requirement: Receive streaming session notifications
The system SHALL process ACP `SessionNotification` events and convert them to frontend-compatible events.

#### Scenario: Text content chunk
- **WHEN** agent sends a SessionNotification with a text content delta
- **THEN** system emits a Tauri event with type `text_delta` and the content string

#### Scenario: Tool use notification
- **WHEN** agent sends a SessionNotification indicating a tool call start
- **THEN** system emits a Tauri event with type `tool_use` containing tool name and input

#### Scenario: Tool result notification
- **WHEN** agent sends a SessionNotification with a tool call result
- **THEN** system emits a Tauri event with type `tool_result` containing the output

#### Scenario: Session complete
- **WHEN** agent sends a SessionNotification with stop reason
- **THEN** system emits a Tauri event with type `done` and the stop reason

### Requirement: Respond to agent file read requests
The system SHALL respond to ACP `ReadTextFile` requests from the agent by reading the local file system.

#### Scenario: Read existing file
- **WHEN** agent requests to read a file that exists within the work directory
- **THEN** system reads the file content and responds with the content string

#### Scenario: Read non-existent file
- **WHEN** agent requests to read a file that does not exist
- **THEN** system responds with an error indicating file not found

### Requirement: Respond to agent file write requests
The system SHALL respond to ACP `WriteTextFile` requests from the agent by writing to the local file system.

#### Scenario: Write file
- **WHEN** agent requests to write content to a file path within the work directory
- **THEN** system writes the content to the file and responds with success

### Requirement: Handle permission requests
The system SHALL auto-approve ACP `RequestPermission` requests in MVP.

#### Scenario: Permission requested
- **WHEN** agent sends a RequestPermission for a tool operation
- **THEN** system responds with outcome "allow"

### Requirement: Cancel active prompt
The system SHALL support cancelling an in-progress ACP prompt.

#### Scenario: User cancels
- **WHEN** user clicks stop/cancel while local agent is processing
- **THEN** system sends `session/cancel` notification to the ACP agent
