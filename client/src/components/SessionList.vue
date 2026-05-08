<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSession } from "../composables/useSession";
import FolderPicker from "./FolderPicker.vue";

const { sessions, fetchSessions, createSession, selectSession, deleteSession } = useSession();

const workDir = ref("");

async function start() {
  await createSession(workDir.value || undefined);
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

onMounted(() => {
  fetchSessions();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-6 py-10">
        <!-- New session -->
        <div class="new-session">
          <FolderPicker v-model="workDir" />
          <button class="start-btn" @click="start">Start</button>
        </div>
<!-- SESSION_LIST_PART2 -->
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
.new-session {
  display: flex;
  gap: 10px;
  align-items: stretch;
  margin-bottom: 32px;
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
</style>
