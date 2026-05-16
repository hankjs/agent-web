<script setup lang="ts">
import { ref, onMounted } from "vue";
import { listAllTasks, type ChangeTask } from "../api/admin";
import PageLoading from "../components/PageLoading.vue";

const tasks = ref<ChangeTask[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const statusFilter = ref("");
const isLoading = ref(true);

async function fetchTasks() {
  isLoading.value = true;
  try {
    const res = await listAllTasks({
      status: statusFilter.value || undefined,
      page: page.value,
      page_size: pageSize,
    });
    if (res.ok && res.data) {
      tasks.value = res.data.items;
      total.value = res.data.total;
    }
  } finally {
    isLoading.value = false;
  }
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
  "": "全部",
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};
const statusTabs = ["", "pending", "in_progress", "completed"];

const totalPages = () => Math.ceil(total.value / pageSize);

function changePage(p: number) {
  page.value = p;
  fetchTasks();
}

function applyFilter(s: string) {
  statusFilter.value = s;
  page.value = 1;
  fetchTasks();
}

onMounted(fetchTasks);
</script>

<template>
  <div class="changes-view">
    <header class="view-header">
      <span class="view-title">全局任务</span>
      <div class="header-actions">
        <div class="filter-tabs">
          <button
            v-for="tab in statusTabs" :key="tab"
            class="filter-tab"
            :class="{ active: statusFilter === tab }"
            @click="applyFilter(tab)"
          >{{ statusLabels[tab] }}</button>
        </div>
      </div>
    </header>

    <div class="view-body">
      <PageLoading v-if="isLoading" />
      <table v-else-if="tasks.length" class="changes-table">
        <thead>
          <tr>
            <th class="col-name">标题</th>
            <th class="col-group">分组</th>
            <th class="col-status">状态</th>
            <th class="col-time">更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td class="col-name">{{ task.title }}</td>
            <td class="col-group">{{ task.group_name }}</td>
            <td class="col-status">
              <span class="status-badge" :class="task.status">{{ statusLabels[task.status] || task.status }}</span>
            </td>
            <td class="col-time">{{ relativeTime(task.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无任务</p>

      <div v-if="totalPages() > 1" class="pagination">
        <button :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
        <span>{{ page }} / {{ totalPages() }}</span>
        <button :disabled="page >= totalPages()" @click="changePage(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changes-view { display: flex; flex-direction: column; height: 100%; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-4); height: var(--header-height); border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0; }
.view-title { font-size: 12px; font-weight: 500; color: var(--color-text-secondary); }
.header-actions { display: flex; align-items: center; gap: var(--space-3); }
.filter-tabs { display: flex; gap: 2px; }
.filter-tab { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); border: none; background: transparent; color: var(--color-text-muted); cursor: pointer; font-size: 11px; }
.filter-tab:hover { color: var(--color-text-secondary); }
.filter-tab.active { background: var(--color-surface-2); color: var(--color-text-primary); }
.view-body { flex: 1; overflow-y: auto; padding: var(--space-3) var(--space-4); }
.changes-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.changes-table th { text-align: left; padding: var(--space-2); color: var(--color-text-muted); font-weight: 500; font-size: 11px; border-bottom: 1px solid var(--color-border-subtle); }
.changes-table td { padding: var(--space-2); border-bottom: 1px solid var(--color-border-subtle); }
.changes-table tbody tr:hover { background: var(--color-surface-hover); }
.col-name { color: var(--color-text-primary); font-weight: 500; }
.col-group { width: 100px; color: var(--color-text-muted); }
.col-status { width: 80px; }
.col-time { width: 80px; color: var(--color-text-muted); }
.status-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500; }
.status-badge.pending { color: var(--color-text-muted); background: var(--color-surface-2); }
.status-badge.in_progress { color: var(--color-info); background: var(--color-info-surface); }
.status-badge.completed { color: var(--color-success); background: var(--color-success-surface); }
.empty { color: var(--color-text-muted); font-size: 12px; padding: var(--space-8) 0; text-align: center; }
.pagination { display: flex; align-items: center; justify-content: center; gap: var(--space-3); padding: var(--space-3) 0; font-size: 11px; color: var(--color-text-muted); }
.pagination button { padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-secondary); cursor: pointer; font-size: 11px; }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
