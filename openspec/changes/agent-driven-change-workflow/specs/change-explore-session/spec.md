## ADDED Requirements

### Requirement: Dedicated session creation for Change
The system SHALL create a dedicated session when a Change enters Explore phase. The session SHALL have `change_id` set to the Change's ID and `work_dir` set to the Change's work directory.

#### Scenario: Start Explore creates session
- **WHEN** a user initiates Explore on a Change that has no dedicated session
- **THEN** the system creates a new session with `change_id` = Change ID, `work_dir` = Change's work_dir, and title = "Explore: {change_name}"

#### Scenario: Reuse existing dedicated session
- **WHEN** a user initiates Explore on a Change that already has a dedicated session
- **THEN** the system reuses the existing session (does not create a new one)

### Requirement: Explore system prompt
The system SHALL use a specialized system prompt for Explore sessions that instructs the agent to read project files and ask clarifying questions via `ask_user` tool.

#### Scenario: Explore session system prompt
- **WHEN** an Explore session starts a new agent turn
- **THEN** the system prompt includes instructions to: read project files in work_dir, use ask_user to present questions, and call finalize_explore when sufficient context is gathered

### Requirement: Explore finalization
The system SHALL provide a `finalize_explore` tool that the agent calls when it has gathered enough context. This tool signals that Explore is complete and the Change is ready for Generate.

#### Scenario: Agent finalizes explore
- **WHEN** the agent calls `finalize_explore` with `{ summary: string }`
- **THEN** the system stores the summary on the Change record, marks explore as complete, and emits an `ExploreComplete` SSE event

#### Scenario: Explore summary persistence
- **WHEN** `finalize_explore` is called
- **THEN** the Change's `explore_summary` field is updated with the provided summary text

### Requirement: Explore conversation independence
The Explore session SHALL be independent from regular Chat sessions. Messages in the Explore session SHALL NOT appear in other sessions. The Explore session SHALL only be accessible via the Change's Explore UI.

#### Scenario: Explore messages isolated
- **WHEN** a user opens a regular Chat session for the same work_dir
- **THEN** the Explore session's messages are not visible

### Requirement: Change work_dir binding
The system SHALL require a `work_dir` when creating a Change. The `work_dir` field SHALL be stored on the `changes` table and used to associate Changes with Sessions sharing the same work directory.

#### Scenario: Create change with work_dir
- **WHEN** a user creates a Change with `{ name: "...", work_dir: "/path/to/project" }`
- **THEN** the Change is stored with the specified work_dir

#### Scenario: List changes by work_dir
- **WHEN** the API is called with `GET /api/changes?work_dir=/path/to/project`
- **THEN** only Changes matching that work_dir are returned
