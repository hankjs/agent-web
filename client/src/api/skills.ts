import { apiRequest } from "../composables/useSession";

export interface SkillInfo {
  name: string;
  description: string;
  source: string;
  installed: boolean;
}

export async function listSkills(workDir: string) {
  const params = new URLSearchParams({ work_dir: workDir });
  return apiRequest<SkillInfo[]>(`/api/skills?${params}`);
}

export async function installSkill(data: {
  source: string;
  skill_name: string;
  work_dir: string;
  skill_path?: string;
}) {
  return apiRequest<{ name: string; source: string }>("/api/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function uninstallSkill(name: string, workDir: string) {
  const params = new URLSearchParams({ work_dir: workDir });
  return apiRequest(`/api/skills/${name}?${params}`, { method: "DELETE" });
}
