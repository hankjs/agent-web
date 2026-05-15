<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { listSkills, installSkill, uninstallSkill, type SkillInfo } from "../api/skills";
import ActionBtn from "../components/ActionBtn.vue";
import PageLoading from "../components/PageLoading.vue";

const { sessions, fetchSessions } = useSession();
const skills = ref<SkillInfo[]>([]);
const loading = ref(false);
const initialLoading = ref(true);
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
  await fetchSkills();
  initialLoading.value = false;
});
</script>

<template>
  <div class="skills-view">
    <header class="view-header">
      <span class="view-title">Skills</span>
      <div class="header-actions">
        <button class="scope-btn" @click="showScopePicker = !showScopePicker">{{ scopeLabel }}</button>
        <ActionBtn variant="primary" @click="showInstall = !showInstall">安装</ActionBtn>
      </div>
    </header>

    <div class="view-body">
      <PageLoading v-if="initialLoading" />
      <template v-else>
      <!-- Install form (inline, not modal) -->
      <div v-if="showInstall" class="install-form">
        <input v-model="installSource" placeholder="GitHub source (owner/repo)" class="form-input" />
        <input v-model="installName" placeholder="Skill 名称" class="form-input" />
        <input v-model="installPath" placeholder="路径 (默认 skill/SKILL.md)" class="form-input" />
        <div class="form-row">
          <ActionBtn @click="showInstall = false">取消</ActionBtn>
          <ActionBtn variant="primary" @click="submitInstall" :disabled="loading">安装</ActionBtn>
        </div>
      </div>

      <!-- Scope picker (inline dropdown) -->
      <div v-if="showScopePicker" class="scope-picker">
        <div
          class="scope-option"
          :class="{ active: scope === 'global' }"
          @click="selectGlobal"
        >
          <span class="scope-name">全局</span>
          <span class="scope-path">~/.agents/skills/</span>
        </div>
        <div
          v-for="p in projects" :key="p.work_dir"
          class="scope-option"
          :class="{ active: scope === 'project' && projectDir === p.work_dir }"
          @click="selectProject(p.work_dir)"
        >
          <span class="scope-name">{{ p.label }}</span>
          <span class="scope-path">{{ p.work_dir }}</span>
        </div>
        <div v-if="projects.length === 0" class="empty-inline">暂无项目</div>
      </div>

      <!-- Skills list -->
      <div v-if="!effectiveDir" class="empty">请先在会话中设置工作目录</div>
      <table v-else-if="skills.length" class="skills-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>描述</th>
            <th class="col-source">来源</th>
            <th class="col-action"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="skill in skills" :key="skill.name">
            <td class="cell-name">{{ skill.name }}</td>
            <td class="cell-desc">{{ skill.description || '—' }}</td>
            <td class="cell-source">{{ skill.source || 'local' }}</td>
            <td class="cell-action">
              <button class="uninstall-btn" @click="handleUninstall(skill.name)">卸载</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="empty">暂无已安装的 Skills</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.skills-view {
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
  gap: var(--space-2);
}

.scope-btn {
  font-size: 11px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  border: none;
  cursor: pointer;
  transition: color var(--duration-fast);
}

.scope-btn:hover {
  color: var(--color-text-primary);
}

.view-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
}

.install-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
}

.form-input {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface-0);
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color var(--duration-fast);
}

.form-input:focus {
  border-color: var(--color-accent);
}

.form-input::placeholder {
  color: var(--color-text-muted);
}

.form-row {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.scope-picker {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  margin-bottom: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
}

.scope-option {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}

.scope-option:hover {
  background: var(--color-surface-hover);
}

.scope-option.active {
  background: var(--color-surface-2);
}

.scope-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  display: block;
}

.scope-path {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  display: block;
  margin-top: 1px;
}

.skills-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.skills-table th {
  text-align: left;
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 11px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.skills-table td {
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
}

.cell-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.cell-desc {
  color: var(--color-text-secondary);
}

.cell-source {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}

.col-source { width: 120px; }
.col-action { width: 60px; }

.cell-action {
  text-align: right;
}

.uninstall-btn {
  font-size: 11px;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-error);
  background: transparent;
  color: var(--color-error);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity var(--duration-fast);
}

.uninstall-btn:hover {
  opacity: 1;
}

.empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: var(--space-8) 0;
  text-align: center;
}

.empty-inline {
  font-size: 11px;
  color: var(--color-text-muted);
  padding: var(--space-2) var(--space-3);
}
</style>
