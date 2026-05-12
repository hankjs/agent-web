<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { listSkills, installSkill, uninstallSkill, type SkillInfo } from "../api/skills";

const { sessions, fetchSessions, navigateTo } = useSession();
const skills = ref<SkillInfo[]>([]);
const loading = ref(false);
const showInstall = ref(false);
const showScopePicker = ref(false);
const installSource = ref("");
const installName = ref("");
const installPath = ref("");

type Scope = "global" | "project";
const scope = ref<Scope>("global");
const projectDir = ref("");
const homeDir = ref("");

const effectiveDir = computed(() => {
  if (scope.value === "global") return homeDir.value;
  return projectDir.value;
});

const scopeLabel = computed(() => {
  if (scope.value === "global") return "全局";
  return projectDir.value.split("/").pop() || "项目";
});

// 从 sessions 中提取项目列表
const projects = computed(() => {
  const map = new Map<string, { work_dir: string; label: string }>();
  for (const s of sessions.value) {
    if (s.work_dir && !map.has(s.work_dir)) {
      map.set(s.work_dir, {
        work_dir: s.work_dir,
        label: s.work_dir.split("/").pop() || s.work_dir,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
});

function openScopePicker() {
  showScopePicker.value = true;
}

function selectGlobal() {
  scope.value = "global";
  projectDir.value = "";
  showScopePicker.value = false;
  fetchSkills();
}

function selectProject(dir: string) {
  scope.value = "project";
  projectDir.value = dir;
  showScopePicker.value = false;
  fetchSkills();
}

async function fetchSkills() {
  if (!effectiveDir.value) return;
  loading.value = true;
  const res = await listSkills(effectiveDir.value);
  if (res.ok && res.data) skills.value = res.data;
  loading.value = false;
}

async function submitInstall() {
  if (!installSource.value.trim() || !installName.value.trim()) return;
  loading.value = true;
  const res = await installSkill({
    source: installSource.value.trim(),
    skill_name: installName.value.trim(),
    work_dir: effectiveDir.value,
    skill_path: installPath.value.trim() || undefined,
  });
  if (res.ok) {
    showInstall.value = false;
    installSource.value = "";
    installName.value = "";
    installPath.value = "";
    await fetchSkills();
  }
  loading.value = false;
}

async function handleUninstall(name: string) {
  if (!confirm(`确定卸载 skill "${name}"？`)) return;
  loading.value = true;
  const res = await uninstallSkill(name, effectiveDir.value);
  if (res.ok) await fetchSkills();
  loading.value = false;
}

onMounted(async () => {
  fetchSessions();
  try {
    const { homeDir: tauriHome } = await import("@tauri-apps/api/path");
    homeDir.value = await tauriHome();
  } catch {
    homeDir.value = "/Users/" + (localStorage.getItem("hank_username") || "admin");
  }
  fetchSkills();
});
</script>

<template>
  <div class="skills-page">
    <div class="skills-header">
      <button class="back-btn" @click="navigateTo('sessions')">返回</button>
      <h2>Skills</h2>
      <button class="scope-tag" @click="openScopePicker">{{ scopeLabel }}</button>
      <button class="create-btn" @click="showInstall = true">安装 Skill</button>
    </div>
<!-- PLACEHOLDER_TEMPLATE_REST -->
    <div v-if="!effectiveDir" class="empty">请先在会话中设置工作目录</div>

    <template v-else>
      <div v-if="showInstall" class="install-form">
        <input v-model="installSource" placeholder="GitHub source (owner/repo)" class="input" />
        <input v-model="installName" placeholder="Skill 名称" class="input" />
        <input v-model="installPath" placeholder="路径 (默认 skill/SKILL.md)" class="input" />
        <div class="form-actions">
          <button class="primary" @click="submitInstall" :disabled="loading">安装</button>
          <button @click="showInstall = false">取消</button>
        </div>
      </div>

      <div class="skills-grid">
        <div v-for="skill in skills" :key="skill.name" class="skill-card">
          <div class="card-top">
            <div class="card-name">{{ skill.name }}</div>
            <button class="uninstall-btn" @click.stop="handleUninstall(skill.name)">卸载</button>
          </div>
          <div class="card-desc">{{ skill.description || '无描述' }}</div>
          <div class="card-meta">
            <span class="source">{{ skill.source || 'local' }}</span>
          </div>
        </div>
        <div v-if="skills.length === 0 && !loading" class="empty">暂无已安装的 Skills</div>
      </div>
    </template>

    <!-- Scope picker dialog -->
    <div v-if="showScopePicker" class="modal-overlay" @click.self="showScopePicker = false">
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title">选择 Skills 范围</span>
          <button class="close-btn" @click="showScopePicker = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="project-options">
            <div
              class="project-option" :class="{ active: scope === 'global' }"
              @click="selectGlobal"
            >
              <div class="project-top">
                <span class="project-name">全局</span>
              </div>
              <span class="project-path">~/.agents/skills/</span>
            </div>
            <div
              v-for="p in projects" :key="p.work_dir"
              class="project-option" :class="{ active: scope === 'project' && projectDir === p.work_dir }"
              @click="selectProject(p.work_dir)"
            >
              <div class="project-top">
                <span class="project-name">{{ p.label }}</span>
              </div>
              <span class="project-path">{{ p.work_dir }}</span>
            </div>
            <div v-if="projects.length === 0" class="empty-inline">暂无项目，请先创建会话。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skills-page { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; }
.skills-header { display: flex; align-items: center; gap: 12px; }
.skills-header h2 { margin: 0; font-size: 18px; }
.scope-tag { font-size: 11px; padding: 2px 8px; border-radius: 3px; background: #1e3a5f; color: #60a5fa; border: 1px solid #2563eb33; cursor: pointer; white-space: nowrap; }
.scope-tag:hover { background: #1e40af33; }
.create-btn { font-size: 13px; margin-left: auto; }
.install-form { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); }
.form-actions { display: flex; gap: 8px; }
.input { padding: 8px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-0, #111); color: inherit; }
.skills-grid { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }
.skill-card { padding: 12px; border-radius: 8px; border: 1px solid var(--color-border, #333); }
.skill-card:hover { background: var(--color-surface-1, #1a1a1a); }
.card-top { display: flex; align-items: center; justify-content: space-between; }
.card-name { font-weight: 600; font-size: 14px; }
.card-desc { font-size: 13px; color: var(--color-text-muted, #888); margin-top: 4px; }
.card-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 6px; }
.source { color: var(--color-text-muted, #888); font-family: monospace; font-size: 11px; }
button { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--color-border, #333); background: var(--color-surface-1, #1a1a1a); color: inherit; cursor: pointer; }
button:hover { background: var(--color-surface-2, #252525); }
button.primary { background: var(--color-accent, #3b82f6); border-color: var(--color-accent, #3b82f6); color: white; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.uninstall-btn { font-size: 12px; padding: 3px 8px; color: #f87171; border-color: #7f1d1d; }
.uninstall-btn:hover { background: #7f1d1d; }
.back-btn { font-size: 13px; }
.empty { color: var(--color-text-muted, #888); padding: 24px; text-align: center; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: var(--color-surface-0, #111); border: 1px solid var(--color-border-subtle, #333); border-radius: 12px; width: 380px; max-width: 90vw; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--color-border-subtle, #333); }
.modal-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary, #eee); }
.close-btn { background: none; border: none; color: var(--color-text-muted, #888); font-size: 20px; cursor: pointer; padding: 0 4px; }
.close-btn:hover { color: var(--color-text-primary, #eee); }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.project-options { display: flex; flex-direction: column; gap: 6px; }
.project-option { padding: 10px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--color-border-subtle, #333); transition: background 0.12s, border-color 0.12s; }
.project-option:hover { background: var(--color-surface-hover, #1a1a1a); }
.project-option.active { border-color: var(--color-accent, #3b82f6); background: rgba(59, 130, 246, 0.08); }
.project-top { display: flex; align-items: center; gap: 8px; }
.project-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary, #eee); }
.project-path { display: block; font-size: 11px; color: var(--color-text-muted, #888); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-inline { font-size: 12px; color: var(--color-text-muted, #888); padding: 12px; text-align: center; }
</style>
