<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { listSpecs, updateSpec, deleteSpec, type Spec } from "../api/specs";
import { listChanges, createChange, type Change } from "../api/changes";

const { navigateTo, sessions, fetchSessions } = useSession();
const specs = ref<Spec[]>([]);
const changes = ref<Change[]>([]);
const selectedWorkDir = ref<string | null>(null);
const selectedSpec = ref<Spec | null>(null);
const editing = ref(false);
const editContent = ref("");
const creatingChange = ref(false);
const newChangeName = ref("");

// Derive unique work_dirs from sessions (non-null only)
const workDirs = computed(() => {
  const dirs = new Set<string>();
  for (const s of sessions.value) {
    if (s.work_dir) dirs.add(s.work_dir);
  }
  return Array.from(dirs).sort();
});

// Changes for selected work_dir
const workDirChanges = computed(() => {
  if (!selectedWorkDir.value) return [];
  return changes.value.filter(c => c.work_dir === selectedWorkDir.value);
});

async function fetchAll() {
  await fetchSessions();
  const [specRes, changeRes] = await Promise.all([listSpecs(), listChanges()]);
  if (specRes.ok && specRes.data) specs.value = specRes.data;
  if (changeRes.ok && changeRes.data) changes.value = changeRes.data;
  // Auto-select first work_dir if none selected
  if (!selectedWorkDir.value && workDirs.value.length > 0) {
    selectedWorkDir.value = workDirs.value[0];
  }
}

function selectWorkDir(dir: string) {
  selectedWorkDir.value = dir;
  selectedSpec.value = null;
  editing.value = false;
  creatingChange.value = false;
}
// SPECS_VUE_PART2
function selectSpec(spec: Spec) {
  selectedSpec.value = spec;
  editing.value = false;
}

function startEdit() {
  if (!selectedSpec.value) return;
  editContent.value = selectedSpec.value.content;
  editing.value = true;
}

async function saveEdit() {
  if (!selectedSpec.value) return;
  const res = await updateSpec(selectedSpec.value.id, { content: editContent.value });
  if (res.ok && res.data) {
    selectedSpec.value = res.data;
    const idx = specs.value.findIndex(s => s.id === res.data!.id);
    if (idx !== -1) specs.value[idx] = res.data;
  }
  editing.value = false;
}

function startCreateChange() {
  creatingChange.value = true;
  newChangeName.value = "";
}

async function submitCreateChange() {
  if (!newChangeName.value.trim() || !selectedWorkDir.value) return;
  const res = await createChange(newChangeName.value.trim(), selectedWorkDir.value);
  if (res.ok && res.data) {
    navigateTo("change-detail", res.data.id);
  }
  creatingChange.value = false;
  newChangeName.value = "";
}

async function removeSpec(id: string) {
  await deleteSpec(id);
  specs.value = specs.value.filter(s => s.id !== id);
  if (selectedSpec.value?.id === id) selectedSpec.value = null;
}

function openChange(id: string) {
  navigateTo("change-detail", id);
}

