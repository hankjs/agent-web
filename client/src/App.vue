<script setup lang="ts">
import { watch } from "vue";
import { useRouter } from "vue-router";
import { useSession } from "./composables/useSession";
import MessageToast from "./components/MessageToast.vue";

const { isAuthenticated } = useSession();
const router = useRouter();

watch(isAuthenticated, (authed) => {
  if (!authed) router.push({ name: "login" });
}, { immediate: true });
</script>

<template>
  <div class="h-screen flex flex-col" style="background: var(--color-surface-0); color: var(--color-text-primary)">
    <MessageToast />
    <router-view class="flex-1 overflow-hidden" />
  </div>
</template>
