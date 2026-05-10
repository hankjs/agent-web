import { apiRequest } from "../composables/useSession";

export interface Spec {
  id: string;
  capability: string;
  title: string;
  content: string;
  metadata: any;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SpecVersion {
  id: string;
  spec_id: string;
  version: number;
  content: string;
  metadata: any;
  change_id: string | null;
  created_at: string;
}

export async function listSpecs() {
  return apiRequest<Spec[]>("/api/specs");
}

export async function getSpec(id: string) {
  return apiRequest<Spec>(`/api/specs/${id}`);
}

export async function createSpec(data: { capability: string; title: string; content: string; metadata?: any }) {
  return apiRequest<Spec>("/api/specs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateSpec(id: string, data: { content?: string; metadata?: any; title?: string }) {
  return apiRequest<Spec>(`/api/specs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteSpec(id: string) {
  return apiRequest(`/api/specs/${id}`, { method: "DELETE" });
}

export async function listSpecVersions(id: string) {
  return apiRequest<SpecVersion[]>(`/api/specs/${id}/versions`);
}