function dirName(path: string): string {
  return path.split("/").pop() || path;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

onMounted(fetchAll);
</script>

<template>
  <div class="specs-page">
    <div class="specs-header">
      <button class="back-btn" @click="navigateTo('list')">Back</button>
      <h2>Projects</h2>
    </div>

    <div class="specs-layout">
      <!-- Left: work_dir list -->
      <div class="workdir-list">
        <div
          v-for="dir in workDirs" :key="dir"
          class="workdir-item" :class="{ active: selectedWorkDir === dir }"
          @click="selectWorkDir(dir)"
        >
          <div class="workdir-name">{{ dirName(dir) }}</div>
          <div class="workdir-path">{{ dir }}</div>
        </div>
        <div v-if="workDirs.length === 0" class="empty">No projects yet</div>
      </div>

      <!-- Right: specs + changes for selected work_dir -->
      <div class="workdir-detail" v-if="selectedWorkDir">
        <!-- Changes section -->
        <div class="section">
          <div class="section-header">
            <h3>Changes</h3>
            <button class="create-btn" @click="startCreateChange">New Change</button>
          </div>

          <template v-if="creatingChange">
            <div class="form">
              <input v-model="newChangeName" placeholder="Change name" class="input" @keyup.enter="submitCreateChange" />
              <div class="form-actions">
                <button @click="creatingChange = false">Cancel</button>
                <button class="primary" @click="submitCreateChange">Create</button>
              </div>
            </div>
          </template>

          <div v-else-if="workDirChanges.length" class="changes-list">
            <div
              v-for="c in workDirChanges" :key="c.id"
              class="change-row"
              @click="openChange(c.id)"
            >
              <span class="change-name">{{ c.name }}</span>
              <span class="status-badge" :class="c.status">{{ c.status.replace('_', ' ') }}</span>
              <span class="time">{{ relativeTime(c.updated_at) }}</span>
            </div>
          </div>
          <div v-else class="empty-inline">No changes for this project</div>
        </div>

        <!-- Specs section -->
        <div class="section">
          <div class="section-header">
            <h3>Specs</h3>
          </div>

          <div v-if="specs.length" class="specs-list-inner">
            <div
              v-for="spec in specs" :key="spec.id"
              class="spec-item" :class="{ active: selectedSpec?.id === spec.id }"
              @click="selectSpec(spec)"
            >
              <div class="spec-cap">{{ spec.capability }}</div>
              <div class="spec-meta">{{ spec.title }} · v{{ spec.version }} · {{ relativeTime(spec.updated_at) }}</div>
            </div>
          </div>
          <div v-else class="empty-inline">No specs yet</div>

          <!-- Spec detail -->
          <template v-if="selectedSpec">
            <div class="detail-header">
              <h4>{{ selectedSpec.capability }}</h4>
              <div class="detail-actions">
                <button @click="startEdit" v-if="!editing">Edit</button>
                <button @click="removeSpec(selectedSpec.id)" class="danger">Delete</button>
              </div>
            </div>
            <template v-if="editing">
              <textarea v-model="editContent" class="textarea" rows="16"></textarea>
              <div class="form-actions">
                <button @click="editing = false">Cancel</button>
                <button class="primary" @click="saveEdit">Save</button>
              </div>
            </template>
            <template v-else>
              <pre class="spec-content">{{ selectedSpec.content }}</pre>
            </template>
          </template>
        </div>
      </div>
      <div v-else class="workdir-detail empty">Select a project to view</div>
    </div>
  </div>
</template>

<style scoped>
.specs-page { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; }
.specs-header { display: flex; align-items: center; gap: 12px; }
.specs-header h2 { flex: 1; margin: 0; font-size: 18px; }
.specs-layout { display: flex; flex: 1; gap: 16px; overflow: hidden; }
.workdir-list { width: 240px; overflow-y: auto; border-right: 1px solid var(--color-border, #333); padding-right: 12px; }
.workdir-item { padding: 8px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; }
.workdir-item:hover { background: var(--color-surface-1, #1a1a1a); }
.workdir-item.active { background: var(--color-surface-2, #252525); }
.workdir-name { font-weight: 600; font-size: 13px; }
.workdir-path { font-size: 11px; color: var(--color-text-muted, #888); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workdir-detail { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.section { }
.section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.section-header h3 { flex: 1; margin: 0; font-size: 15px; }
.changes-list { display: flex; flex-direction: column; gap: 4px; }
.change-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.change-row:hover { background: var(--color-surface-1, #1a1a1a); }
.change-name { flex: 1; font-weight: 500; }
.status-badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; text-transform: capitalize; }
.status-badge.draft { background: #374151; color: #9ca3af; }
.status-badge.in_progress { background: #1e3a5f; color: #60a5fa; }
.status-badge.completed { background: #14532d; color: #4ade80; }
.time { color: var(--color-text-muted, #888); font-size: 11px; }
.specs-list-inner { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.spec-item { padding: 8px; border-radius: 6px; cursor: pointer; }
.spec-item:hover { background: var(--color-surface-1, #1a1a1a); }
.spec-item.active { background: var(--color-surface-2, #252525); }
.spec-cap { font-weight: 600; font-size: 13px; }
.spec-meta { font-size: 11px; color: var(--color-text-muted, #888); margin-top: 2px; }
.detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; margin-top: 12px; }
.detail-header h4 { flex: 1; margin: 0; font-size: 14px; }
.detail-actions { display: flex; gap: 6px; }
.spec-content { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
.form { display: flex; flex-direction: column; gap: 8px; }
.input { padding: 8px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; }
.textarea { padding: 8px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; font-family: monospace; font-size: 13px; resize: vertical; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; }
button { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; cursor: pointer; }
button:hover { background: var(--color-surface-2, #252525); }
button.primary { background: var(--color-accent, #3b82f6); border-color: var(--color-accent, #3b82f6); color: white; }
button.danger { color: #ef4444; }
.back-btn { font-size: 13px; }
.create-btn { font-size: 13px; }
.empty { color: var(--color-text-muted, #888); padding: 24px; text-align: center; }
.empty-inline { color: var(--color-text-muted, #888); font-size: 13px; padding: 8px; }
</style>
