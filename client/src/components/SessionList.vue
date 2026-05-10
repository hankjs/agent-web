<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useSession } from "../composables/useSession";
import { createChange } from "../api/changes";
import FolderPicker from "./FolderPicker.vue";

const { sessions, fetchSessions, createSession, selectSession, deleteSession, navigateTo } = useSession();

type EnvTab = "remote" | "local";
const activeTab = ref<EnvTab>("remote");
const workDir = ref("");
const localWorkDir = ref("");
const isTauri = ref(false);

// New Change flow
const showNewChange = ref(false);
const newChangeName = ref("");
const selectedProjectDir = ref<string | null>(null);

const projectDirs = computed(() => {
  const dirs = new Set<string>();
  for (const s of sessions.value) {
    if (s.work_dir) dirs.add(s.work_dir);
  }
  return Array.from(dirs).sort();
});

function startNewChange() {
  showNewChange.value = true;
  newChangeName.value = "";
  selectedProjectDir.value = projectDirs.value.length === 1 ? projectDirs.value[0] : null;
}

async function submitNewChange() {
  if (!newChangeName.value.trim() || !selectedProjectDir.value) return;
  const res = await createChange(newChangeName.value.trim(), selectedProjectDir.value);
  if (res.ok && res.data) {
    navigateTo("change-detail", res.data.id);
  }
  showNewChange.value = false;
  newChangeName.value = "";
  selectedProjectDir.value = null;
}

function dirName(path: string): string {
  return path.split("/").pop() || path;
}

async function start() {
  if (activeTab.value === "remote") {
    await createSession(workDir.value || undefined, "remote");
  } else {
    await createSession(localWorkDir.value || undefined, "local");
  }
}

async function pickLocalDir() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, directory: true, title: "Select local work directory" });
    if (selected) {
      localWorkDir.value = selected as string;
    }
  } catch { /* not in Tauri */ }
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function displayTitle(title: string, workDir: string | null): string {
  if (title) return title;
  if (workDir) return workDir.split("/").pop() || workDir;
  return "Untitled";
}

onMounted(async () => {
  fetchSessions();
  // Detect Tauri environment
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("acp_get_agents");
    isTauri.value = true;
  } catch {
    isTauri.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="session-header">
      <span class="header-title">Hank</span>
      <slot name="header-actions" />
    </div>
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-6 py-10">
        <!-- New session -->
        <div class="new-session">
          <div class="new-session-tabs">
            <button class="tab-btn" :class="{ active: activeTab === 'remote' }" @click="activeTab = 'remote'">Server</button>
            <button v-if="isTauri" class="tab-btn" :class="{ active: activeTab === 'local' }" @click="activeTab = 'local'">本机</button>
          </div>
          <div class="new-session-picker">
            <FolderPicker v-if="activeTab === 'remote'" v-model="workDir" />
            <div v-else class="local-picker">
              <button class="local-pick-btn" @click="pickLocalDir">
                {{ localWorkDir || 'Select local directory...' }}
              </button>
            </div>
            <button class="start-btn" @click="start">Start</button>
          </div>
        </div>
        <!-- New Change -->
        <div v-if="!showNewChange" class="new-change-trigger">
          <button class="new-change-btn" @click="startNewChange">New Change</button>
        </div>
        <div v-else class="new-change-form">
          <div class="new-change-title">New Change</div>
          <div class="project-select">
            <div class="project-label">Select project:</div>
            <div class="project-options">
              <div
                v-for="dir in projectDirs" :key="dir"
                class="project-option" :class="{ active: selectedProjectDir === dir }"
                @click="selectedProjectDir = dir"
              >
                <span class="project-name">{{ dirName(dir) }}</span>
                <span class="project-path">{{ dir }}</span>
              </div>
              <div v-if="projectDirs.length === 0" class="empty-inline">No projects yet. Start a session first.</div>
            </div>
          </div>
          <input v-model="newChangeName" placeholder="Change name" class="change-input" @keyup.enter="submitNewChange" />
          <div class="new-change-actions">
            <button @click="showNewChange = false" class="cancel-btn">Cancel</button>
            <button class="start-btn" :disabled="!newChangeName.trim() || !selectedProjectDir" @click="submitNewChange">Create</button>
          </div>
        </div>

        <!-- Session list -->
        <div v-if="sessions.length" class="session-list">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="session-row"
            @click="selectSession(s)"
          >
            <div class="session-info">
              <span class="session-title">{{ displayTitle(s.title, s.work_dir) }}</span>
              <span v-if="s.work_dir" class="session-dir">{{ s.work_dir }}</span>
            </div>
            <div class="session-meta">
              <span v-if="s.session_type === 'explore'" class="env-badge explore">Explore</span>
              <span class="env-badge" :class="s.environment === 'local' ? 'local' : 'remote'">{{ s.environment === 'local' ? 'Local' : 'Remote' }}</span>
              <span class="session-time">{{ relativeTime(s.updated_at) }}</span>
              <button
                class="session-delete"
                @click.stop="deleteSession(s.id)"
                aria-label="Delete session"
              >&times;</button>
            </div>
          </div>
        </div>

        <p v-else class="empty-state">No sessions yet</p>
      </div>
    </div>
  </div>
</template>
<!-- SESSION_LIST_STYLE -->
<style scoped>
.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.new-session {
  margin-bottom: 32px;
}

.new-session-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.tab-btn {
  background: none;
  border: none;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}

.tab-btn.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent);
}

.tab-btn:hover:not(.active) {
  color: var(--color-text-primary);
}

.new-session-picker {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.local-picker {
  flex: 1;
  display: flex;
}

.local-pick-btn {
  flex: 1;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 0.12s;
}

.local-pick-btn:hover {
  border-color: var(--color-text-muted);
}

.start-btn {
  padding: 10px 20px;
  background: var(--color-accent);
  color: var(--color-surface-0);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.start-btn:hover {
  opacity: 0.85;
}

.session-list {
  display: flex;
  flex-direction: column;
}

.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 0.12s;
  border-radius: 4px;
}

.session-row:hover {
  background: var(--color-surface-hover);
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.session-title {
  font-size: 14px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-dir {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.session-time {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.session-delete {
  opacity: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  transition: opacity 0.12s, color 0.12s;
}

.session-row:hover .session-delete {
  opacity: 1;
}

.session-delete:hover {
  color: var(--color-error);
}

.empty-state {
  color: var(--color-text-muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.env-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
}

.env-badge.local {
  color: var(--color-env-local);
  background: var(--color-env-local-bg);
}

.env-badge.remote {
  color: var(--color-env-remote);
  background: var(--color-env-remote-bg);
}

.env-badge.explore {
  color: #c084fc;
  background: rgba(192, 132, 252, 0.12);
}

.new-change-trigger {
  margin-bottom: 24px;
}

.new-change-btn {
  padding: 8px 16px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.new-change-btn:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-text-muted);
}

.new-change-form {
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new-change-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.project-select {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.project-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-option {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--color-border-subtle);
  transition: background 0.12s, border-color 0.12s;
}

.project-option:hover {
  background: var(--color-surface-hover);
}

.project-option.active {
  border-color: var(--color-accent);
  background: rgba(59, 130, 246, 0.08);
}

.project-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.project-path {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-input {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-0);
  color: var(--color-text-primary);
  font-size: 13px;
}

.new-change-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cancel-btn {
  padding: 6px 12px;
  background: none;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.cancel-btn:hover {
  color: var(--color-text-primary);
}

.empty-inline {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 8px;
}
</style>
