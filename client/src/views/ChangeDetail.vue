<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../composables/useSession";
import { buildExploreContinuePrompt } from "../agents/ExploreAgent";
import {
  getChange, listArtifacts, listTasks, updateTask, archiveChange, startExplore,
  type ChangeDetail as ChangeDetailType, type ChangeArtifact, type TaskGroup,
} from "../api/changes";
import PageLoading from "../components/PageLoading.vue";

const route = useRoute();
const changeId = route.params.changeId as string;
const { navigateTo, queueSessionInitialPrompt } = useSession();
const change = ref<ChangeDetailType | null>(null);
const artifacts = ref<ChangeArtifact[]>([]);
const taskGroups = ref<TaskGroup[]>([]);
const activeTab = ref<"explore" | "spec" | "task">("explore");
const isLoading = ref(true);
const requirementContent = ref<string>("");
const tasksContent = ref<string>("");

async function fetchData() {
  isLoading.value = true;
  try {
    const [changeRes, artifactsRes, tasksRes] = await Promise.all([
      getChange(changeId),
      listArtifacts(changeId),
      listTasks(changeId),
    ]);
    if (changeRes.ok && changeRes.data) change.value = changeRes.data;
    if (artifactsRes.ok && artifactsRes.data) artifacts.value = artifactsRes.data;
    if (tasksRes.ok && tasksRes.data) taskGroups.value = tasksRes.data;

    // 尝试从文件系统读取需求文档和任务文档
    if (change.value?.requirement_path) {
      requirementContent.value = await readFileContent(change.value.requirement_path);
    }
    if (change.value?.tasks_path) {
      tasksContent.value = await readFileContent(change.value.tasks_path);
    }
  } finally {
    isLoading.value = false;
  }
}

async function readFileContent(path: string): Promise<string> {
  try {
    const result = await invoke<{ content: string; is_error: boolean }>("tool_read_file", { path, workDir: change.value?.work_dir || "" });
    return result.is_error ? "" : result.content;
  } catch {
    return "";
  }
}

function getArtifact(type: string) {
  return artifacts.value.find(a => a.type === type);
}

function getSpecArtifacts() {
  return artifacts.value.filter(a => a.type === "spec");
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

async function continueExplore() {
  if (!changeId) return;
  const res = await startExplore(changeId);
  if (res.ok && res.data) {
    queueSessionInitialPrompt(res.data.session_id, buildExploreContinuePrompt({
      changeName: change.value?.name || "",
      workDir: change.value?.work_dir || "",
      exploreSummary: change.value?.explore_summary || "",
    }));
    navigateTo("chat", { sessionId: res.data.session_id });
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
    <PageLoading v-if="isLoading" />
    <template v-else>
    <div class="detail-header">
      <button @click="navigateTo('changes')">Back</button>
      <h2>{{ change?.name || "Loading..." }}</h2>
      <span v-if="change" class="status-badge" :class="change.status">{{ change.status.replace('_', ' ') }}</span>
      <button v-if="change" @click="continueExplore">Continue Explore</button>
      <button v-if="allTasksDone()" class="primary" @click="doArchive">Archive</button>
    </div>

    <div class="tabs">
      <button :class="{ active: activeTab === 'explore' }" @click="activeTab = 'explore'">Explore</button>
      <button :class="{ active: activeTab === 'spec' }" @click="activeTab = 'spec'">Spec</button>
      <button :class="{ active: activeTab === 'task' }" @click="activeTab = 'task'">Task</button>
    </div>

    <div class="tab-content">
      <!-- Explore Tab -->
      <template v-if="activeTab === 'explore'">
        <div v-if="requirementContent" class="explore-summary">
          <div class="doc-label">需求文档</div>
          <pre class="content">{{ requirementContent }}</pre>
        </div>
        <div v-else-if="change?.explore_summary" class="explore-summary">
          <pre class="content">{{ change.explore_summary }}</pre>
        </div>
        <div v-else class="empty">
          <button class="primary" @click="continueExplore">Start Explore</button>
        </div>
      </template>

      <!-- Spec Tab -->
      <template v-if="activeTab === 'spec'">
        <div v-for="art in getSpecArtifacts()" :key="art.id" class="spec-section">
          <details>
            <summary>{{ art.capability || 'Unnamed' }}</summary>
            <pre class="content">{{ art.content }}</pre>
          </details>
        </div>
        <div v-if="getSpecArtifacts().length === 0" class="empty">No spec artifacts</div>
      </template>

      <!-- Task Tab -->
      <template v-if="activeTab === 'task'">
        <div v-if="tasksContent" class="explore-summary">
          <div class="doc-label">任务文档</div>
          <pre class="content">{{ tasksContent }}</pre>
        </div>
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
        <pre v-if="!tasksContent && taskGroups.length === 0 && getArtifact('tasks')" class="content">{{ getArtifact('tasks')!.content }}</pre>
        <div v-if="!tasksContent && taskGroups.length === 0 && !getArtifact('tasks')" class="empty">No tasks</div>
      </template>
    </div>
    </template>
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
.explore-summary {
  max-width: 860px;
  padding: 12px 0;
}
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
.doc-label { font-size: 11px; font-weight: 600; color: var(--color-accent, #3b82f6); text-transform: uppercase; margin-bottom: 6px; }
</style>
