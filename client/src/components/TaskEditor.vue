<script setup lang="ts">
import { ref, computed } from "vue";
import type { TaskItem } from "../agents/ExploreAgent/types";

const props = defineProps<{
  tasks: TaskItem[];
  title: string;
  confirmed: boolean;
}>();

const emit = defineEmits<{
  confirm: [tasks: TaskItem[]];
  regenerate: [feedback: string];
  "update:tasks": [tasks: TaskItem[]];
}>();

const localTasks = ref<TaskItem[]>(JSON.parse(JSON.stringify(props.tasks)));
const feedbackInput = ref("");
const showFeedback = ref(false);
const collapsedGroups = ref<Set<string>>(new Set());
const rawEditingId = ref<string | null>(null);
const rawJson = ref("");

const groups = computed(() => {
  const map = new Map<string, TaskItem[]>();
  for (const t of localTasks.value) {
    if (!map.has(t.groupName)) map.set(t.groupName, []);
    map.get(t.groupName)!.push(t);
  }
  const entries = [...map.entries()].sort((a, b) => {
    return (a[1][0]?.groupOrder ?? 0) - (b[1][0]?.groupOrder ?? 0);
  });
  return entries.map(([name, items]) => ({
    name,
    tasks: items.sort((a, b) => a.taskOrder - b.taskOrder),
  }));
});

function toggleGroup(name: string) {
  if (collapsedGroups.value.has(name)) collapsedGroups.value.delete(name);
  else collapsedGroups.value.add(name);
}

function updateFiles(taskId: string, value: string) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (t) t.fields.files = value;
}

function updateFieldValue(taskId: string, key: string, value: string) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (t) t.fields[key] = value;
}

function updateField(taskId: string, field: keyof TaskItem, value: any) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (t) (t as any)[field] = value;
}

function addFieldToTask(taskId: string) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (!t) return;
  const key = `field_${Object.keys(t.fields).length + 1}`;
  t.fields[key] = "";
}

function removeField(taskId: string, key: string) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (t) delete t.fields[key];
}

function renameField(taskId: string, oldKey: string, newKey: string) {
  const t = localTasks.value.find(t => t.id === taskId);
  if (!t || !newKey || newKey === oldKey) return;
  t.fields[newKey] = t.fields[oldKey];
  delete t.fields[oldKey];
}

function deleteTask(taskId: string) {
  localTasks.value = localTasks.value.filter(t => t.id !== taskId);
  if (rawEditingId.value === taskId) rawEditingId.value = null;
}

function moveTask(taskId: string, direction: -1 | 1) {
  const task = localTasks.value.find(t => t.id === taskId);
  if (!task) return;
  const sameGroup = localTasks.value.filter(t => t.groupName === task.groupName).sort((a, b) => a.taskOrder - b.taskOrder);
  const groupIdx = sameGroup.findIndex(t => t.id === taskId);
  const swapIdx = groupIdx + direction;
  if (swapIdx < 0 || swapIdx >= sameGroup.length) return;
  const tmp = task.taskOrder;
  task.taskOrder = sameGroup[swapIdx].taskOrder;
  sameGroup[swapIdx].taskOrder = tmp;
}

function addTask(groupName: string) {
  const groupTasks = localTasks.value.filter(t => t.groupName === groupName);
  const maxOrder = groupTasks.reduce((m, t) => Math.max(m, t.taskOrder), 0);
  const groupOrder = groupTasks[0]?.groupOrder ?? 0;
  localTasks.value.push({
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    groupName, groupOrder, taskOrder: maxOrder + 1,
    title: "新任务", description: "", fields: { "文件": "", "验收": "" },
  });
}

function addGroup() {
  const maxGroupOrder = localTasks.value.reduce((m, t) => Math.max(m, t.groupOrder), 0);
  localTasks.value.push({
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    groupName: `新阶段 ${maxGroupOrder + 1}`, groupOrder: maxGroupOrder + 1, taskOrder: 1,
    title: "新任务", description: "", fields: { "文件": "", "验收": "" },
  });
}

const FILE_FIELD_NAMES = new Set(["文件", "files", "file"]);

function deleteGroup(groupName: string) {
  localTasks.value = localTasks.value.filter(t => t.groupName !== groupName);
}

function toggleRawEdit(taskId: string) {
  if (rawEditingId.value === taskId) {
    try {
      const parsed = JSON.parse(rawJson.value);
      const t = localTasks.value.find(t => t.id === taskId);
      if (t) {
        t.title = parsed.title ?? t.title;
        t.description = parsed.description ?? t.description;
        if (parsed.fields && typeof parsed.fields === "object") {
          t.fields = parsed.fields;
        }
      }
    } catch { /* invalid JSON, ignore */ }
    rawEditingId.value = null;
  } else {
    const t = localTasks.value.find(t => t.id === taskId);
    if (t) {
      rawJson.value = JSON.stringify({ title: t.title, description: t.description, fields: t.fields }, null, 2);
      rawEditingId.value = taskId;
    }
  }
}

