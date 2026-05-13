<script setup lang="ts">
import { ref, computed } from "vue";
import { useSession } from "../composables/useSession";

const { sessions, createSession } = useSession();

const emit = defineEmits<{ close: [] }>();

const selectedKey = ref<string | null>(null);
const depth = ref<"quick" | "standard" | "deep">("standard");
const questionStyle = ref<"guided" | "open">("guided");
const focusAreas = ref<string[]>(["用户目标", "核心流程", "边界条件", "交付标准"]);

const focusOptions = ["用户目标", "核心流程", "数据与接口", "界面体验", "边界条件", "迁移兼容", "交付标准"];

interface ProjectEntry {
  work_dir: string;
  environment: "remote" | "local";
  label: string;
}

const projects = computed<ProjectEntry[]>(() => {
  const map = new Map<string, ProjectEntry>();
  for (const s of sessions.value) {
    const key = `${s.work_dir}::${s.environment}`;
    if (s.work_dir && !map.has(key)) {
      map.set(key, {
        work_dir: s.work_dir,
        environment: s.environment,
        label: s.work_dir.split("/").pop() || s.work_dir,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
});

if (projects.value.length === 1) {
  selectedKey.value = `${projects.value[0].work_dir}::${projects.value[0].environment}`;
}

function getSelected(): ProjectEntry | undefined {
  if (!selectedKey.value) return undefined;
  return projects.value.find(p => `${p.work_dir}::${p.environment}` === selectedKey.value);
}

function toggleFocus(area: string) {
  if (focusAreas.value.includes(area)) {
    focusAreas.value = focusAreas.value.filter(a => a !== area);
  } else {
    focusAreas.value.push(area);
  }
}

async function submit() {
  const sel = getSelected();
  if (!sel) return;
  await createSession(sel.work_dir, sel.environment, "explore", {
    metadata: {
      depth: depth.value,
      questionStyle: questionStyle.value,
      focusAreas: focusAreas.value,
    },
  });
  emit("close");
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <span class="modal-title">新建需求</span>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="field-label">探索深度</div>
        <div class="segmented">
          <button :class="{ active: depth === 'quick' }" @click="depth = 'quick'">快速</button>
          <button :class="{ active: depth === 'standard' }" @click="depth = 'standard'">标准</button>
          <button :class="{ active: depth === 'deep' }" @click="depth = 'deep'">深入</button>
        </div>

        <div class="field-label">提问方式</div>
        <div class="segmented">
          <button :class="{ active: questionStyle === 'guided' }" @click="questionStyle = 'guided'">选项优先</button>
          <button :class="{ active: questionStyle === 'open' }" @click="questionStyle = 'open'">开放追问</button>
        </div>

        <div class="field-label">关注范围</div>
        <div class="focus-grid">
          <button
            v-for="area in focusOptions"
            :key="area"
            class="focus-chip"
            :class="{ active: focusAreas.includes(area) }"
            @click="toggleFocus(area)"
          >{{ area }}</button>
        </div>

        <div class="project-label">选择项目</div>
        <div class="project-options">
          <div
            v-for="p in projects" :key="`${p.work_dir}::${p.environment}`"
            class="project-option" :class="{ active: selectedKey === `${p.work_dir}::${p.environment}` }"
            @click="selectedKey = `${p.work_dir}::${p.environment}`"
          >
            <div class="project-top">
              <span class="project-name">{{ p.label }}</span>
              <span class="env-badge" :class="p.environment">{{ p.environment === 'local' ? '本地' : '远程' }}</span>
            </div>
            <span class="project-path">{{ p.work_dir }}</span>
          </div>
          <div v-if="projects.length === 0" class="empty-inline">暂无项目，请先创建会话。</div>
        </div>
      </div>
      <div class="modal-footer">
        <button @click="emit('close')" class="cancel-btn">取消</button>
        <button class="submit-btn" :disabled="!selectedKey" @click="submit">开始探索</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--color-surface-0, #111);
  border: 1px solid var(--color-border-subtle, #333);
  border-radius: 8px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-subtle, #333);
}
.modal-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary, #eee); }
.close-btn { background: none; border: none; color: var(--color-text-muted, #888); font-size: 20px; cursor: pointer; padding: 0 4px; }
.close-btn:hover { color: var(--color-text-primary, #eee); }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.field-label, .project-label { display: block; font-size: 12px; color: var(--color-text-muted, #888); margin-bottom: 8px; }
.project-label { margin-top: 16px; }
.segmented {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  padding: 3px;
  border-radius: 7px;
  background: var(--color-surface-1, #1a1a1a);
  border: 1px solid var(--color-border-subtle, #333);
  margin-bottom: 14px;
}
.segmented button {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-muted, #888);
  font-size: 12px;
  padding: 7px 8px;
  cursor: pointer;
}
.segmented button.active {
  background: var(--color-surface-3, #333);
  color: var(--color-text-primary, #eee);
}
.focus-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 2px;
}
.focus-chip {
  min-height: 32px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle, #333);
  background: transparent;
  color: var(--color-text-secondary, #aaa);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.focus-chip.active {
  border-color: var(--color-accent, #3b82f6);
  background: color-mix(in oklch, var(--color-accent, #3b82f6) 14%, transparent);
  color: var(--color-text-primary, #eee);
}
.project-options { display: flex; flex-direction: column; gap: 6px; }
.project-option {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--color-border-subtle, #333);
  transition: background 0.12s, border-color 0.12s;
}
.project-option:hover { background: var(--color-surface-hover, #1a1a1a); }
.project-option.active { border-color: var(--color-accent, #3b82f6); background: color-mix(in oklch, var(--color-accent, #3b82f6) 12%, transparent); }
.project-top { display: flex; align-items: center; gap: 8px; }
.project-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary, #eee); }
.env-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; }
.env-badge.local { color: var(--color-env-local, #4ade80); background: var(--color-env-local-bg, rgba(74, 222, 128, 0.12)); }
.env-badge.remote { color: var(--color-env-remote, #60a5fa); background: var(--color-env-remote-bg, rgba(96, 165, 250, 0.12)); }
.project-path { display: block; font-size: 11px; color: var(--color-text-muted, #888); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-subtle, #333);
}
.cancel-btn { padding: 7px 14px; background: none; border: 1px solid var(--color-border-subtle, #333); border-radius: 6px; font-size: 13px; color: var(--color-text-muted, #888); cursor: pointer; }
.cancel-btn:hover { color: var(--color-text-primary, #eee); }
.submit-btn { padding: 7px 16px; background: var(--color-accent, #3b82f6); color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.empty-inline { font-size: 12px; color: var(--color-text-muted, #888); padding: 12px; text-align: center; }
</style>
