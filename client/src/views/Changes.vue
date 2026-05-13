<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { listChanges, type Change } from "../api/changes";
import NewChangeDialog from "../components/NewChangeDialog.vue";

const { navigateTo } = useSession();
const changes = ref<Change[]>([]);
const statusFilter = ref("all");
const showCreate = ref(false);

const filteredChanges = computed(() => {
  if (statusFilter.value === "all") return changes.value;
  return changes.value.filter(c => c.status === statusFilter.value);
});

async function fetchChanges() {
  const res = await listChanges();
  if (res.ok && res.data) changes.value = res.data;
}

function openDetail(id: string) {
  navigateTo("change-detail", { changeId: id });
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

const statusTabs = ["all", "draft", "in_progress", "completed"];

onMounted(fetchChanges);
</script>

<template>
  <div class="changes-page">
    <div class="changes-header">
      <button class="back-btn" @click="navigateTo('sessions')">返回</button>
      <h2>需求</h2>
      <button class="create-btn" @click="showCreate = true">新建需求</button>
    </div>

    <div class="status-tabs">
      <button
        v-for="tab in statusTabs" :key="tab"
        :class="{ active: statusFilter === tab }"
        @click="statusFilter = tab"
      >{{ tab === 'all' ? '全部' : tab === 'draft' ? '草稿' : tab === 'in_progress' ? '进行中' : '已完成' }}</button>
    </div>

    <div class="changes-grid">
      <div
        v-for="change in filteredChanges" :key="change.id"
        class="change-card"
        @click="openDetail(change.id)"
      >
        <div class="card-name">{{ change.name }}</div>
        <div class="card-meta">
          <span class="status-badge" :class="change.status">{{ change.status.replace('_', ' ') }}</span>
          <span class="time">{{ relativeTime(change.updated_at) }}</span>
        </div>
      </div>
      <div v-if="filteredChanges.length === 0" class="empty">暂无需求</div>
    </div>

    <NewChangeDialog v-if="showCreate" @close="showCreate = false; fetchChanges()" />
  </div>
</template>

<style scoped>
.changes-page { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; }
.changes-header { display: flex; align-items: center; gap: 12px; }
.changes-header h2 { flex: 1; margin: 0; font-size: 18px; }
.status-tabs { display: flex; gap: 4px; }
.status-tabs button { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: transparent; color: var(--color-text-muted, #888); cursor: pointer; font-size: 12px; text-transform: capitalize; }
.status-tabs button.active { background: var(--color-surface-2, #252525); color: var(--color-text-primary, #eee); }
.input { padding: 8px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; flex: 1; }
.changes-grid { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }
.change-card { padding: 12px; border-radius: 8px; border: 1px solid var(--color-border, #333); cursor: pointer; }
.change-card:hover { background: var(--color-surface-1, #1a1a1a); }
.card-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.card-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.status-badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; text-transform: capitalize; }
.status-badge.draft { background: #374151; color: #9ca3af; }
.status-badge.in_progress { background: #1e3a5f; color: #60a5fa; }
.status-badge.completed { background: #14532d; color: #4ade80; }
.time { color: var(--color-text-muted, #888); }
button { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; cursor: pointer; }
button:hover { background: var(--color-surface-2, #252525); }
button.primary { background: var(--color-accent, #3b82f6); border-color: var(--color-accent, #3b82f6); color: white; }
.back-btn { font-size: 13px; }
.create-btn { font-size: 13px; }
.empty { color: var(--color-text-muted, #888); padding: 24px; text-align: center; }
</style>