function handleConfirm() { emit("confirm", localTasks.value); }
function handleRegenerate() {
  emit("regenerate", feedbackInput.value);
  feedbackInput.value = "";
  showFeedback.value = false;
}
</script>

<template>
  <div class="task-editor">
    <div class="task-editor-header">
      <span class="task-editor-title">任务列表确认</span>
      <span class="task-editor-subtitle">{{ title }} · {{ localTasks.length }} 个任务</span>
    </div>

    <div v-if="confirmed" class="task-editor-confirmed">任务已确认提交</div>

    <div class="task-editor-body">
      <div v-for="group in groups" :key="group.name" class="task-group">
        <div class="task-group-header" @click="toggleGroup(group.name)">
          <span class="task-group-toggle">{{ collapsedGroups.has(group.name) ? '▸' : '▾' }}</span>
          <span class="task-group-name">{{ group.name }}</span>
          <span class="task-group-count">{{ group.tasks.length }}</span>
          <span class="task-group-spacer"></span>
          <template v-if="!confirmed">
            <button class="task-group-action" @click.stop="addTask(group.name)">+ 任务</button>
            <button class="task-group-action danger" @click.stop="deleteGroup(group.name)">删除</button>
          </template>
        </div>

        <div v-if="!collapsedGroups.has(group.name)" class="task-group-body">
          <div v-for="task in group.tasks" :key="task.id" class="task-card">
            <!-- 标题行：标题 + raw按钮 + 排序/删除 -->
            <div class="task-card-header">
              <input v-if="!confirmed" class="task-card-title-input" :value="task.title"
                @input="(e) => updateField(task.id, 'title', (e.target as HTMLInputElement).value)" />
              <span v-else class="task-card-title">{{ task.title }}</span>
              <div v-if="!confirmed" class="task-card-actions">
                <button class="task-card-btn" :class="{ active: rawEditingId === task.id }" @click="toggleRawEdit(task.id)" title="编辑原始 JSON">raw</button>
                <button class="task-card-btn" @click="moveTask(task.id, -1)">↑</button>
                <button class="task-card-btn" @click="moveTask(task.id, 1)">↓</button>
                <button class="task-card-btn danger" @click="deleteTask(task.id)">×</button>
              </div>
            </div>

            <!-- Raw JSON 编辑模式 -->
            <div v-if="rawEditingId === task.id" class="task-card-raw">
              <textarea v-model="rawJson" class="task-card-raw-input" rows="8"></textarea>
            </div>

            <!-- 结构化字段模式 -->
            <div v-else class="task-card-fields">
              <div v-for="(value, key) in task.fields" :key="key" class="task-card-field">
                <template v-if="!confirmed">
                  <input class="task-card-field-label-input" :value="key"
                    @change="(e) => renameField(task.id, String(key), (e.target as HTMLInputElement).value)" />
                  <input v-if="FILE_FIELD_NAMES.has(String(key).toLowerCase())" class="task-card-field-input" :value="value"
                    placeholder="src/path/file1, src/path/file2"
                    @input="(e) => updateFieldValue(task.id, String(key), (e.target as HTMLInputElement).value)" />
                  <textarea v-else class="task-card-field-textarea" :value="value" rows="2"
                    @input="(e) => updateFieldValue(task.id, String(key), (e.target as HTMLTextAreaElement).value)"></textarea>
                  <button class="task-card-field-remove" @click="removeField(task.id, String(key))">×</button>
                </template>
                <template v-else>
                  <span class="task-card-field-label">{{ key }}</span>
                  <span class="task-card-field-value">{{ value || '-' }}</span>
                </template>
              </div>
              <button v-if="!confirmed" class="task-card-add-field" @click="addFieldToTask(task.id)">+ 添加字段</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!confirmed" class="task-editor-footer">
      <button class="task-editor-btn secondary" @click="showFeedback = !showFeedback">重新生成</button>
      <button class="task-editor-btn secondary" @click="addGroup">+ 新增阶段</button>
      <button class="task-editor-btn primary" @click="handleConfirm">确认提交</button>
    </div>

    <div v-if="showFeedback && !confirmed" class="task-editor-feedback">
      <input v-model="feedbackInput" class="task-editor-feedback-input"
        placeholder="输入反馈意见（可选），然后点击确认重新生成..." @keyup.enter="handleRegenerate" />
      <button class="task-editor-btn primary" @click="handleRegenerate">确认重新生成</button>
    </div>
  </div>
</template>

