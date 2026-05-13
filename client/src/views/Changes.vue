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

const statusLabels: Record<string, string> = {
  all: "全部",
  draft: "草稿",
  in_progress: "进行中",
  completed: "已完成",
};

const statusTabs = ["all", "draft", "in_progress", "completed"];

onMounted(fetchChanges);
</script>

<template>
  <div class="changes-view">
    <header class="view-header">
      <span class="view-title">变更</span>
      <div class="header-actions">
        <div class="filter-tabs">
          <button
            v-for="tab in statusTabs" :key="tab"
            class="filter-tab"
            :class="{ active: statusFilter === tab }"
            @click="statusFilter = tab"
          >{{ statusLabels[tab] }}</button>
        </div>
        <button class="action-btn primary" @click="showCreate = true">新建</button>
      </div>
    </header>

    <div class="view-body">
      <table v-if="filteredChanges.length" class="changes-table">
        <thead>
          <tr>
            <th class="col-name">名称</th>
            <th class="col-status">状态</th>
            <th class="col-time">更新</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="change in filteredChanges"
            :key="change.id"
            @click="openDetail(change.id)"
          >
            <td class="col-name">{{ change.name }}</td>
            <td class="col-status">
              <span class="status-badge" :class="change.status">{{ statusLabels[change.status] || change.status }}</span>
            </td>
            <td class="col-time">{{ relativeTime(change.updated_at) }}</td>
          </tr>
        </tbody>
      </table>

      <p v-else class="empty">暂无需求</p>
    </div>

    <NewChangeDialog v-if="showCreate" @close="showCreate = false; fetchChanges()" />
  </div>
</template>

<style scoped>
.changes-view {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.filter-tabs {
  display: flex;
  gap: 2px;
}

.filter-tab {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  transition: color var(--duration-fast), background var(--duration-fast);
}

.filter-tab:hover {
  color: var(--color-text-secondary);
}

.filter-tab.active {
  background: var(--color-surface-2);
  color: var(--color-text-primary);
}

.view-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
}

.changes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.changes-table th {
  text-align: left;
  padding: var(--space-2) var(--space-2);
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 11px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.changes-table td {
  padding: var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
}

.changes-table tr {
  cursor: pointer;
  transition: background var(--duration-fast);
}

.changes-table tbody tr:hover {
  background: var(--color-surface-hover);
}

.col-name {
  color: var(--color-text-primary);
  font-weight: 500;
}

.col-status { width: 80px; }
.col-time { width: 80px; color: var(--color-text-muted); }

.status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
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

.action-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: background var(--duration-fast);
}

.action-btn.primary {
  background: var(--color-accent);
  color: var(--color-surface-0);
  border-color: transparent;
}

.action-btn.primary:hover {
  background: var(--color-accent-hover);
}

.empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: var(--space-8) 0;
  text-align: center;
}
</style>
