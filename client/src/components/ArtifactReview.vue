<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { listArtifacts, updateArtifact, confirmArtifacts, type ChangeArtifact } from "../api/changes";

const props = defineProps<{
  changeId: string;
}>();

const emit = defineEmits<{
  confirmed: [];
  close: [];
}>();

const artifacts = ref<ChangeArtifact[]>([]);
const loading = ref(false);
const activeTab = ref(0);
const editing = ref(false);
const editContent = ref("");

const draftArtifacts = computed(() => artifacts.value.filter(a => a.status === "draft"));

async function fetchArtifacts() {
  loading.value = true;
  const result = await listArtifacts(props.changeId);
  if (result.ok && result.data) {
    artifacts.value = result.data;
  }
  loading.value = false;
}

function startEdit() {
  const art = draftArtifacts.value[activeTab.value];
  if (art) {
    editContent.value = art.content;
    editing.value = true;
  }
}

async function saveEdit() {
  const art = draftArtifacts.value[activeTab.value];
  if (!art) return;
  await updateArtifact(props.changeId, art.id, { content: editContent.value });
  art.content = editContent.value;
  editing.value = false;
}

function cancelEdit() {
  editing.value = false;
}

async function handleConfirm() {
  await confirmArtifacts(props.changeId);
  emit("confirmed");
}

onMounted(fetchArtifacts);
</script>

<template>
  <div class="artifact-review">
    <div class="review-header">
      <span class="review-title">Review Artifacts</span>
      <div class="review-actions">
        <button class="confirm-btn" @click="handleConfirm" :disabled="draftArtifacts.length === 0">Confirm All</button>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
    </div>

    <div v-if="loading" class="review-loading">Loading artifacts...</div>

    <template v-else-if="draftArtifacts.length > 0">
      <div class="tab-bar">
        <button
          v-for="(art, i) in draftArtifacts"
          :key="art.id"
          class="tab-btn"
          :class="{ active: activeTab === i }"
          @click="activeTab = i; editing = false"
        >{{ art.capability || art.type }}</button>
      </div>

      <div class="tab-content">
        <div v-if="!editing" class="artifact-view">
          <pre class="artifact-content">{{ draftArtifacts[activeTab]?.content }}</pre>
          <button class="edit-btn" @click="startEdit">Edit</button>
        </div>
        <div v-else class="artifact-edit">
          <textarea v-model="editContent" class="edit-textarea"></textarea>
          <div class="edit-actions">
            <button class="save-btn" @click="saveEdit">Save</button>
            <button class="cancel-btn" @click="cancelEdit">Cancel</button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="review-empty">No draft artifacts to review.</div>
  </div>
</template>

<style scoped>
.artifact-review {
  display: flex;
  flex-direction: column;
  background: var(--color-surface-1, #1a1a1a);
  border: 1px solid var(--color-border, #333);
  border-radius: 8px;
  overflow: hidden;
  max-height: 500px;
}
.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border, #333);
}
.review-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.review-actions { display: flex; gap: 8px; align-items: center; }
.confirm-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  border: none;
  background: var(--color-accent, #6366f1);
  color: #fff;
  cursor: pointer;
}
.confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.confirm-btn:hover:not(:disabled) { opacity: 0.9; }
.close-btn { background: none; border: none; color: var(--color-text-secondary); font-size: 18px; cursor: pointer; }
.review-loading, .review-empty { padding: 20px; text-align: center; font-size: 12px; color: var(--color-text-secondary); }
.tab-bar { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--color-border, #333); }
.tab-btn {
  padding: 6px 12px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab-btn.active { color: var(--color-accent, #6366f1); border-bottom-color: var(--color-accent, #6366f1); }
.tab-btn:hover { color: var(--color-text-primary); }
.tab-content { flex: 1; overflow-y: auto; padding: 10px; }
.artifact-view { position: relative; }
.artifact-content {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.edit-btn {
  position: absolute;
  top: 0;
  right: 0;
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #333);
  background: var(--color-surface-0, #111);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.edit-btn:hover { border-color: var(--color-accent, #6366f1); color: var(--color-text-primary); }
.artifact-edit { display: flex; flex-direction: column; gap: 8px; }
.edit-textarea {
  width: 100%;
  min-height: 200px;
  padding: 8px;
  font-size: 12px;
  font-family: monospace;
  line-height: 1.5;
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  background: var(--color-surface-0, #111);
  color: var(--color-text-primary);
  resize: vertical;
  outline: none;
}
.edit-textarea:focus { border-color: var(--color-accent, #6366f1); }
.edit-actions { display: flex; gap: 6px; }
.save-btn, .cancel-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #333);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}
.save-btn:hover { border-color: var(--color-accent, #6366f1); }
.cancel-btn { color: var(--color-text-secondary); }
</style>