<style scoped>
.task-editor { border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent); border-radius: 8px; background: var(--color-surface-1); }
.task-editor-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--color-border-subtle); }
.task-editor-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.task-editor-subtitle { font-size: 12px; color: var(--color-text-muted); }
.task-editor-confirmed { padding: 8px 16px; font-size: 12px; color: var(--color-success); font-weight: 500; background: color-mix(in oklch, var(--color-success) 8%, transparent); border-bottom: 1px solid var(--color-border-subtle); }
.task-editor-body { padding: 12px 16px; max-height: 560px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

.task-group { border: 1px solid var(--color-border-subtle); border-radius: 6px; }
.task-group-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--color-surface-0); cursor: pointer; font-size: 12px; border-radius: 6px 6px 0 0; }
.task-group-toggle { color: var(--color-text-muted); font-size: 11px; flex-shrink: 0; }
.task-group-name { font-weight: 600; color: var(--color-text-primary); }
.task-group-count { font-size: 11px; color: var(--color-text-muted); }
.task-group-spacer { flex: 1; }
.task-group-action { border: none; background: none; font-size: 11px; color: var(--color-text-muted); cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.task-group-action:hover { background: var(--color-surface-2); color: var(--color-text-secondary); }
.task-group-action.danger:hover { color: var(--color-error); }
.task-group-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }

.task-card { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-0); }
.task-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.task-card-title-input { flex: 1; font-size: 13px; font-weight: 600; color: var(--color-text-primary); background: transparent; border: none; outline: none; padding: 0; }
.task-card-title { flex: 1; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.task-card-actions { display: flex; gap: 2px; flex-shrink: 0; }
.task-card-btn { height: 22px; padding: 0 6px; display: flex; align-items: center; justify-content: center; border: none; background: none; border-radius: 4px; font-size: 11px; color: var(--color-text-muted); cursor: pointer; }
.task-card-btn:hover { background: var(--color-surface-2); color: var(--color-text-secondary); }
.task-card-btn.active { background: var(--color-accent); color: var(--color-surface-0); }
.task-card-btn.danger:hover { color: var(--color-error); }

.task-card-fields { display: flex; flex-direction: column; gap: 6px; }
.task-card-field { display: flex; align-items: center; gap: 8px; }
.task-card-field-label { font-size: 12px; color: var(--color-text-muted); min-width: 32px; flex-shrink: 0; }
.task-card-field-label-input { width: 56px; font-size: 11px; color: var(--color-text-muted); background: transparent; border: none; border-bottom: 1px dashed var(--color-border-subtle); outline: none; padding: 2px 0; flex-shrink: 0; }
.task-card-field-label-input:focus { border-bottom-color: var(--color-accent); color: var(--color-text-primary); }
.task-card-field-input { flex: 1; font-size: 12px; color: var(--color-text-secondary); background: transparent; border: none; border-bottom: 1px solid var(--color-border-subtle); outline: none; padding: 2px 0; min-width: 0; }
.task-card-field-input:focus { border-bottom-color: var(--color-accent); color: var(--color-text-primary); }
.task-card-field-textarea { flex: 1; font-size: 12px; color: var(--color-text-secondary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: 4px; outline: none; padding: 4px 8px; min-width: 0; resize: vertical; font-family: inherit; line-height: 1.5; }
.task-card-field-textarea:focus { border-color: var(--color-accent); color: var(--color-text-primary); }
.task-card-field-value { flex: 1; font-size: 12px; color: var(--color-text-secondary); }
.task-card-field-remove { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border: none; background: none; border-radius: 3px; font-size: 11px; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0; }
.task-card-field-remove:hover { background: var(--color-surface-2); color: var(--color-error); }
.task-card-add-field { align-self: flex-start; border: none; background: none; font-size: 11px; color: var(--color-text-muted); cursor: pointer; padding: 2px 4px; border-radius: 3px; }
.task-card-add-field:hover { background: var(--color-surface-2); color: var(--color-text-secondary); }

.task-card-raw { margin-top: 4px; }
.task-card-raw-input { width: 100%; font-size: 11px; font-family: monospace; color: var(--color-text-secondary); background: var(--color-surface-2); border: 1px solid var(--color-border-subtle); border-radius: 4px; padding: 8px; resize: vertical; outline: none; line-height: 1.5; }
.task-card-raw-input:focus { border-color: var(--color-accent); }

.task-editor-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); background: color-mix(in oklch, var(--color-surface-0) 75%, transparent); }
.task-editor-spacer { flex: 1; }
.task-editor-btn { padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.task-editor-btn.primary { border: 1px solid var(--color-accent); background: var(--color-accent); color: var(--color-surface-0); }
.task-editor-btn.primary:hover { opacity: 0.9; }
.task-editor-btn.secondary { border: 1px solid var(--color-border-subtle); background: var(--color-surface-0); color: var(--color-text-secondary); }
.task-editor-btn.secondary:hover { background: var(--color-surface-2); border-color: var(--color-accent); color: var(--color-text-primary); }

.task-editor-feedback { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); }
.task-editor-feedback-input { flex: 1; font-size: 12px; padding: 7px 12px; border: 1px solid var(--color-border-subtle); border-radius: 6px; background: var(--color-surface-0); color: var(--color-text-primary); outline: none; font-family: inherit; }
.task-editor-feedback-input:focus { border-color: var(--color-accent); }
</style>
