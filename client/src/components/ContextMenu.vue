<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import type { ContextMenuItem } from "../composables/useContextMenu";

const props = defineProps<{
  visible: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const menuEl = ref<HTMLElement | null>(null);
const focusedIndex = ref(-1);
const adjustedPosition = ref({ x: 0, y: 0 });

// Reposition menu to stay within viewport
function adjustPosition() {
  if (!menuEl.value) return;
  const rect = menuEl.value.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = props.position.x;
  let y = props.position.y;

  if (x + rect.width > vw - 8) x = vw - rect.width - 8;
  if (y + rect.height > vh - 8) y = vh - rect.height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  adjustedPosition.value = { x, y };
}

watch(() => props.visible, async (val) => {
  if (val) {
    focusedIndex.value = -1;
    await nextTick();
    adjustPosition();
    menuEl.value?.focus();
  }
});

function selectItem(item: ContextMenuItem) {
  if (item.disabled) return;
  emit("close");
  item.action();
}

function getSelectableIndices(): number[] {
  return props.items
    .map((item, i) => (!item.separator && !item.disabled ? i : -1))
    .filter(i => i !== -1);
}

function handleKeydown(e: KeyboardEvent) {
  const selectable = getSelectableIndices();
  if (!selectable.length) return;

  if (e.key === "ArrowDown" || e.key === "j") {
    e.preventDefault();
    const currentPos = selectable.indexOf(focusedIndex.value);
    focusedIndex.value = selectable[(currentPos + 1) % selectable.length];
  } else if (e.key === "ArrowUp" || e.key === "k") {
    e.preventDefault();
    const currentPos = selectable.indexOf(focusedIndex.value);
    focusedIndex.value = selectable[(currentPos - 1 + selectable.length) % selectable.length];
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (focusedIndex.value >= 0) {
      selectItem(props.items[focusedIndex.value]);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (props.visible && e.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu-backdrop"
      @mousedown.self="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        ref="menuEl"
        class="context-menu"
        :style="{ left: adjustedPosition.x + 'px', top: adjustedPosition.y + 'px' }"
        role="menu"
        @keydown="handleKeydown"
      >
        <template v-for="(item, index) in items" :key="index">
          <div v-if="item.separator" class="context-menu-separator" role="separator" />
          <button
            v-else
            class="context-menu-item"
            :class="{
              destructive: item.destructive,
              disabled: item.disabled,
              focused: focusedIndex === index,
            }"
            role="menuitem"
            :tabindex="focusedIndex === index ? 0 : -1"
            :disabled="item.disabled"
            @click="selectItem(item)"
            @mouseenter="focusedIndex = index"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.context-menu {
  position: fixed;
  min-width: 160px;
  max-width: 240px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-1) 0;
  opacity: 0;
  transform: translateY(-4px);
  animation: context-menu-in var(--duration-fast) var(--ease-out-expo) forwards;
}

@keyframes context-menu-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  outline: none;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.context-menu-item:hover,
.context-menu-item.focused {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.context-menu-item.destructive {
  color: var(--color-error);
}

.context-menu-item.destructive:hover,
.context-menu-item.destructive.focused {
  background: var(--color-error-surface);
  color: var(--color-error);
}

.context-menu-item.disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.context-menu-item.disabled:hover,
.context-menu-item.disabled.focused {
  background: none;
  color: var(--color-text-muted);
}

.context-menu-separator {
  height: 1px;
  background: var(--color-border-subtle);
  margin: var(--space-1) 0;
}

@media (prefers-reduced-motion: reduce) {
  .context-menu {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
