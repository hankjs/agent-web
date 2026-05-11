<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useSession } from "../composables/useSession";
import {
  getChange, listArtifacts, listTasks, updateArtifact, createArtifact,
  updateTask, archiveChange,
  type ChangeDetail as ChangeDetailType, type ChangeArtifact, type TaskGroup,
} from "../api/changes";

const route = useRoute();
const changeId = route.params.changeId as string;
const { navigateTo } = useSession();
const change = ref<ChangeDetailType | null>(null);
const artifacts = ref<ChangeArtifact[]>([]);
const taskGroups = ref<TaskGroup[]>([]);
const activeTab = ref<"proposal" | "design" | "specs" | "tasks">("proposal");
const editing = ref(false);
const editContent = ref("");
const editingArtifactId = ref<string | null>(null);

async function fetchData() {
  const [changeRes, artifactsRes, tasksRes] = await Promise.all([
    getChange(changeId),
    listArtifacts(changeId),
    listTasks(changeId),
  ]);
  if (changeRes.ok && changeRes.data) change.value = changeRes.data;
  if (artifactsRes.ok && artifactsRes.data) artifacts.value = artifactsRes.data;
  if (tasksRes.ok && tasksRes.data) taskGroups.value = tasksRes.data;
}

function getArtifact(type: string) {
  return artifacts.value.find(a => a.type === type);
}

function startEdit(type: string) {
  const art = getArtifact(type);
  editContent.value = art?.content || "";
  editingArtifactId.value = art?.id || null;
  editing.value = true;
}

async function saveEdit(type: string) {
  if (!changeId) return;
  if (editingArtifactId.value) {
    await updateArtifact(changeId, editingArtifactId.value, { content: editContent.value });
  } else {
    await createArtifact(changeId, { type, content: editContent.value });
  }
  editing.value = false;
  await fetchData();
}

async function toggleTask(taskId: string, currentStatus: string) {
  if (!changeId) return;
  const newStatus = currentStatus === "done" ? "pending" : "done";
  await updateTask(changeId, taskId, { status: newStatus });
  await fetchData();
}

async function doArchive() {
  if (!changeId) return;
  const res = await archiveChange(changeId);
  if (res.ok) {
    navigateTo("changes");
  }
}

const allTasksDone = () => {
  if (!change.value) return false;
  return change.value.task_counts.total > 0 && change.value.task_counts.done === change.value.task_counts.total;
};

onMounted(fetchData);
</script>

