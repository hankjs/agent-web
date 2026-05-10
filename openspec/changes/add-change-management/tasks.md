## 1. Database: Tables & Migrations

- [x] 1.1 Create `specs` table (id, capability, title, content, metadata JSON, version, created_at, updated_at)
- [x] 1.2 Create `spec_versions` table (id, spec_id, version, content, metadata, change_id, created_at)
- [x] 1.3 Create `changes` table (id, name, status, created_at, updated_at, archived_at)
- [x] 1.4 Create `change_artifacts` table (id, change_id, type, capability, content, metadata JSON, created_at, updated_at) with unique key on (change_id, type, capability)
- [x] 1.5 Create `change_tasks` table (id, change_id, group_name, group_order, task_order, title, description, status, session_id, created_at, updated_at)

## 2. Database: CRUD Operations (hank-db)

- [x] 2.1 Implement specs CRUD: create_spec, list_specs, get_spec, update_spec, delete_spec
- [x] 2.2 Implement spec_versions: create_spec_version, list_spec_versions
- [x] 2.3 Implement changes CRUD: create_change, list_changes, get_change, update_change, delete_change
- [x] 2.4 Implement change_artifacts CRUD: create_artifact, list_artifacts, get_artifact, update_artifact, delete_artifact
- [x] 2.5 Implement change_tasks CRUD: batch_create_tasks, list_tasks_grouped, update_task, delete_task
- [x] 2.6 Implement get_change_detail (change + artifacts summary + task counts per group)
- [x] 2.7 Implement archive_change (merge delta specs to main specs, update versions, set archived status)

## 3. Server: Specs API Routes

- [x] 3.1 Add GET /api/specs — list all specs
- [x] 3.2 Add POST /api/specs — create spec
- [x] 3.3 Add GET /api/specs/:id — get spec detail
- [x] 3.4 Add PUT /api/specs/:id — update spec (version+1, store snapshot)
- [x] 3.5 Add GET /api/specs/:id/versions — list version history
- [x] 3.6 Add DELETE /api/specs/:id — delete spec and versions

## 4. Server: Changes API Routes

- [x] 4.1 Add GET /api/changes — list changes with optional status filter
- [x] 4.2 Add POST /api/changes — create change
- [x] 4.3 Add GET /api/changes/:id — get change detail (artifacts + task progress)
- [x] 4.4 Add PUT /api/changes/:id — update change (name, status)
- [x] 4.5 Add DELETE /api/changes/:id — delete change (draft only)
- [x] 4.6 Add POST /api/changes/:id/archive — archive change (merge specs)

## 5. Server: Artifacts & Tasks API Routes

- [x] 5.1 Add GET /api/changes/:id/artifacts — list artifacts
- [x] 5.2 Add POST /api/changes/:id/artifacts — create artifact
- [x] 5.3 Add GET /api/changes/:id/artifacts/:aid — get artifact
- [x] 5.4 Add PUT /api/changes/:id/artifacts/:aid — update artifact
- [x] 5.5 Add DELETE /api/changes/:id/artifacts/:aid — delete artifact
- [x] 5.6 Add GET /api/changes/:id/tasks — list tasks grouped
- [x] 5.7 Add POST /api/changes/:id/tasks — batch create tasks
- [x] 5.8 Add PUT /api/changes/:id/tasks/:tid — update task
- [x] 5.9 Add DELETE /api/changes/:id/tasks/:tid — delete task

## 6. Server: Context Injection & Agent Tools

- [x] 6.1 Add GET /api/changes/:id/context — assemble full context markdown
- [x] 6.2 Implement UpdateSpecTool (calls PUT /api/specs/:id, emits SSE event)
- [x] 6.3 Implement UpdateTaskStatusTool (calls PUT /api/changes/:cid/tasks/:tid, emits SSE event)
- [x] 6.4 Implement UpdateArtifactTool (calls PUT /api/changes/:cid/artifacts/:aid, emits SSE event)
- [x] 6.5 Register new tools in chat handler alongside existing tools
- [x] 6.6 Add SSE event types: task_updated, spec_updated, artifact_updated to agent event stream

## 7. Client: API Layer

- [x] 7.1 Create client/src/api/specs.ts — specs API calls (list, get, create, update, delete, versions)
- [x] 7.2 Create client/src/api/changes.ts — changes API calls (list, get, create, update, delete, archive, context)
- [x] 7.3 Add artifacts API calls to changes.ts (list, get, create, update, delete)
- [x] 7.4 Add tasks API calls to changes.ts (list, batchCreate, update, delete)

## 8. Client: Specs Page

- [x] 8.1 Create Specs.vue — list view with capability name, title, version, updated time
- [x] 8.2 Add spec detail view (rendered markdown + edit button)
- [x] 8.3 Add inline markdown editor for spec content
- [x] 8.4 Add "New Spec" creation form
- [x] 8.5 Add route and sidebar navigation entry for Specs page

## 9. Client: Changes Page

- [x] 9.1 Create Changes.vue — card list with name, status badge, progress bar, updated time
- [x] 9.2 Add status filter tabs (All / Draft / In Progress / Completed)
- [x] 9.3 Add "New Change" button and creation dialog
- [x] 9.4 Add route and sidebar navigation entry for Changes page

## 10. Client: Change Detail Page

- [x] 10.1 Create ChangeDetail.vue with tab navigation (Proposal / Design / Specs / Tasks)
- [x] 10.2 Implement Proposal tab — markdown render + edit mode
- [x] 10.3 Implement Design tab — markdown render + edit mode
- [x] 10.4 Implement Specs tab — list spec artifacts by capability, expandable content
- [x] 10.5 Implement Tasks tab — grouped task list with checkboxes, progress per group
- [x] 10.6 Add Archive button (visible when all tasks done, calls POST /archive)
- [x] 10.7 Add route for change detail page

## 11. Client: Chat Spec Panel

- [x] 11.1 Create SpecPanel.vue — collapsible side panel component
- [x] 11.2 Implement changes list in panel (name, status, task progress)
- [x] 11.3 Implement "inject" action — fetch context, mark change as active
- [x] 11.4 Display injected change's tasks with real-time status
- [x] 11.5 Handle SSE events (task_updated, spec_updated) to refresh panel state
- [x] 11.6 Implement dismiss/close to remove injected context
- [x] 11.7 Integrate SpecPanel into Chat.vue layout (right side, toggleable)
