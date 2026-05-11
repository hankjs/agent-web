<script setup lang="ts">
import { ref, computed } from "vue";
import { useSession } from "../composables/useSession";

const { sessions, createSession } = useSession();

const emit = defineEmits<{ close: [] }>();

const selectedKey = ref<string | null>(null);

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

async function submit() {
  const sel = getSelected();
  if (!sel) return;
  await createSession(sel.work_dir, sel.environment, "explore");
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
        <div class="project-label">选择项目：</div>
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
  border-radius: 12px;
  width: 420px;
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
.project-label { font-size: 12px; color: var(--color-text-muted, #888); margin-bottom: 8px; }
.project-options { display: flex; flex-direction: column; gap: 6px; }
.project-option {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--color-border-subtle, #333);
  transition: background 0.12s, border-color 0.12s;
}
.project-option:hover { background: var(--color-surface-hover, #1a1a1a); }
.project-option.active { border-color: var(--color-accent, #3b82f6); background: rgba(59, 130, 246, 0.08); }
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
