import { apiRequest } from "../composables/useSession";

export interface RequirementDoc {
  id: string;
  change_id: string;
  session_id: string | null;
  name: string;
  content: string;
  version: number;
  progress_json: string | null;
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

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export async function listRequirementDocs(params: { search?: string; status?: string; page?: number; page_size?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  return apiRequest<Paginated<RequirementDoc>>(`/api/admin/requirement-docs?${qs}`);
}

export async function getRequirementDoc(id: string) {
  return apiRequest<RequirementDoc>(`/api/admin/requirement-docs/${id}`);
}

export async function listAllTasks(params: { status?: string; change_id?: string; page?: number; page_size?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.change_id) qs.set("change_id", params.change_id);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  return apiRequest<Paginated<ChangeTask>>(`/api/admin/tasks?${qs}`);
}

// Client-facing APIs (used by ExploreAgent)
export async function createRequirementDoc(body: { change_id: string; session_id?: string; name: string; content: string; progress_json?: string }) {
  return apiRequest<RequirementDoc>("/api/requirement-docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateRequirementDoc(id: string, body: { content: string; progress_json?: string; status?: string; source?: string }) {
  return apiRequest("/api/requirement-docs/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getRequirementDocByChange(changeId: string) {
  return apiRequest<RequirementDoc>(`/api/requirement-docs/by-change/${changeId}`);
}
