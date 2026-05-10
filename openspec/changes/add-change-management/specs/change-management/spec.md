## ADDED Requirements

### Requirement: Create change
The system SHALL allow creating a new change with a unique name and default status of 'draft'.

#### Scenario: Create change successfully
- **WHEN** client sends POST /api/changes with a name
- **THEN** system creates the change with status='draft' and returns the created change with id

#### Scenario: Duplicate change name
- **WHEN** client sends POST /api/changes with a name that already exists
- **THEN** system returns 400 error indicating name already exists

### Requirement: List changes
The system SHALL return changes with optional status filter.

#### Scenario: List all changes
- **WHEN** client sends GET /api/changes
- **THEN** system returns array of all non-archived changes with id, name, status, task progress summary, created_at, updated_at

#### Scenario: Filter by status
- **WHEN** client sends GET /api/changes?status=in_progress
- **THEN** system returns only changes with matching status

### Requirement: Get change detail
The system SHALL return a change with its artifacts summary and task progress.

#### Scenario: Get existing change
- **WHEN** client sends GET /api/changes/:id
- **THEN** system returns the change with list of artifacts (type, capability, updated_at) and task counts (total, done, in_progress, pending) grouped by group_name

### Requirement: Update change
The system SHALL allow updating a change's name and status.

#### Scenario: Update status to in_progress
- **WHEN** client sends PUT /api/changes/:id with status='in_progress'
- **THEN** system updates the change status and updated_at

#### Scenario: Update name
- **WHEN** client sends PUT /api/changes/:id with a new name
- **THEN** system updates the change name if the new name is unique

### Requirement: Delete change
The system SHALL allow deleting a change only when in draft status.

#### Scenario: Delete draft change
- **WHEN** client sends DELETE /api/changes/:id and the change status is 'draft'
- **THEN** system deletes the change and all associated artifacts and tasks

#### Scenario: Delete non-draft change
- **WHEN** client sends DELETE /api/changes/:id and the change status is not 'draft'
- **THEN** system returns 400 error indicating only draft changes can be deleted

### Requirement: Create artifact
The system SHALL allow creating an artifact (proposal/design/spec) for a change.

#### Scenario: Create proposal artifact
- **WHEN** client sends POST /api/changes/:id/artifacts with type='proposal', content, and optional metadata
- **THEN** system creates the artifact and returns it with id

#### Scenario: Create spec artifact with capability
- **WHEN** client sends POST /api/changes/:id/artifacts with type='spec', capability name, content, and optional metadata
- **THEN** system creates the spec artifact associated with the capability

#### Scenario: Duplicate artifact
- **WHEN** client sends POST /api/changes/:id/artifacts with a type+capability combination that already exists
- **THEN** system returns 400 error indicating artifact already exists

### Requirement: List artifacts
The system SHALL return all artifacts for a change.

#### Scenario: List change artifacts
- **WHEN** client sends GET /api/changes/:id/artifacts
- **THEN** system returns array of artifacts with id, type, capability, content, metadata, created_at, updated_at

### Requirement: Get artifact detail
The system SHALL return a single artifact by id.

#### Scenario: Get existing artifact
- **WHEN** client sends GET /api/changes/:id/artifacts/:artifact_id
- **THEN** system returns the artifact with all fields

### Requirement: Update artifact
The system SHALL allow updating an artifact's content and metadata.

#### Scenario: Update artifact content
- **WHEN** client sends PUT /api/changes/:id/artifacts/:artifact_id with new content and/or metadata
- **THEN** system updates the artifact and its updated_at timestamp

### Requirement: Delete artifact
The system SHALL allow deleting an artifact.

#### Scenario: Delete artifact
- **WHEN** client sends DELETE /api/changes/:id/artifacts/:artifact_id
- **THEN** system deletes the artifact

### Requirement: Create tasks in batch
The system SHALL allow batch creation of tasks for a change.

#### Scenario: Batch create tasks
- **WHEN** client sends POST /api/changes/:id/tasks with array of tasks (each having group_name, group_order, task_order, title, optional description)
- **THEN** system creates all tasks and returns them with ids

### Requirement: List tasks grouped
The system SHALL return all tasks for a change grouped by group_name.

#### Scenario: List tasks
- **WHEN** client sends GET /api/changes/:id/tasks
- **THEN** system returns tasks grouped by group_name, ordered by group_order then task_order, each with id, title, description, status, session_id

### Requirement: Update task
The system SHALL allow updating a task's status, title, or description.

#### Scenario: Update task status
- **WHEN** client sends PUT /api/changes/:id/tasks/:task_id with status='done'
- **THEN** system updates the task status and updated_at

#### Scenario: Update task title
- **WHEN** client sends PUT /api/changes/:id/tasks/:task_id with new title
- **THEN** system updates the task title

### Requirement: Delete task
The system SHALL allow deleting a task.

#### Scenario: Delete task
- **WHEN** client sends DELETE /api/changes/:id/tasks/:task_id
- **THEN** system deletes the task

### Requirement: Archive change
The system SHALL archive a change by merging delta specs into main specs and marking the change as archived.

#### Scenario: Archive completed change
- **WHEN** client sends POST /api/changes/:id/archive and all tasks are done
- **THEN** system merges each spec artifact's ADDED/MODIFIED/REMOVED requirements into the corresponding main spec (creating new specs if needed), increments main spec versions, sets change status to 'archived', and sets archived_at timestamp

#### Scenario: Archive with pending tasks
- **WHEN** client sends POST /api/changes/:id/archive and some tasks are not done
- **THEN** system returns 400 error indicating all tasks must be completed before archiving
