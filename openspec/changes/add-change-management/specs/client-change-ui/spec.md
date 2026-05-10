## ADDED Requirements

### Requirement: Specs page
The system SHALL provide a dedicated page for browsing and managing project specs.

#### Scenario: View specs list
- **WHEN** user navigates to the Specs page
- **THEN** system displays all specs as a list with capability name, title, version number, and last updated time

#### Scenario: View spec detail
- **WHEN** user clicks on a spec in the list
- **THEN** system displays the spec's full markdown content rendered, with an edit button

#### Scenario: Edit spec inline
- **WHEN** user clicks edit on a spec
- **THEN** system shows a markdown editor with the current content, and a save button that calls PUT /api/specs/:id

#### Scenario: Create new spec
- **WHEN** user clicks "New Spec" button
- **THEN** system shows a form with capability name, title, and content fields, and creates the spec on submit

### Requirement: Changes list page
The system SHALL provide a page listing all changes with status and progress.

#### Scenario: View changes list
- **WHEN** user navigates to the Changes page
- **THEN** system displays all non-archived changes as cards showing name, status badge, task progress bar (done/total), and last updated time

#### Scenario: Filter changes by status
- **WHEN** user selects a status filter tab (All / Draft / In Progress / Completed)
- **THEN** system filters the displayed changes to match the selected status

#### Scenario: Create new change
- **WHEN** user clicks "New Change" button and enters a name
- **THEN** system creates the change and navigates to its detail page

### Requirement: Change detail page
The system SHALL provide a detail page for a change with tabs for Proposal, Design, Specs, and Tasks.

#### Scenario: View proposal tab
- **WHEN** user views the Proposal tab of a change
- **THEN** system renders the proposal artifact's markdown content, or shows an empty state with "Create Proposal" button if none exists

#### Scenario: Edit proposal
- **WHEN** user clicks edit on the proposal tab
- **THEN** system shows a markdown editor for the proposal content and metadata JSON editor, with save button

#### Scenario: View design tab
- **WHEN** user views the Design tab of a change
- **THEN** system renders the design artifact's markdown content, or shows empty state

#### Scenario: View specs tab
- **WHEN** user views the Specs tab of a change
- **THEN** system lists all spec artifacts for this change by capability name, each expandable to show content

#### Scenario: View tasks tab
- **WHEN** user views the Tasks tab of a change
- **THEN** system displays tasks grouped by group_name with progress count per group, each task showing checkbox (toggles status), title, and status badge

#### Scenario: Toggle task status
- **WHEN** user clicks a task checkbox in the Tasks tab
- **THEN** system calls PUT /api/changes/:id/tasks/:task_id/status to toggle between pending and done

#### Scenario: Archive change
- **WHEN** user clicks "Archive" button on a completed change (all tasks done)
- **THEN** system calls POST /api/changes/:id/archive and navigates back to changes list

### Requirement: Chat Spec panel
The system SHALL provide a collapsible side panel in the Chat view for managing change context injection.

#### Scenario: Open Spec panel
- **WHEN** user clicks the Spec panel toggle in Chat view
- **THEN** system shows a side panel listing all non-archived changes with name, status, and task progress

#### Scenario: Inject change context
- **WHEN** user clicks a change in the Spec panel
- **THEN** system fetches GET /api/changes/:id/context and marks the change as "injected", showing its tasks in the panel below the list

#### Scenario: View injected change tasks
- **WHEN** a change is injected in the Spec panel
- **THEN** system displays the change's tasks with real-time status (updated via SSE events), grouped by group_name

#### Scenario: Real-time task update in panel
- **WHEN** an SSE event of type 'task_updated' is received for the injected change
- **THEN** system updates the corresponding task's status in the Spec panel without full refresh

#### Scenario: Dismiss injected change
- **WHEN** user clicks dismiss/close on the injected change section
- **THEN** system removes the change context from the current chat session and collapses the task view
