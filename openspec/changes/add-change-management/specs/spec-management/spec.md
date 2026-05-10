## ADDED Requirements

### Requirement: Create spec
The system SHALL allow creating a new spec with a unique capability name, title, markdown content, and optional metadata JSON.

#### Scenario: Create spec successfully
- **WHEN** client sends POST /api/specs with capability, title, content, and optional metadata
- **THEN** system creates the spec with version=1 and returns the created spec with id

#### Scenario: Duplicate capability name
- **WHEN** client sends POST /api/specs with a capability name that already exists
- **THEN** system returns 400 error indicating capability name already exists

### Requirement: List specs
The system SHALL return all specs ordered by capability name.

#### Scenario: List all specs
- **WHEN** client sends GET /api/specs
- **THEN** system returns array of all specs with id, capability, title, version, metadata, created_at, updated_at

### Requirement: Get spec detail
The system SHALL return a single spec by id including full content.

#### Scenario: Get existing spec
- **WHEN** client sends GET /api/specs/:id
- **THEN** system returns the spec with all fields including content

#### Scenario: Get non-existent spec
- **WHEN** client sends GET /api/specs/:id with an id that does not exist
- **THEN** system returns 404 error

### Requirement: Update spec with version history
The system SHALL update a spec's content and/or metadata, increment the version, and store the previous version as a snapshot.

#### Scenario: Update spec content
- **WHEN** client sends PUT /api/specs/:id with new content
- **THEN** system stores current content+metadata into spec_versions with current version number, then updates the spec with new content and version+1

#### Scenario: Update spec metadata only
- **WHEN** client sends PUT /api/specs/:id with only metadata changes
- **THEN** system stores snapshot and increments version same as content update

### Requirement: Get spec version history
The system SHALL return all historical versions of a spec.

#### Scenario: List versions
- **WHEN** client sends GET /api/specs/:id/versions
- **THEN** system returns array of spec_versions ordered by version descending, each including version number, content, metadata, change_id, and created_at

### Requirement: Delete spec
The system SHALL allow deleting a spec and all its version history.

#### Scenario: Delete existing spec
- **WHEN** client sends DELETE /api/specs/:id
- **THEN** system deletes the spec and all associated spec_versions records
