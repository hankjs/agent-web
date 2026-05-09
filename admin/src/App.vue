<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <nav class="bg-white border-b border-gray-200 px-6 py-3">
      <div class="flex items-center gap-6">
        <span class="text-lg font-semibold text-gray-900">Hank Admin</span>
        <div class="flex gap-4">
          <RouterLink to="/" class="text-sm text-gray-600 hover:text-gray-900" active-class="text-gray-900 font-medium">Dashboard</RouterLink>
          <RouterLink to="/sessions" class="text-sm text-gray-600 hover:text-gray-900" active-class="text-gray-900 font-medium">Sessions</RouterLink>
          <RouterLink to="/prompts" class="text-sm text-gray-600 hover:text-gray-900" active-class="text-gray-900 font-medium">Prompt Lab</RouterLink>
        </div>
      </div>
    </nav>
    <main class="p-6">
      <RouterView />
    </main>
  </div>
</template>
