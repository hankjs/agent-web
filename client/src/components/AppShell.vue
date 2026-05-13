<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useSession } from "../composables/useSession";
import { useSidebarPanels } from "../composables/useSidebarPanels";

const router = useRouter();
const route = useRoute();
const { sessions, fetchSessions, selectSession, deleteSession, logout } = useSession();
const { panels: sidebarPanels, activePanelId, togglePanel, closePanel } = useSidebarPanels();

const navCollapsed = ref(false);
const lastPanelId = ref<string | null>(null);

const rightPanelOpen = computed(() => activePanelId.value !== null);

const activeSection = computed(() => {
  const name = route.name as string;
  if (name === "sessions" || name === "chat" || name === "agent") return "sessions";
  if (name === "specs") return "specs";
  if (name === "changes" || name === "change-detail") return "changes";
  if (name === "skills") return "skills";
  if (name === "agent-settings") return "settings";
  return "sessions";
});

function navigateTo(name: string) {
  router.push({ name });
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}时`;
  const days = Math.floor(hrs / 24);
  return `${days}天`;
}

function displayTitle(title: string, workDir: string | null): string {
  if (title) return title;
  if (workDir) return workDir.split("/").pop() || workDir;
  return "未命名";
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey) {
    e.preventDefault();
    navCollapsed.value = !navCollapsed.value;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "b" && e.shiftKey) {
    e.preventDefault();
    if (activePanelId.value) {
      lastPanelId.value = activePanelId.value;
      closePanel();
    } else {
      const target = lastPanelId.value || sidebarPanels.value[0]?.id;
      if (target) togglePanel(target);
    }
  }
}

onMounted(() => {
  fetchSessions();
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
});

defineExpose({ rightPanelOpen, navCollapsed });
</script>

<template>
  <div class="shell">
    <!-- Left Navigation -->
    <nav class="nav" :class="{ collapsed: navCollapsed }">
      <div class="nav-header">
        <span v-if="!navCollapsed" class="nav-brand">Hank</span>
        <button
          class="nav-toggle"
          @click="navCollapsed = !navCollapsed"
          :aria-label="navCollapsed ? '展开导航' : '收起导航'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="nav-sections">
        <!-- Sessions -->
        <div class="nav-section">
          <button
            v-if="!navCollapsed"
            class="nav-section-header"
            :class="{ active: activeSection === 'sessions' }"
            @click="navigateTo('sessions')"
          >
            会话
          </button>
          <button
            v-else
            class="nav-icon-btn"
            :class="{ active: activeSection === 'sessions' }"
            @click="navigateTo('sessions')"
            aria-label="会话"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12v9H4l-2 2V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Session list (expanded only) -->
          <div v-if="!navCollapsed && activeSection === 'sessions'" class="nav-session-list">
            <div
              v-for="s in sessions.slice(0, 20)"
              :key="s.id"
              class="nav-session-item"
              :class="{ active: route.params.sessionId === s.id }"
              @click="selectSession(s)"
            >
              <span class="nav-session-title">{{ displayTitle(s.title, s.work_dir) }}</span>
              <span class="nav-session-time">{{ relativeTime(s.updated_at) }}</span>
            </div>
          </div>
        </div>

        <!-- Specs -->
        <div class="nav-section">
          <button
            v-if="!navCollapsed"
            class="nav-section-header"
            :class="{ active: activeSection === 'specs' }"
            @click="navigateTo('specs')"
          >
            规格
          </button>
          <button
            v-else
            class="nav-icon-btn"
            :class="{ active: activeSection === 'specs' }"
            @click="navigateTo('specs')"
            aria-label="规格"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 2h8v12H4V2z" stroke="currentColor" stroke-width="1.3"/>
              <path d="M6 5h4M6 7.5h4M6 10h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- Changes -->
        <div class="nav-section">
          <button
            v-if="!navCollapsed"
            class="nav-section-header"
            :class="{ active: activeSection === 'changes' }"
            @click="navigateTo('changes')"
          >
            变更
          </button>
          <button
            v-else
            class="nav-icon-btn"
            :class="{ active: activeSection === 'changes' }"
            @click="navigateTo('changes')"
            aria-label="变更"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- Skills -->
        <div class="nav-section">
          <button
            v-if="!navCollapsed"
            class="nav-section-header"
            :class="{ active: activeSection === 'skills' }"
            @click="navigateTo('skills')"
          >
            Skills
          </button>
          <button
            v-else
            class="nav-icon-btn"
            :class="{ active: activeSection === 'skills' }"
            @click="navigateTo('skills')"
            aria-label="Skills"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Bottom: Settings -->
      <div class="nav-footer">
        <button
          v-if="!navCollapsed"
          class="nav-section-header"
          :class="{ active: activeSection === 'settings' }"
          @click="navigateTo('agent-settings')"
        >
          设置
        </button>
        <button
          v-else
          class="nav-icon-btn"
          :class="{ active: activeSection === 'settings' }"
          @click="navigateTo('agent-settings')"
          aria-label="设置"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </nav>

    <!-- Center Content -->
    <main class="content">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <!-- Right Panel (driven by useSidebarPanels) -->
    <aside v-if="rightPanelOpen" class="panel">
      <div class="panel-header">
        <span class="panel-title">{{ sidebarPanels.find(p => p.id === activePanelId)?.title }}</span>
        <button class="panel-close" @click="closePanel()" aria-label="关闭面板">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="panel-content" id="shell-panel-content"></div>
    </aside>

    <!-- Activity Bar -->
    <div v-if="sidebarPanels.length > 0" class="activity-bar">
      <button
        v-for="panel in sidebarPanels"
        :key="panel.id"
        class="activity-bar-btn"
        :class="{ active: activePanelId === panel.id }"
        @click="togglePanel(panel.id)"
        :aria-label="panel.title"
        :title="panel.title"
      >
        <svg v-if="panel.icon === 'changes'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <svg v-else-if="panel.icon === 'specs'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <svg v-else-if="panel.icon === 'outline'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* Left Navigation */
.nav {
  width: var(--nav-width);
  min-width: var(--nav-width);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border-subtle);
  transition: width var(--duration-normal) var(--ease-out-expo),
              min-width var(--duration-normal) var(--ease-out-expo);
  overflow: hidden;
}

.nav.collapsed {
  width: var(--nav-collapsed);
  min-width: var(--nav-collapsed);
}

.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-3);
  height: var(--header-height);
  flex-shrink: 0;
}

.nav-brand {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  padding-left: var(--space-2);
}

.nav-toggle {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--duration-fast), background var(--duration-fast);
}

.nav-toggle:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.nav-sections {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-2);
}

.nav-section {
  margin-bottom: var(--space-1);
}

.nav-section-header {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: var(--space-2) var(--space-2);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast), background var(--duration-fast);
}

.nav-section-header:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.nav-section-header.active {
  color: var(--color-accent);
}

.nav-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 0 auto var(--space-1);
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast), background var(--duration-fast);
}

.nav-icon-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.nav-icon-btn.active {
  color: var(--color-accent);
}

/* Session list in nav */
.nav-session-list {
  margin-top: var(--space-1);
}

.nav-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-2);
  margin-left: var(--space-2);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast);
}

.nav-session-item:hover {
  background: var(--color-surface-hover);
}

.nav-session-item.active {
  background: var(--color-surface-2);
}

.nav-session-title {
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.nav-session-item.active .nav-session-title {
  color: var(--color-text-primary);
}

.nav-session-time {
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
  margin-left: var(--space-2);
}

.nav-footer {
  padding: var(--space-2);
  border-top: 1px solid var(--color-border-subtle);
}

/* Center Content */
.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Right Panel */
.panel {
  width: var(--panel-width);
  min-width: var(--panel-width);
  background: var(--color-surface-1);
  border-left: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  height: var(--header-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
}

.panel-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  transition: color var(--duration-fast);
}

.panel-close:hover {
  color: var(--color-text-primary);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-3) var(--space-3);
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Activity Bar */
.activity-bar {
  width: 40px;
  min-width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: var(--space-2);
  gap: var(--space-1);
  background: var(--color-surface-0);
  border-left: 1px solid var(--color-border-subtle);
}

.activity-bar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
}

.activity-bar-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.activity-bar-btn.active {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.activity-bar-btn.active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--color-accent);
  border-radius: 1px;
}
</style>
