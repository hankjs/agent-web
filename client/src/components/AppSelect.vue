<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

export interface SelectOption {
  value: string;
  label: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  options: SelectOption[];
  placeholder?: string;
}>(), {
  placeholder: "请选择",
});

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const dropdownEl = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => {
  const found = props.options.find(o => o.value === props.modelValue);
  return found ? found.label : props.placeholder;
});

const isPlaceholder = computed(() => !props.options.some(o => o.value === props.modelValue));

function toggle() {
  open.value = !open.value;
}

function select(value: string) {
  emit("update:modelValue", value);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (!triggerEl.value?.contains(e.target as Node) && !dropdownEl.value?.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("mousedown", onClickOutside));
onBeforeUnmount(() => document.removeEventListener("mousedown", onClickOutside));
</script>

<template>
  <div class="app-select" :class="{ open }">
    <button ref="triggerEl" type="button" class="app-select-trigger" @click="toggle">
      <span class="app-select-label" :class="{ placeholder: isPlaceholder }">{{ selectedLabel }}</span>
      <svg class="app-select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <Transition name="dropdown">
      <div v-if="open" ref="dropdownEl" class="app-select-dropdown">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="app-select-option"
          :class="{ active: opt.value === modelValue }"
          @click="select(opt.value)"
        >{{ opt.label }}</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  width: 100%;
  margin-bottom: 14px;
}

.app-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle, #333);
  background: var(--color-surface-1, #1a1a1a);
  color: var(--color-text-primary, #eee);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.app-select-trigger:hover,
.app-select.open .app-select-trigger {
  border-color: var(--color-accent, #3b82f6);
}

.app-select-label.placeholder {
  color: var(--color-text-muted, #888);
}

.app-select-chevron {
  color: var(--color-text-muted, #888);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}
.app-select.open .app-select-chevron {
  transform: rotate(180deg);
}

.app-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  padding: 4px;
  border-radius: 7px;
  border: 1px solid var(--color-border-subtle, #333);
  background: var(--color-surface-1, #1a1a1a);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.app-select-option {
  width: 100%;
  text-align: left;
  padding: 7px 8px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.app-select-option:hover {
  background: var(--color-surface-2, #252525);
  color: var(--color-text-primary, #eee);
}
.app-select-option.active {
  background: var(--color-surface-3, #333);
  color: var(--color-text-primary, #eee);
}

.dropdown-enter-active { transition: opacity 0.15s, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1); }
.dropdown-leave-active { transition: opacity 0.1s, transform 0.1s; }
.dropdown-enter-from,
.dropdown-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
