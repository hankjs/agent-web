<script setup lang="ts">
import Chat from "./components/Chat.vue";
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-900 text-gray-100">
    <header class="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
      <h1 class="text-lg font-semibold">Hank Agent</h1>
    </header>
    <Chat class="flex-1 overflow-hidden" />
  </div>
</template>
