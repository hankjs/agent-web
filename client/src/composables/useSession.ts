import { ref, readonly } from "vue";
import { API_BASE } from "../config";

export interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  work_dir: string | null;
  active_leaf_id: string | null;
  created_at: string;
  updated_at: string;
}

type View = "list" | "chat";

const sessions = ref<Session[]>([]);
const currentSession = ref<Session | null>(null);
const view = ref<View>("list");
const token = ref("");

async function login() {
  if (token.value) return;
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.ok) {
    const data = await res.json();
    token.value = data.token;
  }
}

export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  await login();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token.value}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

async function fetchSessions() {
  const res = await authFetch("/api/sessions");
  if (res.ok) {
    sessions.value = await res.json();
  }
}

async function createSession(workDir?: string): Promise<Session | null> {
  const res = await authFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ work_dir: workDir || null }),
  });
  if (!res.ok) return null;
  const session: Session = await res.json();
  sessions.value.unshift(session);
  currentSession.value = session;
  view.value = "chat";
  return session;
}

function selectSession(session: Session) {
  currentSession.value = session;
  view.value = "chat";
}

async function deleteSession(id: string) {
  const res = await authFetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (res.ok) {
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (currentSession.value?.id === id) {
      currentSession.value = null;
      view.value = "list";
    }
  }
}

function goBack() {
  currentSession.value = null;
  view.value = "list";
  fetchSessions();
}

async function updateSessionTitle(id: string, title: string) {
  const res = await authFetch(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (res.ok) {
    const updated: Session = await res.json();
    const idx = sessions.value.findIndex((s) => s.id === id);
    if (idx !== -1) sessions.value[idx] = updated;
    if (currentSession.value?.id === id) {
      currentSession.value = updated;
    }
  }
}

async function updateSessionWorkDir(id: string, workDir: string | null) {
  const res = await authFetch(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ work_dir: workDir }),
  });
  if (res.ok) {
    const updated: Session = await res.json();
    const idx = sessions.value.findIndex((s) => s.id === id);
    if (idx !== -1) sessions.value[idx] = updated;
    if (currentSession.value?.id === id) {
      currentSession.value = updated;
    }
  }
}

export function useSession() {
  return {
    sessions: readonly(sessions),
    currentSession: readonly(currentSession),
    view: readonly(view),
    token: readonly(token),
    fetchSessions,
    createSession,
    selectSession,
    deleteSession,
    goBack,
    login,
    updateSessionTitle,
    updateSessionWorkDir,
  };
}
