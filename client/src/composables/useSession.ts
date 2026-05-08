import { ref, readonly } from "vue";

const API_BASE = "http://localhost:3000";

export interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  work_dir: string | null;
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

async function fetchSessions() {
  await login();
  const res = await fetch(`${API_BASE}/api/sessions`, {
    headers: { Authorization: `Bearer ${token.value}` },
  });
  if (res.ok) {
    sessions.value = await res.json();
  }
}

async function createSession(workDir?: string): Promise<Session | null> {
  await login();
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.value}`,
    },
    body: JSON.stringify({ work_dir: workDir || null }),
  });
  if (!res.ok) return null;
  const session: Session = await res.json();
  sessions.value.unshift(session);
  currentSession.value = session;
  view.value = "chat";
  return session;
}
// USEESSION_PART2

function selectSession(session: Session) {
  currentSession.value = session;
  view.value = "chat";
}

async function deleteSession(id: string) {
  await login();
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.value}` },
  });
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
  };
}
