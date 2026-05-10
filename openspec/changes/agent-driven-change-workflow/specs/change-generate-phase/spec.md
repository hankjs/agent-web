## ADDED Requirements

### Requirement: Generate trigger
The system SHALL provide a `POST /api/changes/:id/generate` endpoint that triggers artifact generation. This endpoint SHALL start a new agent turn on the Change's dedicated session with a Generate-specific system prompt.

#### Scenario: Trigger generate after explore
- **WHEN** a user calls `POST /api/changes/:id/generate` on a Change with completed Explore
- **THEN** the system starts an agent turn with Generate system prompt and full Explore conversation as context

#### Scenario: Generate without explore
- **WHEN** a user calls `POST /api/changes/:id/generate` on a Change without completed Explore
- **THEN** the system returns 400 error indicating Explore must be completed first

### Requirement: Generate system prompt
The system SHALL use a system prompt for Generate that instructs the agent to produce all artifacts (proposal, design, specs, tasks) in a single structured output via the `generate_artifacts` tool.

#### Scenario: Generate prompt content
- **WHEN** a Generate turn starts
- **THEN** the system prompt instructs the agent to synthesize Explore context into structured artifacts and call `generate_artifacts` with the complete set

### Requirement: generate_artifacts tool
The system SHALL provide a `generate_artifacts` tool that accepts structured JSON containing all artifact contents: `{ proposal: string, design: string, specs: Array<{capability: string, content: string}>, tasks: Array<{group: string, tasks: string[]}> }`.

#### Scenario: Agent calls generate_artifacts
- **WHEN** the agent calls `generate_artifacts` with valid structured content
- **THEN** the system stores each artifact with status `draft` on the Change

#### Scenario: Invalid artifact structure
- **WHEN** the agent calls `generate_artifacts` with missing required fields
- **THEN** the tool returns an error indicating which fields are missing

### Requirement: Draft artifact storage
The system SHALL store generated artifacts with status `draft`. Draft artifacts SHALL be visible to the client for review but SHALL NOT be considered finalized until confirmed.

#### Scenario: Artifacts stored as draft
- **WHEN** `generate_artifacts` completes successfully
- **THEN** all artifacts are stored in `change_artifacts` with `status = 'draft'`

#### Scenario: List draft artifacts
- **WHEN** the client calls `GET /api/changes/:id/artifacts`
- **THEN** draft artifacts are returned with their status field indicating `draft`

### Requirement: Artifact review and confirmation
The system SHALL provide a `POST /api/changes/:id/artifacts/confirm` endpoint that marks all draft artifacts as confirmed. The client MAY edit artifact content before confirming.

#### Scenario: Confirm all artifacts
- **WHEN** the client calls `POST /api/changes/:id/artifacts/confirm`
- **THEN** all draft artifacts for the Change are updated to `status = 'confirmed'`

#### Scenario: Edit before confirm
- **WHEN** the client calls `PUT /api/changes/:id/artifacts/:aid` with updated content while status is `draft`
- **THEN** the artifact content is updated and status remains `draft`

### Requirement: Generate completion event
The system SHALL emit a `GenerateComplete` SSE event when the `generate_artifacts` tool finishes successfully, containing the Change ID and artifact count.

#### Scenario: SSE event on generate complete
- **WHEN** `generate_artifacts` tool executes successfully
- **THEN** an SSE event of type `generate_complete` is emitted with `{ change_id, artifact_count }`
