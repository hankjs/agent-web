## ADDED Requirements

### Requirement: Get change context for agent
The system SHALL assemble a complete context document from a change's proposal, design, specs, and tasks for injection into agent system prompt.

#### Scenario: Get full context
- **WHEN** client sends GET /api/changes/:id/context
- **THEN** system returns a markdown text combining: change name as heading, proposal content, design content, all spec artifact contents, and task list with status markers ([x] for done, [ ] for pending/in_progress)

#### Scenario: Get context for change with no artifacts
- **WHEN** client sends GET /api/changes/:id/context and the change has no artifacts
- **THEN** system returns a minimal context with just the change name and empty sections

### Requirement: Agent update spec content
The system SHALL provide a tool that allows the agent to update a main spec's content during execution.

#### Scenario: Agent updates spec by capability name
- **WHEN** agent calls update_spec tool with capability name, new content, and reason
- **THEN** system updates the spec (version+1, stores snapshot), and emits a spec_updated event on the current session's SSE stream

#### Scenario: Agent updates non-existent spec
- **WHEN** agent calls update_spec tool with a capability name that does not exist
- **THEN** tool returns error indicating spec not found

### Requirement: Agent update task status
The system SHALL provide a tool that allows the agent to update a task's status during execution.

#### Scenario: Agent marks task as done
- **WHEN** agent calls update_task_status tool with task_id and status='done'
- **THEN** system updates the task status and emits a task_updated event on the current session's SSE stream

#### Scenario: Agent marks task as in_progress
- **WHEN** agent calls update_task_status tool with task_id and status='in_progress'
- **THEN** system updates the task status and emits a task_updated event on the current session's SSE stream

### Requirement: Agent update artifact content
The system SHALL provide a tool that allows the agent to update a change artifact's content during execution.

#### Scenario: Agent updates artifact
- **WHEN** agent calls update_artifact tool with artifact_id, new content, and optional metadata
- **THEN** system updates the artifact and emits an artifact_updated event on the current session's SSE stream

### Requirement: SSE event emission on state changes
The system SHALL emit events through the active session's SSE stream when specs, tasks, or artifacts are updated by agent tools.

#### Scenario: Task status change event
- **WHEN** a task status is updated via agent tool during an active chat session
- **THEN** system emits SSE event with type 'task_updated' containing task_id, new status, and change_id

#### Scenario: Spec content change event
- **WHEN** a spec is updated via agent tool during an active chat session
- **THEN** system emits SSE event with type 'spec_updated' containing spec_id, capability, and new version number

#### Scenario: Artifact change event
- **WHEN** an artifact is updated via agent tool during an active chat session
- **THEN** system emits SSE event with type 'artifact_updated' containing artifact_id, type, and change_id
