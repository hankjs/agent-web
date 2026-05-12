import { apiRequest } from "../composables/useSession";

export interface Checkpoint {
  id: string;
  session_id: string;
  message_id: string;
  git_commit_sha: string;
  git_branch: string;
  label: string;
  created_at: string;
}

export async function listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
  const result = await apiRequest<Checkpoint[]>(`/api/sessions/${sessionId}/checkpoints`);
  return result.data || [];
}

export async function rewindToCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
  const result = await apiRequest(`/api/sessions/${sessionId}/rewind/${checkpointId}`, {
    method: "POST",
  });
  if (!result.ok) {
    throw new Error(result.msg || "Rewind failed");
  }
}
