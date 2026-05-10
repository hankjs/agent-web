<script setup lang="ts">
import { ref } from "vue";
import { useSession } from "../composables/useSession";

const { login } = useSession();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleLogin() {
  if (!username.value || !password.value) return;
  loading.value = true;
  error.value = "";

  try {
    const result = await login(username.value, password.value);
    if (!result.ok) {
      error.value = result.error || "Invalid credentials";
    }
  } catch {
    error.value = "Network error";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="h-screen flex items-center justify-center" style="background: var(--color-surface-0)">
    <div class="w-72">
      <div class="text-sm font-medium text-text-secondary mb-8">Hank</div>

      <form @submit.prevent="handleLogin" class="space-y-3">
        <input
          v-model="username"
          type="text"
          placeholder="Username"
          autocomplete="username"
          class="w-full bg-transparent border border-border rounded-md px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
        />
        <input
          v-model="password"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          class="w-full bg-transparent border border-border rounded-md px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          :disabled="loading"
          class="w-full px-3.5 py-2 bg-text-primary text-surface-0 text-[13px] rounded-md hover:opacity-80 disabled:opacity-40 transition-opacity"
        >{{ loading ? 'Signing in...' : 'Sign in' }}</button>
      </form>

      <div v-if="error" class="mt-3 text-[12px] text-error">{{ error }}</div>
    </div>
  </div>
</template>
