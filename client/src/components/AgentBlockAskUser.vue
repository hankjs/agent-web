<script setup lang="ts">
import type { Block } from "../agents/ExploreAgent/types";

type AskUserBlock = Extract<Block, { kind: "ask_user" }>;

const props = defineProps<{ block: AskUserBlock; isStreaming: boolean }>();
const emit = defineEmits<{
  "select-option": [qIdx: number, opt: string];
  "submit": [];
}>();
</script>

<template>
  <div class="ask-card">
    <div v-for="(q, qIdx) in block.questions" :key="qIdx" class="ask-question">
      <div class="ask-header">{{ q.header }}</div>
      <div class="ask-body">{{ q.question }}</div>
      <div class="ask-options">
        <button
          v-for="opt in q.options"
          :key="opt"
          class="ask-option"
          :class="{ selected: q.selected === opt }"
          :disabled="block.answered"
          @click="emit('select-option', qIdx, opt)"
        >{{ opt }}</button>
        <button
          class="ask-option ask-option-custom"
          :class="{ selected: q.customMode }"
          :disabled="block.answered"
          @click="q.customMode = !q.customMode; if (q.customMode) q.selected = undefined"
        >自定义</button>
      </div>
      <textarea
        v-if="q.customMode && !block.answered"
        v-model="q.customAnswer"
        class="ask-custom-input"
        rows="2"
        placeholder="输入自定义回答..."
      ></textarea>
    </div>
    <div class="ask-footer">
      <div v-if="block.answered" class="ask-answered">已提交</div>
      <button
        v-else
        class="ask-submit"
        :disabled="isStreaming || !block.questions.every(q => q.customMode ? q.customAnswer?.trim() : q.selected)"
        @click="emit('submit')"
      >提交</button>
    </div>
  </div>
</template>

<style scoped>
.ask-card { padding: 16px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); }
.ask-question { margin-bottom: 12px; }
.ask-header { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 4px; }
.ask-body { font-size: 14px; color: var(--color-text-primary); margin-bottom: 8px; }
.ask-options { display: flex; flex-wrap: wrap; gap: 6px; }
.ask-option { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-2); color: var(--color-text-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.ask-option:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-text-primary); }
.ask-option.selected { border-color: var(--color-accent); background: var(--color-accent-surface); color: var(--color-text-primary); }
.ask-option:disabled { opacity: 0.5; cursor: default; }
.ask-custom-input { width: 100%; margin-top: 8px; padding: 8px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-2); color: var(--color-text-primary); font-size: 13px; resize: vertical; }
.ask-footer { margin-top: 12px; display: flex; justify-content: flex-end; }
.ask-submit { padding: 6px 16px; border-radius: 6px; border: none; background: var(--color-accent); color: var(--color-surface-0); font-size: 13px; font-weight: 500; cursor: pointer; }
.ask-submit:disabled { opacity: 0.4; cursor: default; }
.ask-answered { font-size: 12px; color: var(--color-text-muted); }
</style>
