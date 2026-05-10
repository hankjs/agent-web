## ADDED Requirements

### Requirement: Accept local event reports from client
The server SHALL provide an API endpoint for clients to upload local ACP execution records.

#### Scenario: Successful upload
- **WHEN** client POSTs a batch of local execution events to `/api/sessions/{id}/local-events`
- **THEN** server stores the events in the database associated with the session

#### Scenario: Invalid session
- **WHEN** client POSTs local events for a non-existent session ID
- **THEN** server responds with 404

#### Scenario: Unauthorized request
- **WHEN** client POSTs local events without valid auth token
- **THEN** server responds with 401

### Requirement: Store local execution events
The server SHALL persist local execution events with source metadata.

#### Scenario: Event stored with source marker
- **WHEN** a local event is stored
- **THEN** the record includes `source: "local"`, the agent type, timestamp, and full event payload

#### Scenario: Query events by source
- **WHEN** client requests session history
- **THEN** response includes both remote and local events, each marked with their source

### Requirement: Session model supports local agent metadata
The server SHALL store local agent configuration on the session record.

#### Scenario: Update session with local agent info
- **WHEN** client sends a PUT to update session with `local_agent` and `local_work_dir`
- **THEN** server persists these fields on the session record

#### Scenario: Session response includes local fields
- **WHEN** client fetches a session
- **THEN** response includes `local_agent` and `local_work_dir` fields (nullable)
