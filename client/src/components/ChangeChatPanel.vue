<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { listChanges, createChange, startExplore, triggerGenerate, confirmArtifacts, type Change } from "../api/changes";
import { useSession } from "../composables/useSession";

const props = defineProps<{
  workDir: string;
  sessionId: string;
  refreshKey?: number;
}>();

const emit = defineEmits<{
  close: [];
  navigateSession: [sessionId: string];
  applyChange: [changeId: string];
  reviewChange: [changeId: string];
}>();

const { navigateTo } = useSession();

const changes = ref<Change[]>([]);
const loading = ref(false);
const newChangeName = ref("");
const showNewForm = ref(false);

async function fetchChanges() {
  loading.value = true;
  const result = await listChanges({ work_dir: props.workDir });
  if (result.ok && result.data) {
    changes.value = result.data;
  }
  loading.value = false;
}

async function handleCreate() {
  if (!newChangeName.value.trim()) return;
  const result = await createChange(newChangeName.value.trim(), props.workDir);
  if (result.ok) {
    newChangeName.value = "";
    showNewForm.value = false;
    await fetchChanges();
  }
}

async function handleExplore(change: Change) {
  const result = await startExplore(change.id);
  if (result.ok && result.data) {
    emit("navigateSession", result.data.session_id);
  }
}

async function handleGenerate(change: Change) {
  const result = await triggerGenerate(change.id);
  if (result.ok && result.data) {
    emit("navigateSession", result.data.session_id);
  }
}

// PLACEHOLDER_MORE_CONTENT

async function handleConfirm(change: Change) {
  await confirmArtifacts(change.id);
  await fetchChanges();
}

function handleApply(change: Change) {
  emit("applyChange", change.id);
}

function handleReview(change: Change) {
  emit("reviewChange", change.id);
}

function handleView(change: Change) {
  navigateTo("change-detail", change.id);
}

function getActions(change: Change) {
  if (!change.explore_summary) return ["Explore", "View"];
  if (change.status === "draft") return ["Generate", "Review", "Apply", "View"];
  return ["Apply", "View"];
}

onMounted(fetchChanges);
watch(() => props.workDir, fetchChanges);
watch(() => props.refreshKey, fetchChanges);
</script>

<template>
  <div class="change-panel">
    <div class="panel-header">
      <span class="panel-title">Changes</span>
      <button class="panel-close" @click="emit('close')">&times;</button>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="panel-loading">Loading...</div>

      <div v-else-if="changes.length === 0 && !showNewForm" class="panel-empty">
        No changes for this project.
      </div>

      <div v-for="change in changes" :key="change.id" class="change-item">
        <div class="change-info">
          <span class="change-name">{{ change.name }}</span>
          <span class="change-status" :class="change.status">{{ change.status }}</span>
        </div>
        <div class="change-actions">
          <button
            v-for="action in getActions(change)"
            :key="action"
            class="action-btn"
            @click="action === 'Explore' ? handleExplore(change) : action === 'Generate' ? handleGenerate(change) : action === 'Apply' ? handleApply(change) : action === 'Confirm' ? handleConfirm(change) : action === 'Review' ? handleReview(change) : handleView(change)"
          >{{ action }}</button>
        </div>
      </div>

      <!-- New Change Form -->
      <div v-if="showNewForm" class="new-change-form">
        <input
          v-model="newChangeName"
          placeholder="Change name..."
          class="new-change-input"
          @keydown.enter="handleCreate"
          @keydown.escape="showNewForm = false"
        />
        <button class="action-btn" @click="handleCreate">Create</button>
        <button class="action-btn cancel" @click="showNewForm = false">Cancel</button>
      </div>
    </div>

    <div class="panel-footer">
      <button class="new-change-btn" @click="showNewForm = true" v-if="!showNewForm">+ New Change</button>
    </div>
  </div>
</template>

<style scoped>
.change-panel {
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: 400px;
  background: var(--color-surface-1, #1a1a1a);
  border: 1px solid var(--color-border, #333);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border, #333);
}
.panel-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.panel-close { background: none; border: none; color: var(--color-text-secondary); font-size: 18px; cursor: pointer; }
.panel-body { flex: 1; overflow-y: auto; padding: 8px; }
.panel-loading, .panel-empty { font-size: 12px; color: var(--color-text-secondary); padding: 12px; text-align: center; }
.change-item { padding: 8px 10px; border-radius: 6px; margin-bottom: 4px; background: var(--color-surface-0, #111); }
.change-info { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.change-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); flex: 1; }
.change-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--color-surface-1); color: var(--color-text-secondary); }
.change-status.active { color: #34d399; background: rgba(52, 211, 153, 0.1); }
.change-status.draft { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
.change-actions { display: flex; gap: 6px; }
.action-btn { padding: 4px 10px; font-size: 11px; font-weight: 500; border-radius: 4px; border: 1px solid var(--color-border, #333); background: transparent; color: var(--color-text-primary); cursor: pointer; }
.action-btn:hover { background: var(--color-surface-1); border-color: var(--color-accent, #6366f1); }
.action-btn.cancel { color: var(--color-text-secondary); }
.new-change-form { display: flex; gap: 6px; padding: 8px 0; align-items: center; }
.new-change-input { flex: 1; padding: 5px 10px; font-size: 12px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-0); color: var(--color-text-primary); outline: none; }
.new-change-input:focus { border-color: var(--color-accent, #6366f1); }
.panel-footer { padding: 8px 14px; border-top: 1px solid var(--color-border, #333); }
.new-change-btn { width: 100%; padding: 6px; font-size: 12px; font-weight: 500; border-radius: 4px; border: 1px dashed var(--color-border, #333); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.new-change-btn:hover { border-color: var(--color-accent, #6366f1); color: var(--color-text-primary); }
</style>
