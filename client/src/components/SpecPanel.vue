<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { listChanges, listTasks, getChangeContext, type Change, type TaskGroup } from "../api/changes";

const emit = defineEmits<{
  (e: "inject", context: string): void;
  (e: "dismiss"): void;
}>();

const changes = ref<Change[]>([]);
const injectedChangeId = ref<string | null>(null);
const injectedTasks = ref<TaskGroup[]>([]);
const collapsed = ref(false);

async function fetchChanges() {
  const res = await listChanges();
  if (res.ok && res.data) changes.value = res.data;
}

async function injectChange(change: Change) {
  injectedChangeId.value = change.id;
  const [ctxRes, tasksRes] = await Promise.all([
    getChangeContext(change.id),
    listTasks(change.id),
  ]);
  if (ctxRes.ok && ctxRes.data) {
    emit("inject", ctxRes.data.context);
  }
  if (tasksRes.ok && tasksRes.data) {
    injectedTasks.value = tasksRes.data;
  }
}

function dismiss() {
  injectedChangeId.value = null;
  injectedTasks.value = [];
  emit("dismiss");
}

function handleSSEEvent(event: any) {
  if (!injectedChangeId.value) return;
  if (event.type === "task_updated" && event.change_id === injectedChangeId.value) {
    // Refresh tasks
    listTasks(injectedChangeId.value).then(res => {
      if (res.ok && res.data) injectedTasks.value = res.data;
    });
  }
}

// Expose for parent to call
defineExpose({ handleSSEEvent });

onMounted(fetchChanges);
</script>

<template>
  <div class="spec-panel" :class="{ collapsed }">
    <div class="panel-header">
      <span class="panel-title">Changes</span>
      <button class="toggle-btn" @click="collapsed = !collapsed">
        {{ collapsed ? '>' : '<' }}
      </button>
    </div>

    <template v-if="!collapsed">
      <div v-if="injectedChangeId" class="injected-section">
        <div class="injected-header">
          <span>{{ changes.find(c => c.id === injectedChangeId)?.name }}</span>
          <button class="dismiss-btn" @click="dismiss">Dismiss</button>
        </div>
        <div class="task-list">
          <div v-for="group in injectedTasks" :key="group.group_name" class="task-group">
            <div class="group-name">{{ group.group_name }} ({{ group.counts.done }}/{{ group.counts.total }})</div>
            <div v-for="task in group.tasks" :key="task.id" class="task-item">
              <span class="task-check" :class="task.status">{{ task.status === 'done' ? '[x]' : '[ ]' }}</span>
              <span class="task-title">{{ task.title }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="changes-list">
        <div
          v-for="change in changes" :key="change.id"
          class="change-item"
          @click="injectChange(change)"
        >
          <div class="change-name">{{ change.name }}</div>
          <div class="change-meta">
            <span class="status-badge" :class="change.status">{{ change.status.replace('_', ' ') }}</span>
          </div>
        </div>
        <div v-if="changes.length === 0" class="empty">No changes</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.spec-panel { width: 280px; border-left: 1px solid var(--color-border, #333); display: flex; flex-direction: column; overflow: hidden; background: var(--color-surface-0, #0a0a0a); }
.spec-panel.collapsed { width: 36px; }
.panel-header { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid var(--color-border, #333); }
.panel-title { flex: 1; font-size: 12px; font-weight: 600; }
.toggle-btn { background: none; border: none; color: var(--color-text-muted, #888); cursor: pointer; padding: 2px 6px; }
.changes-list { flex: 1; overflow-y: auto; padding: 8px; }
.change-item { padding: 8px; border-radius: 4px; cursor: pointer; margin-bottom: 4px; }
.change-item:hover { background: var(--color-surface-1, #1a1a1a); }
.change-name { font-size: 12px; font-weight: 600; }
.change-meta { margin-top: 2px; }
.status-badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; text-transform: capitalize; }
.status-badge.draft { background: #374151; color: #9ca3af; }
.status-badge.in_progress { background: #1e3a5f; color: #60a5fa; }
.status-badge.completed { background: #14532d; color: #4ade80; }
.injected-section { flex: 1; overflow-y: auto; padding: 8px; }
.injected-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
.dismiss-btn { font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid var(--color-border, #333); background: transparent; color: var(--color-text-muted, #888); cursor: pointer; margin-left: auto; }
.task-list { font-size: 11px; }
.task-group { margin-bottom: 8px; }
.group-name { font-weight: 600; margin-bottom: 4px; color: var(--color-text-muted, #888); }
.task-item { display: flex; gap: 4px; padding: 2px 0; }
.task-check { font-family: monospace; }
.task-check.done { color: #4ade80; }
.task-check.in_progress { color: #60a5fa; }
.task-title { flex: 1; }
.empty { color: var(--color-text-muted, #888); text-align: center; padding: 16px; font-size: 12px; }
</style>
