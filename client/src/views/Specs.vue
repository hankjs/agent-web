<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { listSpecs, updateSpec, deleteSpec, type Spec } from "../api/specs";
import { listChanges, type Change } from "../api/changes";
import NewChangeDialog from "../components/NewChangeDialog.vue";
import ActionBtn from "../components/ActionBtn.vue";
import PageLoading from "../components/PageLoading.vue";

const { navigateTo, sessions, fetchSessions } = useSession();
const specs = ref<Spec[]>([]);
const changes = ref<Change[]>([]);
const selectedWorkDir = ref<string | null>(null);
const selectedSpec = ref<Spec | null>(null);
const editing = ref(false);
const editContent = ref("");
const creatingChange = ref(false);
const isLoading = ref(true);

const workDirs = computed(() => {
  const dirs = new Set<string>();
  for (const s of sessions.value) {
    if (s.work_dir) dirs.add(s.work_dir);
  }
  return Array.from(dirs).sort();
});

const workDirChanges = computed(() => {
  if (!selectedWorkDir.value) return [];
  return changes.value.filter(c => c.work_dir === selectedWorkDir.value);
});

async function fetchAll() {
  isLoading.value = true;
  try {
    await fetchSessions();
    const [specRes, changeRes] = await Promise.all([listSpecs(), listChanges()]);
    if (specRes.ok && specRes.data) specs.value = specRes.data;
    if (changeRes.ok && changeRes.data) changes.value = changeRes.data;
    if (!selectedWorkDir.value && workDirs.value.length > 0) {
      selectedWorkDir.value = workDirs.value[0];
    }
  } finally {
    isLoading.value = false;
  }
}

function selectWorkDir(dir: string) {
  selectedWorkDir.value = dir;
  selectedSpec.value = null;
  editing.value = false;
  creatingChange.value = false;
}

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

async function removeSpec(id: string) {
  await deleteSpec(id);
  specs.value = specs.value.filter(s => s.id !== id);
  if (selectedSpec.value?.id === id) selectedSpec.value = null;
}

function openChange(id: string) {
  navigateTo("change-detail", { changeId: id });
}

function dirName(path: string): string {
  return path.split("/").pop() || path;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

onMounted(fetchAll);
</script>

<template>
  <div class="specs-view">
    <header class="view-header">
      <span class="view-title">规格</span>
      <ActionBtn variant="primary" @click="creatingChange = true">新建需求</ActionBtn>
    </header>

    <div class="specs-body">
      <PageLoading v-if="isLoading" />
      <template v-else>
      <!-- Project sidebar -->
      <div class="project-list">
        <div
          v-for="dir in workDirs" :key="dir"
          class="project-item"
          :class="{ active: selectedWorkDir === dir }"
          @click="selectWorkDir(dir)"
        >
          <span class="project-name">{{ dirName(dir) }}</span>
          <span class="project-path">{{ dir }}</span>
        </div>
        <div v-if="workDirs.length === 0" class="empty-inline">暂无项目</div>
      </div>

      <!-- Detail area -->
      <div class="detail-area" v-if="selectedWorkDir">
        <!-- Changes -->
        <section class="detail-section">
          <h3 class="section-title">需求</h3>
          <div v-if="workDirChanges.length" class="item-list">
            <div
              v-for="c in workDirChanges" :key="c.id"
              class="item-row"
              @click="openChange(c.id)"
            >
              <span class="item-name">{{ c.name }}</span>
              <span class="status-badge" :class="c.status">{{ c.status === 'draft' ? '草稿' : c.status === 'in_progress' ? '进行中' : '已完成' }}</span>
              <span class="item-time">{{ relativeTime(c.updated_at) }}</span>
            </div>
          </div>
          <p v-else class="empty-inline">暂无需求</p>
        </section>

        <!-- Specs -->
        <section class="detail-section">
          <h3 class="section-title">规格文件</h3>
          <div v-if="specs.length" class="item-list">
            <div
              v-for="spec in specs" :key="spec.id"
              class="item-row"
              :class="{ active: selectedSpec?.id === spec.id }"
              @click="selectSpec(spec)"
            >
              <span class="item-name">{{ spec.capability }}</span>
              <span class="item-meta">v{{ spec.version }}</span>
              <span class="item-time">{{ relativeTime(spec.updated_at) }}</span>
            </div>
          </div>
          <p v-else class="empty-inline">暂无规格</p>

          <!-- Spec content -->
          <div v-if="selectedSpec" class="spec-detail">
            <div class="spec-detail-header">
              <span class="spec-detail-title">{{ selectedSpec.capability }}</span>
              <div class="spec-detail-actions">
                <ActionBtn v-if="!editing" @click="startEdit">编辑</ActionBtn>
                <ActionBtn variant="danger" @click="removeSpec(selectedSpec.id)">删除</ActionBtn>
              </div>
            </div>
            <div v-if="editing" class="edit-area">
              <textarea v-model="editContent" class="edit-textarea" rows="16"></textarea>
              <div class="edit-actions">
                <ActionBtn @click="editing = false">取消</ActionBtn>
                <ActionBtn variant="primary" @click="saveEdit">保存</ActionBtn>
              </div>
            </div>
            <pre v-else class="spec-content">{{ selectedSpec.content }}</pre>
          </div>
        </section>
      </div>
      <div v-else class="detail-area empty-inline">选择项目查看</div>
      </template>
    </div>

    <NewChangeDialog v-if="creatingChange" @close="creatingChange = false" />
  </div>
</template>

<style scoped>
.specs-view {
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

.specs-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.project-list {
  width: 180px;
  overflow-y: auto;
  border-right: 1px solid var(--color-border-subtle);
  padding: var(--space-2);
  flex-shrink: 0;
}

.project-item {
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--duration-fast);
}

.project-item:hover {
  background: var(--color-surface-hover);
}

.project-item.active {
  background: var(--color-surface-2);
}

.project-name {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.project-path {
  display: block;
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.detail-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.detail-section {}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 var(--space-2) 0;
}

.item-list {
  display: flex;
  flex-direction: column;
}

.item-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
  font-size: 12px;
}

.item-row:hover {
  background: var(--color-surface-hover);
}

.item-row.active {
  background: var(--color-surface-2);
}

.item-name {
  flex: 1;
  font-weight: 500;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.item-time {
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
}

.status-badge.draft {
  color: var(--color-text-muted);
  background: var(--color-surface-2);
}

.status-badge.in_progress {
  color: var(--color-info);
  background: var(--color-info-surface);
}

.status-badge.completed {
  color: var(--color-success);
  background: var(--color-success-surface);
}

.spec-detail {
  margin-top: var(--space-3);
  border-top: 1px solid var(--color-border-subtle);
  padding-top: var(--space-3);
}

.spec-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.spec-detail-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.spec-detail-actions {
  display: flex;
  gap: var(--space-2);
}

.spec-content {
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.6;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
  margin: 0;
}

.edit-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.edit-textarea {
  width: 100%;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-0);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.edit-textarea:focus {
  border-color: var(--color-accent);
}

.edit-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.empty-inline {
  font-size: 11px;
  color: var(--color-text-muted);
  padding: var(--space-2) 0;
}
</style>
