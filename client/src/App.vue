<script setup lang="ts">
import { useSession } from "./composables/useSession";
import SessionList from "./components/SessionList.vue";
import Chat from "./components/Chat.vue";

const { view, currentSession, goBack } = useSession();
</script>

<template>
  <div class="h-screen flex flex-col" style="background: var(--color-surface-0); color: var(--color-text-primary)">
    <SessionList v-if="view === 'list'" class="flex-1 overflow-hidden" />
    <Chat
      v-else
      class="flex-1 overflow-hidden"
      :session-id="currentSession!.id"
      :work-dir="currentSession!.work_dir ?? undefined"
      :title="currentSession!.title"
      :key="currentSession!.id"
      @back="goBack"
    />
  </div>
</template>
