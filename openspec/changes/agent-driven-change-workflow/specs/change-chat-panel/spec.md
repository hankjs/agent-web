## ADDED Requirements

### Requirement: Changes button in Chat header
The system SHALL display a "Changes" button in the Chat header (right side) that opens a panel showing Changes associated with the current session's `work_dir`.

#### Scenario: Button visible in Chat
- **WHEN** a user is in a Chat session that has a `work_dir` set
- **THEN** a "Changes" button is visible in the Chat header area

#### Scenario: Button hidden without work_dir
- **WHEN** a user is in a Chat session without a `work_dir`
- **THEN** the "Changes" button is not displayed

### Requirement: Changes panel filtered by work_dir
The panel SHALL list Changes filtered by the current session's `work_dir`. Each Change SHALL display: name, status badge, and task progress (done/total).

#### Scenario: Panel shows filtered changes
- **WHEN** the user clicks the "Changes" button
- **THEN** a panel opens showing only Changes whose `work_dir` matches the current session's work_dir

#### Scenario: Empty state
- **WHEN** no Changes exist for the current work_dir
- **THEN** the panel shows "No changes" with a "New Change" button

### Requirement: Change actions in panel
Each Change in the panel SHALL offer contextual actions based on its state: "Explore" (opens dedicated Explore session), "Generate" (triggers artifact generation), "Apply" (injects context into current Chat), "View" (navigates to Change detail page).

#### Scenario: Draft change actions
- **WHEN** a Change is in `draft` status with no explore completed
- **THEN** available actions are "Explore" and "View"

#### Scenario: Explore completed actions
- **WHEN** a Change has completed Explore but not Generated
- **THEN** available actions are "Generate" and "View"

#### Scenario: Artifacts confirmed actions
- **WHEN** a Change has confirmed artifacts with pending tasks
- **THEN** available actions are "Apply" and "View"

#### Scenario: All tasks done actions
- **WHEN** a Change has all tasks marked done
- **THEN** available actions are "Archive" and "View"

### Requirement: Panel real-time updates
The panel SHALL update in real-time when SSE events indicate changes to task status, explore completion, or generate completion.

#### Scenario: Task progress updates
- **WHEN** a `task_updated` SSE event is received for a Change in the panel
- **THEN** the task progress display updates immediately

#### Scenario: Explore complete updates
- **WHEN** an `explore_complete` SSE event is received
- **THEN** the Change's available actions update to show "Generate"

### Requirement: New Change creation from panel
The panel SHALL provide a "New Change" button that creates a Change bound to the current session's `work_dir` and immediately opens the Explore phase.

#### Scenario: Create change from panel
- **WHEN** the user clicks "New Change" and enters a name
- **THEN** a Change is created with the current session's work_dir and Explore begins

### Requirement: Interactive options UI for ask_user
The client SHALL render `ask_user` SSE events as interactive UI: clickable option buttons arranged vertically, plus a free-text input field at the bottom. Clicking an option or submitting text sends the reply as the next chat message.

#### Scenario: Render options
- **WHEN** an `ask_user` SSE event is received with question and options
- **THEN** the UI displays the question text, option buttons (one per option), and a text input for custom answers

#### Scenario: Click option sends reply
- **WHEN** the user clicks an option button
- **THEN** the option text is sent as a chat message to the session

#### Scenario: Free text reply
- **WHEN** the user types custom text and submits
- **THEN** the custom text is sent as a chat message to the session

#### Scenario: Options disabled after reply
- **WHEN** the user has replied (clicked option or submitted text)
- **THEN** the option buttons become disabled and show which was selected
