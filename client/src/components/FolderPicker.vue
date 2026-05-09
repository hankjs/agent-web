<script setup lang="ts">
import { ref } from "vue";
import { authFetch } from "../composables/useSession";

const model = defineModel<string>({ default: "" });

const open = ref(false);
const browsePath = ref("");
const parentPath = ref<string | null>(null);
const entries = ref<{ name: string; is_dir: boolean }[]>([]);
const loading = ref(false);
const error = ref("");

async function fetchDir(path?: string) {
  loading.value = true;
  error.value = "";
  try {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await authFetch(`/api/fs/list${query}`);
    const data = await res.json();
    if (!res.ok) {
      error.value = data.error || "Failed to list directory";
      return;
    }
    browsePath.value = data.path;
    parentPath.value = data.parent ?? null;
    entries.value = data.entries;
  } catch (e: any) {
    error.value = e.message || "Network error";
  } finally {
    loading.value = false;
  }
}

function openBrowser() {
  open.value = true;
  fetchDir(model.value || undefined);
}

function navigateTo(name: string) {
  const next = browsePath.value.endsWith("/")
    ? browsePath.value + name
    : browsePath.value + "/" + name;
  fetchDir(next);
}

function navigateUp() {
  if (parentPath.value) fetchDir(parentPath.value);
}

function selectCurrent() {
  model.value = browsePath.value;
  open.value = false;
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    fetchDir(model.value || undefined);
  }
}

function closeBrowser() {
  open.value = false;
}
</script>

<template>
  <div class="folder-picker">
    <div class="picker-row">
      <input
        v-model="model"
        type="text"
        class="folder-input"
        placeholder="/path/to/project"
        aria-label="Working directory path"
        @keydown="onInputKeydown"
      />
      <button class="browse-btn" type="button" @click="openBrowser" aria-label="Browse folders">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.829.828a.5.5 0 00.353.146H13.5A1.5 1.5 0 0115 4.914V12.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" stroke="currentColor" stroke-width="1.3" fill="none"/>
        </svg>
      </button>
    </div>

    <div v-if="open" class="browser-dropdown">
      <div class="browser-header">
        <span class="browser-path">{{ browsePath }}</span>
        <button class="browser-close" type="button" @click="closeBrowser" aria-label="Close">&times;</button>
      </div>

      <div v-if="loading" class="browser-loading">Loading...</div>
      <div v-else-if="error" class="browser-error">{{ error }}</div>
      <div v-else class="browser-list">
        <button
          v-if="parentPath"
          class="browser-item browser-up"
          type="button"
          @click="navigateUp"
        >
          &larr; ..
        </button>
        <button
          v-for="entry in entries"
          :key="entry.name"
          class="browser-item"
          type="button"
          @click="navigateTo(entry.name)"
        >
          {{ entry.name }}/
        </button>
        <div v-if="!entries.length && !parentPath" class="browser-empty">No subdirectories</div>
      </div>

      <button class="browser-select" type="button" @click="selectCurrent">
        Select this folder
      </button>
    </div>
  </div>
</template>

<style scoped>
.folder-picker {
  width: 100%;
  position: relative;
}

.picker-row {
  display: flex;
  gap: 6px;
}

.folder-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.folder-input:focus {
  border-color: var(--color-accent-dim);
}

.folder-input::placeholder {
  color: var(--color-text-muted);
}

.browse-btn {
  padding: 8px 10px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  display: flex;
  align-items: center;
}

.browse-btn:hover {
  border-color: var(--color-accent-dim);
  color: var(--color-text-primary);
}

.browser-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 100;
  display: flex;
  flex-direction: column;
  max-height: 320px;
}

.browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

.browser-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.browser-list {
  overflow-y: auto;
  flex: 1;
}

.browser-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  background: none;
  border: none;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-family: var(--font-mono);
}

.browser-item:hover {
  background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
}

.browser-up {
  color: var(--color-text-secondary);
}

.browser-loading,
.browser-error,
.browser-empty {
  padding: 12px;
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
}

.browser-error {
  color: var(--color-error, #f87171);
}

.browser-select {
  padding: 8px 12px;
  margin: 8px;
  background: var(--color-accent-dim, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.browser-select:hover {
  opacity: 0.85;
}
</style>
