<script setup lang="ts">
import { ref } from "vue";
import { useSession } from "./composables/useSession";
import { useMessageTree } from "./composables/useMessageTree";
import SessionList from "./components/SessionList.vue";
import Chat from "./components/Chat.vue";
import ConversationOutline from "./components/ConversationOutline.vue";

const { view, currentSession, goBack } = useSession();
const { hasBranching, treeNodes } = useMessageTree();
const outlineVisible = ref(false);

function toggleOutline() {
  outlineVisible.value = !outlineVisible.value;
}
</script>

<template>
  <div class="h-screen flex flex-col" style="background: var(--color-surface-0); color: var(--color-text-primary)">
    <SessionList v-if="view === 'list'" class="flex-1 overflow-hidden" />
    <div v-else class="flex-1 overflow-hidden flex">
      <Chat
        class="flex-1 overflow-hidden"
        :session-id="currentSession!.id"
        :work-dir="currentSession!.work_dir ?? undefined"
        :title="currentSession!.title"
        :key="currentSession!.id"
        :show-outline-toggle="treeNodes.length > 0"
        @back="goBack"
        @toggle-outline="toggleOutline"
      />
      <ConversationOutline
        v-if="(hasBranching || outlineVisible) && treeNodes.length > 0"
        :session-id="currentSession!.id"
        :key="'outline-' + currentSession!.id"
      />
    </div>
  </div>
</template>
