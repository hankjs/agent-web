## ADDED Requirements

### Requirement: ask_user tool schema
The system SHALL provide an `ask_user` tool with input schema: `{ question: string, options: string[] }`. The `question` field is required and describes what the agent is asking. The `options` field is required and contains 2-6 selectable choices.

#### Scenario: Valid ask_user tool call
- **WHEN** the agent calls `ask_user` with `{ "question": "Which database?", "options": ["PostgreSQL", "MySQL", "SQLite"] }`
- **THEN** the tool is recognized and processed by the agent loop

#### Scenario: Missing required fields
- **WHEN** the agent calls `ask_user` without `question` or `options`
- **THEN** the tool returns an error result indicating missing required fields

### Requirement: Agent loop interruption on ask_user
The system SHALL detect `ask_user` tool calls in the agent execution loop and interrupt the turn. The assistant message (containing the tool_use block) SHALL be saved to conversation history. The agent loop SHALL NOT continue iterating after `ask_user`.

#### Scenario: Agent calls ask_user mid-turn
- **WHEN** the agent's response contains a `tool_use` block with name `ask_user`
- **THEN** the system executes the tool, emits an `AskUser` SSE event, saves the assistant message, and breaks the agent loop

#### Scenario: Multiple tools in same response including ask_user
- **WHEN** the agent's response contains multiple tool_use blocks and one is `ask_user`
- **THEN** the system executes tools in order, and upon reaching `ask_user`, stops processing remaining tools and breaks the loop

### Requirement: AskUser SSE event emission
The system SHALL emit an `AskUser` event via SSE containing `question`, `options`, and `tool_use_id` fields when the agent calls `ask_user`.

#### Scenario: SSE event delivery
- **WHEN** the agent loop processes an `ask_user` tool call
- **THEN** an SSE event of type `ask_user` is emitted with `{ question, options, tool_use_id }`

### Requirement: Pending ask_user state persistence
The system SHALL store pending ask_user state on the session record as JSON: `{ tool_use_id, question, options }`. This state SHALL be cleared when the user replies.

#### Scenario: State saved after ask_user
- **WHEN** the agent loop breaks due to `ask_user`
- **THEN** the session's `pending_ask_user` field is set to `{ tool_use_id, question, options }`

#### Scenario: State cleared on user reply
- **WHEN** a user sends a message to a session with `pending_ask_user` set
- **THEN** the `pending_ask_user` field is cleared to NULL

### Requirement: Resume agent with user choice
The system SHALL resume the agent conversation when the user replies to a pending `ask_user`. The reply SHALL be formatted as a `tool_result` message for the stored `tool_use_id`, with the user's choice as content.

#### Scenario: User selects an option
- **WHEN** the user sends a message to a session with pending ask_user state
- **THEN** the system constructs history with the saved assistant tool_use message followed by a user tool_result message containing the user's reply, then starts a new agent turn

#### Scenario: User provides free text instead of selecting an option
- **WHEN** the user types custom text instead of clicking an option
- **THEN** the system uses the custom text as the tool_result content and resumes normally
