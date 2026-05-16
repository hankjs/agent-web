import { apiRequest } from "../composables/useSession";

export interface Change {
  id: string;
  name: string;
  status: string;
  work_dir: string | null;
  explore_summary: string | null;
  requirement_path: string | null;
  tasks_path: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ChangeDetail extends Change {
  artifacts: ArtifactSummary[];
  task_counts: TaskCounts;
}

export interface ArtifactSummary {
  id: string;
  type: string;
  capability: string | null;
  updated_at: string;
}

export interface TaskCounts {
  total: number;
  done: number;
  in_progress: number;
  pending: number;
}

export interface ChangeArtifact {
  id: string;
  change_id: string;
  type: string;
  capability: string | null;
  content: string;
  metadata: any;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ChangeTask {
  id: string;
  change_id: string;
  group_name: string;
  group_order: number;
  task_order: number;
  title: string;
  description: string | null;
  status: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskGroup {
  group_name: string;
  group_order: number;
  tasks: ChangeTask[];
  counts: TaskCounts;
}

// ─── Changes ─────────────────────────────────────────────────────────

export async function listChanges(params?: { status?: string; work_dir?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.work_dir) searchParams.set("work_dir", params.work_dir);
  const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
  return apiRequest<Change[]>(`/api/changes${query}`);
}

export async function getChange(id: string) {
  return apiRequest<ChangeDetail>(`/api/changes/${id}`);
}

export async function createChange(name: string, work_dir?: string) {
  return apiRequest<Change>("/api/changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, work_dir }),
  });
}

export async function updateChange(id: string, data: { name?: string; status?: string }) {
  return apiRequest(`/api/changes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteChange(id: string) {
  return apiRequest(`/api/changes/${id}`, { method: "DELETE" });
}

export async function archiveChange(id: string) {
  return apiRequest(`/api/changes/${id}/archive`, { method: "POST" });
}

export async function getChangeContext(id: string) {
  return apiRequest<{ context: string }>(`/api/changes/${id}/context`);
}

// ─── Artifacts ───────────────────────────────────────────────────────

export async function listArtifacts(changeId: string) {
  return apiRequest<ChangeArtifact[]>(`/api/changes/${changeId}/artifacts`);
}

export async function getArtifact(changeId: string, artifactId: string) {
  return apiRequest<ChangeArtifact>(`/api/changes/${changeId}/artifacts/${artifactId}`);
}

export async function createArtifact(changeId: string, data: { type: string; capability?: string; content: string; metadata?: any }) {
  return apiRequest<ChangeArtifact>(`/api/changes/${changeId}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateArtifact(changeId: string, artifactId: string, data: { content?: string; metadata?: any }) {
  return apiRequest(`/api/changes/${changeId}/artifacts/${artifactId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteArtifact(changeId: string, artifactId: string) {
  return apiRequest(`/api/changes/${changeId}/artifacts/${artifactId}`, { method: "DELETE" });
}

// ─── Tasks ───────────────────────────────────────────────────────────

export async function listTasks(changeId: string) {
  return apiRequest<TaskGroup[]>(`/api/changes/${changeId}/tasks`);
}

export async function batchCreateTasks(changeId: string, tasks: { group_name: string; group_order: number; task_order: number; title: string; description?: string }[]) {
  return apiRequest<ChangeTask[]>(`/api/changes/${changeId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks }),
  });
}

export async function updateTask(changeId: string, taskId: string, data: { status?: string; title?: string; description?: string }) {
  return apiRequest(`/api/changes/${changeId}/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteTask(changeId: string, taskId: string) {
  return apiRequest(`/api/changes/${changeId}/tasks/${taskId}`, { method: "DELETE" });
}

// ─── Explore / Generate / Apply ─────────────────────────────────────

export async function startExplore(changeId: string) {
  return apiRequest<{ session_id: string }>(`/api/changes/${changeId}/explore`, {
    method: "POST",
  });
}

export async function triggerGenerate(changeId: string) {
  return apiRequest<{ session_id: string; change_id: string }>(`/api/changes/${changeId}/generate`, {
    method: "POST",
  });
}

export async function confirmArtifacts(changeId: string) {
  return apiRequest(`/api/changes/${changeId}/artifacts/confirm`, {
    method: "POST",
  });
}

export async function getApplyContext(changeId: string) {
  return apiRequest<{ context: string }>(`/api/changes/${changeId}/context`);
}
