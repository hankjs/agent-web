import { apiRequest, authFetch } from "../composables/useSession";

export interface ImageProvider {
  id: string;
  name: string;
  type: string;
  default_model: string;
  models: Record<string, string>;
}

export interface ImageResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageGenResponse {
  images: ImageResult[];
  provider: string;
  model: string;
}

export async function listImageProviders() {
  return apiRequest<{ providers: ImageProvider[] }>("/api/image-providers");
}

export async function generateImage(body: {
  prompt: string;
  provider_id?: string;
  model?: string;
  size?: string;
  quality?: string;
  n?: number;
}) {
  return apiRequest<ImageGenResponse>("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function editImage(body: {
  image: File;
  prompt: string;
  provider_id?: string;
  model?: string;
  size?: string;
  n?: number;
}) {
  const form = new FormData();
  form.append("image", body.image);
  form.append("prompt", body.prompt);
  if (body.provider_id) form.append("provider_id", body.provider_id);
  if (body.model) form.append("model", body.model);
  if (body.size) form.append("size", body.size);
  if (body.n) form.append("n", String(body.n));
  return apiRequest<ImageGenResponse>("/api/image/edit", { method: "POST", body: form });
}

export async function adminListImageProviders() {
  return apiRequest<any[]>("/api/admin/image-providers");
}

export async function adminCreateImageProvider(data: any) {
  return apiRequest("/api/admin/image-providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminUpdateImageProvider(id: string, data: any) {
  return apiRequest(`/api/admin/image-providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminDeleteImageProvider(id: string) {
  return authFetch(`/api/admin/image-providers/${id}`, { method: "DELETE" });
}
