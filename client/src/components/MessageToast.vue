<script setup lang="ts">
import { useMessage } from "../composables/useMessage";

const { messages } = useMessage();
</script>

<template>
  <Teleport to="body">
    <div class="message-container">
      <TransitionGroup name="message">
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message-item"
          :class="msg.type"
        >
          {{ msg.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.message-container {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.message-item {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
  border: 1px solid var(--color-border-subtle);
  pointer-events: auto;
}
.message-item.info {
  background: var(--color-surface-2);
  color: var(--color-text-primary);
}
.message-item.success {
  background: var(--color-success);
  color: #fff;
}
.message-item.warning {
  background: var(--color-accent);
  color: #fff;
}
.message-item.error {
  background: var(--color-error);
  color: #fff;
}
.message-enter-active,
.message-leave-active {
  transition: all 0.3s ease;
}
.message-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.message-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
