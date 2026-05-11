import { ref, readonly } from "vue";
import { useRouter } from "vue-router";
import { API_BASE } from "../config";

export interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  work_dir: string | null;
  environment: "remote" | "local";
  session_type: "chat" | "explore";
  active_leaf_id: string | null;
  created_at: string;
  updated_at: string;
}

const sessions = ref<Session[]>([]);
const currentSession = ref<Session | null>(null);
const TOKEN_KEY = "hank_client_token";
const token = ref(localStorage.getItem(TOKEN_KEY) || "");
const isAuthenticated = ref(!!token.value);

function setToken(t: string) {
  token.value = t;
  isAuthenticated.value = true;
  localStorage.setItem(TOKEN_KEY, t);
}

function clearAuth() {
  token.value = "";
  isAuthenticated.value = false;
  localStorage.removeItem(TOKEN_KEY);
  sessions.value = [];
  currentSession.value = null;
}

export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token.value}`);
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
  }
  return res;
}

export async function apiRequest<T = any>(path: string, options: RequestInit = {}): Promise<{ ok: boolean; data?: T; msg?: string }> {
  const res = await authFetch(path, options);
  const json = await res.json().catch(() => null);
  if (!json) return { ok: false, msg: "Invalid response" };
  if (json.code === 0) return { ok: true, data: json.data as T };
  return { ok: false, msg: json.msg || "Request failed" };
}

async function fetchSessions() {
  const result = await apiRequest<Session[]>("/api/sessions");
  if (result.ok && result.data) {
    result.data.forEach(s => { if (!s.environment) s.environment = "remote"; });
    sessions.value = result.data;
  }
}

async function createSession(router: ReturnType<typeof useRouter>, workDir?: string, environment?: "remote" | "local", sessionType?: "chat" | "explore"): Promise<Session | null> {
  const result = await apiRequest<Session>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ work_dir: workDir || null, environment: environment || "remote", session_type: sessionType || "chat" }),
  });
  if (!result.ok || !result.data) return null;
  const session = result.data;
  if (!session.environment) session.environment = environment || "remote";
  if (!session.session_type) session.session_type = sessionType || "chat";
  sessions.value.unshift(session);
  currentSession.value = session;
  router.push({ name: "chat", params: { sessionId: session.id } });
  return session;
}

async function deleteSession(id: string, router: ReturnType<typeof useRouter>) {
  const result = await apiRequest(`/api/sessions/${id}`, { method: "DELETE" });
  if (result.ok) {
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (currentSession.value?.id === id) {
      currentSession.value = null;
      router.push({ name: "sessions" });
    }
  }
}

function selectSession(session: Session, router: ReturnType<typeof useRouter>) {
  currentSession.value = session;
  router.push({ name: "chat", params: { sessionId: session.id } });
}

async function login(username?: string, password?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username || "", password: password || "", scope: "client" }),
  });
  const json = await res.json().catch(() => null);
  if (json && json.code === 0) {
    setToken(json.data.token);
    return { ok: true };
  }
  return { ok: false, error: json?.msg || "Invalid credentials" };
}

function logout(router: ReturnType<typeof useRouter>) {
  clearAuth();
  router.push({ name: "login" });
}

async function updateSessionTitle(id: string, title: string) {
  const result = await apiRequest<Session>(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (result.ok && result.data) {
    const updated = result.data;
    const idx = sessions.value.findIndex((s) => s.id === id);
    if (idx !== -1) sessions.value[idx] = updated;
    if (currentSession.value?.id === id) currentSession.value = updated;
  }
}

async function updateSessionWorkDir(id: string, workDir: string | null) {
  const result = await apiRequest<Session>(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ work_dir: workDir }),
  });
  if (result.ok && result.data) {
    const updated = result.data;
    const idx = sessions.value.findIndex((s) => s.id === id);
    if (idx !== -1) sessions.value[idx] = updated;
    if (currentSession.value?.id === id) currentSession.value = updated;
  }
}

export function useSession() {
  const router = useRouter();
  return {
    sessions: readonly(sessions),
    currentSession: readonly(currentSession),
    token: readonly(token),
    isAuthenticated: readonly(isAuthenticated),
    fetchSessions,
    createSession: (workDir?: string, environment?: "remote" | "local", sessionType?: "chat" | "explore") =>
      createSession(router, workDir, environment, sessionType),
    createExploreSession: (workDir?: string) => createSession(router, workDir, "remote", "explore"),
    selectSession: (session: Session) => selectSession(session, router),
    deleteSession: (id: string) => deleteSession(id, router),
    goBack: () => { currentSession.value = null; router.push({ name: "sessions" }); fetchSessions(); },
    navigateTo: (name: string, params?: Record<string, string>) => router.push({ name, params }),
    login,
    logout: () => logout(router),
    updateSessionTitle,
    updateSessionWorkDir,
  };
}
