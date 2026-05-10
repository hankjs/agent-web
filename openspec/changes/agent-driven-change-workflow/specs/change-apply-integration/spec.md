## ADDED Requirements

### Requirement: Apply trigger from Chat
The system SHALL support applying a Change from within a Chat session. When the client sends a chat message with `apply_change_id` metadata, the server SHALL fetch the Change's context and augment the system prompt for that agent turn.

#### Scenario: Apply change via chat message
- **WHEN** the client sends `{ content: "...", apply_change_id: "change-uuid" }` to `POST /api/sessions/:id/chat`
- **THEN** the server fetches the Change context and prepends it to the system prompt for the agent turn

#### Scenario: Apply with no pending tasks
- **WHEN** the client sends apply_change_id for a Change with all tasks marked done
- **THEN** the server returns the context but notes all tasks are complete

### Requirement: Apply system prompt augmentation
The system SHALL construct an augmented system prompt that includes: the Change's specs (confirmed artifacts of type spec), the task list with current status, and instructions to implement pending tasks sequentially using available tools.

#### Scenario: System prompt content
- **WHEN** an apply turn starts
- **THEN** the system prompt includes: change name, spec content, grouped task list with checkboxes, and instruction to implement tasks and mark them done via UpdateTaskStatusTool

### Requirement: Apply context endpoint
The system SHALL provide `GET /api/changes/:id/apply-context` that returns a formatted markdown string suitable for system prompt injection, containing specs and tasks.

#### Scenario: Fetch apply context
- **WHEN** the client calls `GET /api/changes/:id/apply-context`
- **THEN** the response contains formatted markdown with specs and task list

### Requirement: Task progress during Apply
The agent SHALL call `UpdateTaskStatusTool` to mark tasks as done during Apply execution. The SpecPanel/ChatPanel SHALL reflect real-time task progress via existing `task_updated` SSE events.

#### Scenario: Agent marks task done
- **WHEN** the agent completes implementing a task during Apply
- **THEN** the agent calls UpdateTaskStatusTool with `{ change_id, task_id, status: "done" }`

#### Scenario: Real-time progress update
- **WHEN** a task_updated SSE event is received by the client
- **THEN** the Change panel updates the task's checkbox state immediately

### Requirement: Apply session association
The system SHALL associate the Chat session with the Change during Apply by setting `change_id` on the session record. This allows the session to be identified as working on a specific Change.

#### Scenario: Session linked to change on apply
- **WHEN** a chat message with `apply_change_id` is processed
- **THEN** the session's `change_id` field is set to the specified Change ID
