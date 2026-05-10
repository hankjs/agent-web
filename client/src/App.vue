<script setup lang="ts">
import { ref } from "vue";
import { useSession } from "./composables/useSession";
import { useMessageTree } from "./composables/useMessageTree";
import SessionList from "./components/SessionList.vue";
import Chat from "./components/Chat.vue";
import ConversationOutline from "./components/ConversationOutline.vue";
import Login from "./components/Login.vue";
import LocalAgentSettings from "./components/LocalAgentSettings.vue";
import MessageToast from "./components/MessageToast.vue";
import Specs from "./components/Specs.vue";
import Changes from "./components/Changes.vue";
import ChangeDetail from "./components/ChangeDetail.vue";
import SpecPanel from "./components/SpecPanel.vue";

const { view, currentSession, goBack, isAuthenticated, navigateTo, createExploreSession } = useSession();
const { hasBranching, treeNodes } = useMessageTree();
const outlineVisible = ref(false);
const showSettings = ref(false);
const specPanelVisible = ref(true);

function toggleOutline() {
  outlineVisible.value = !outlineVisible.value;
}
</script>

<template>
  <div class="h-screen flex flex-col" style="background: var(--color-surface-0); color: var(--color-text-primary)">
    <MessageToast />
    <Login v-if="!isAuthenticated" />
    <template v-else>
      <LocalAgentSettings v-if="showSettings" @close="showSettings = false" />
      <SessionList v-else-if="view === 'list'" class="flex-1 overflow-hidden">
        <template #header-actions>
          <button class="nav-btn" @click="navigateTo('specs')">Specs</button>
          <button class="nav-btn" @click="createExploreSession()">New Change</button>
          <button class="settings-btn" @click="showSettings = true" aria-label="Local Agent Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </template>
      </SessionList>
      <Specs v-else-if="view === 'specs'" class="flex-1 overflow-hidden" />
      <Changes v-else-if="view === 'changes'" class="flex-1 overflow-hidden" />
      <ChangeDetail v-else-if="view === 'change-detail'" class="flex-1 overflow-hidden" />
      <div v-else-if="view === 'chat'" class="flex-1 overflow-hidden flex">
        <Chat
          class="flex-1 overflow-hidden"
          :session-id="currentSession!.id"
          :work-dir="currentSession!.work_dir ?? undefined"
          :title="currentSession!.title"
          :environment="currentSession!.environment"
          :session-type="currentSession!.session_type"
          :key="currentSession!.id"
          :show-outline-toggle="treeNodes.length > 0"
          @back="goBack"
          @toggle-outline="toggleOutline"
          @open-settings="showSettings = true"
        />
        <SpecPanel v-if="specPanelVisible" />
        <ConversationOutline
          v-if="(hasBranching || outlineVisible) && treeNodes.length > 0"
          :session-id="currentSession!.id"
          :key="'outline-' + currentSession!.id"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.settings-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-1);
}
.nav-btn {
  background: none;
  border: 1px solid var(--color-border, #333);
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.nav-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-1);
}
</style>
