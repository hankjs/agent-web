<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSession } from "../composables/useSession";
import FolderPicker from "../components/FolderPicker.vue";
import NewChangeDialog from "../components/NewChangeDialog.vue";

const { createSession, fetchSessions } = useSession();

type EnvTab = "remote" | "local";
const activeTab = ref<EnvTab>("remote");
const workDir = ref("");
const localWorkDir = ref("");
const isTauri = ref(false);
const showNewChange = ref(false);

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

onMounted(async () => {
  fetchSessions();
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
  <div class="session-view">
    <header class="view-header">
      <span class="view-title">新会话</span>
      <button class="action-btn primary" @click="showNewChange = true">新建需求</button>
    </header>

    <div class="view-body">
      <div class="new-session">
        <div class="env-tabs">
          <button
            class="env-tab"
            :class="{ active: activeTab === 'remote' }"
            @click="activeTab = 'remote'"
          >服务器</button>
          <button
            v-if="isTauri"
            class="env-tab"
            :class="{ active: activeTab === 'local' }"
            @click="activeTab = 'local'"
          >本机</button>
        </div>

        <div class="picker-row">
          <FolderPicker v-if="activeTab === 'remote'" v-model="workDir" />
          <button v-else class="dir-picker" @click="pickLocalDir">
            {{ localWorkDir || '选择本地目录...' }}
          </button>
          <button class="action-btn primary" @click="start">开始</button>
        </div>
      </div>
    </div>

    <NewChangeDialog v-if="showNewChange" @close="showNewChange = false" />
  </div>
</template>

<style scoped>
.session-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  height: var(--header-height);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.view-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.view-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8) var(--space-6);
  max-width: 560px;
}

.new-session {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.env-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border-subtle);
}

.env-tab {
  background: none;
  border: none;
  padding: var(--space-2) var(--space-4);
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color var(--duration-fast), border-color var(--duration-fast);
}

.env-tab.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent);
}

.env-tab:hover:not(.active) {
  color: var(--color-text-secondary);
}

.picker-row {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.dir-picker {
  flex: 1;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color var(--duration-fast);
}

.dir-picker:hover {
  border-color: var(--color-text-muted);
}

/* Shared action button */
.action-btn {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: background var(--duration-fast), color var(--duration-fast);
  white-space: nowrap;
}

.action-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.action-btn.primary {
  background: var(--color-accent);
  color: var(--color-surface-0);
  border-color: transparent;
}

.action-btn.primary:hover {
  background: var(--color-accent-hover);
}
</style>