<template>
  <div class="detail-page">
    <div class="detail-header">
      <button @click="navigateTo('changes')">Back</button>
      <h2>{{ change?.name || "Loading..." }}</h2>
      <span v-if="change" class="status-badge" :class="change.status">{{ change.status.replace('_', ' ') }}</span>
      <button v-if="allTasksDone()" class="primary" @click="doArchive">Archive</button>
    </div>

    <div class="tabs">
      <button :class="{ active: activeTab === 'proposal' }" @click="activeTab = 'proposal'">Proposal</button>
      <button :class="{ active: activeTab === 'design' }" @click="activeTab = 'design'">Design</button>
      <button :class="{ active: activeTab === 'specs' }" @click="activeTab = 'specs'">Specs</button>
      <button :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">Tasks</button>
    </div>

    <div class="tab-content">
      <!-- Proposal Tab -->
      <template v-if="activeTab === 'proposal'">
        <template v-if="editing">
          <textarea v-model="editContent" class="textarea" rows="16"></textarea>
          <div class="form-actions">
            <button @click="editing = false">Cancel</button>
            <button class="primary" @click="saveEdit('proposal')">Save</button>
          </div>
        </template>
        <template v-else>
          <div v-if="getArtifact('proposal')">
            <button class="edit-btn" @click="startEdit('proposal')">Edit</button>
            <pre class="content">{{ getArtifact('proposal')!.content }}</pre>
          </div>
          <div v-else class="empty">
            <button class="primary" @click="startEdit('proposal')">Create Proposal</button>
          </div>
        </template>
      </template>

      <!-- Design Tab -->
      <template v-if="activeTab === 'design'">
        <template v-if="editing">
          <textarea v-model="editContent" class="textarea" rows="16"></textarea>
          <div class="form-actions">
            <button @click="editing = false">Cancel</button>
            <button class="primary" @click="saveEdit('design')">Save</button>
          </div>
        </template>
        <template v-else>
          <div v-if="getArtifact('design')">
            <button class="edit-btn" @click="startEdit('design')">Edit</button>
            <pre class="content">{{ getArtifact('design')!.content }}</pre>
          </div>
          <div v-else class="empty">
            <button class="primary" @click="startEdit('design')">Create Design</button>
          </div>
        </template>
      </template>

      <!-- Specs Tab -->
      <template v-if="activeTab === 'specs'">
        <div v-for="art in artifacts.filter(a => a.type === 'spec')" :key="art.id" class="spec-section">
          <details>
            <summary>{{ art.capability || 'Unnamed' }}</summary>
            <pre class="content">{{ art.content }}</pre>
          </details>
        </div>
        <div v-if="artifacts.filter(a => a.type === 'spec').length === 0" class="empty">No spec artifacts</div>
      </template>

      <!-- Tasks Tab -->
      <template v-if="activeTab === 'tasks'">
        <div v-for="group in taskGroups" :key="group.group_name" class="task-group">
          <div class="group-header">
            <span class="group-name">{{ group.group_name }}</span>
            <span class="group-progress">{{ group.counts.done }}/{{ group.counts.total }}</span>
          </div>
          <div v-for="task in group.tasks" :key="task.id" class="task-item">
            <input
              type="checkbox"
              :checked="task.status === 'done'"
              @change="toggleTask(task.id, task.status)"
            />
            <span class="task-title" :class="{ done: task.status === 'done' }">{{ task.title }}</span>
            <span class="task-status-badge" :class="task.status">{{ task.status }}</span>
          </div>
        </div>
        <div v-if="taskGroups.length === 0" class="empty">No tasks</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail-page { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; }
.detail-header { display: flex; align-items: center; gap: 12px; }
.detail-header h2 { flex: 1; margin: 0; font-size: 18px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border, #333); padding-bottom: 8px; }
.tabs button { padding: 6px 12px; border-radius: 4px 4px 0 0; border: 1px solid transparent; background: transparent; color: var(--color-text-muted, #888); cursor: pointer; }
.tabs button.active { border-color: var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: var(--color-text-primary, #eee); }
.tab-content { flex: 1; overflow-y: auto; }
.content { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
.textarea { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; font-family: monospace; font-size: 13px; resize: vertical; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.edit-btn { margin-bottom: 8px; }
.task-group { margin-bottom: 16px; }
.group-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid var(--color-border, #333); }
.group-name { font-weight: 600; font-size: 13px; flex: 1; }
.group-progress { font-size: 12px; color: var(--color-text-muted, #888); }
.task-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.task-title { font-size: 13px; flex: 1; }
.task-title.done { text-decoration: line-through; color: var(--color-text-muted, #888); }
.task-status-badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; }
.task-status-badge.done { background: #14532d; color: #4ade80; }
.task-status-badge.in_progress { background: #1e3a5f; color: #60a5fa; }
.task-status-badge.pending { background: #374151; color: #9ca3af; }
.spec-section { margin-bottom: 8px; }
.spec-section summary { cursor: pointer; font-weight: 600; font-size: 13px; padding: 6px 0; }
.status-badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; text-transform: capitalize; }
.status-badge.draft { background: #374151; color: #9ca3af; }
.status-badge.in_progress { background: #1e3a5f; color: #60a5fa; }
.status-badge.completed { background: #14532d; color: #4ade80; }
button { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; cursor: pointer; }
button:hover { background: var(--color-surface-2, #252525); }
button.primary { background: var(--color-accent, #3b82f6); border-color: var(--color-accent, #3b82f6); color: white; }
.empty { color: var(--color-text-muted, #888); padding: 24px; text-align: center; }
</style>
