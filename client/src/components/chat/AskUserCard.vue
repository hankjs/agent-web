<script setup lang="ts">
import type { AskUserQuestion } from "../../types/chat";

export type AskOption = string | { label: string; description?: string };

export type AskQuestion = {
  header?: string;
  question: string;
  options: AskOption[];
  multiSelect?: boolean;
  selected?: string | string[];
  customMode?: boolean;
  customAnswer?: string;
};

const props = defineProps<{
  toolUseId?: string;
  questions: AskQuestion[];
  answered: boolean;
  activeTab: number;
  isStreaming: boolean;
}>();

const emit = defineEmits<{
  selectOption: [qIdx: number, answer: string];
  startCustom: [qIdx: number];
  submit: [];
  "update:activeTab": [tab: number];
}>();

function getOptionLabel(opt: AskOption): string {
  return typeof opt === "string" ? opt : opt.label;
}

function getOptionDescription(opt: AskOption): string | undefined {
  return typeof opt === "string" ? undefined : opt.description;
}

function isSelected(q: AskQuestion, opt: AskOption): boolean {
  const label = getOptionLabel(opt);
  if (q.multiSelect) {
    return Array.isArray(q.selected) && q.selected.includes(label);
  }
  return q.selected === label;
}

function isAnswered(q: AskQuestion): boolean {
  if (q.multiSelect) {
    return Array.isArray(q.selected) && q.selected.length > 0;
  }
  return !!(q.selected || (q.customMode && q.customAnswer?.trim()));
}
function canSubmit(): boolean {
  return props.questions.every(q => {
    if (q.customMode) return !!q.customAnswer?.trim();
    if (q.multiSelect) return Array.isArray(q.selected) && q.selected.length > 0;
    return !!q.selected;
  });
}
</script>

<template>
  <div class="ask-card">
    <div class="ask-card-tabs" v-if="questions.length > 1">
      <button
        v-for="(q, qi) in questions" :key="qi"
        class="ask-card-tab" :class="{ active: activeTab === qi }"
        type="button" @click="emit('update:activeTab', qi)"
      ><span class="ask-card-tab-dot" :class="{ answered: isAnswered(q) }"></span>{{ q.header || `问题 ${qi + 1}` }}</button>
    </div>
    <div class="ask-card-body">
      <div class="ask-card-question">{{ questions[activeTab].question }}</div>
      <div class="ask-card-options">
        <button
          v-for="(opt, oi) in questions[activeTab].options" :key="oi"
          type="button" class="ask-card-option"
          :class="{ selected: isSelected(questions[activeTab], opt) }"
          :disabled="answered || isStreaming"
          @click="emit('selectOption', activeTab, getOptionLabel(opt))"
        >{{ getOptionLabel(opt) }}<span v-if="getOptionDescription(opt)" class="ask-card-option-desc"> - {{ getOptionDescription(opt) }}</span></button>
        <div v-if="!answered" class="ask-card-custom">
          <input
            v-if="questions[activeTab].customMode"
            v-model="questions[activeTab].customAnswer"
            type="text" class="ask-card-custom-input"
            placeholder="输入自己的答案..."
            :disabled="isStreaming"
            @keydown.enter.prevent="emit('submit')"
            @keydown.escape="questions[activeTab].customMode = false"
          />
          <button v-else type="button" class="ask-card-option"
            :class="{ selected: questions[activeTab].customMode }"
            :disabled="isStreaming"
            @click="emit('startCustom', activeTab)"
          >自定义答案...</button>
        </div>
        <button
          v-if="answered && questions[activeTab].selected && !questions[activeTab].options.some(o => getOptionLabel(o) === (Array.isArray(questions[activeTab].selected) ? '' : questions[activeTab].selected))"
          type="button" class="ask-card-option selected" disabled
        >{{ questions[activeTab].selected }}</button>
      </div>
    </div>
    <div class="ask-card-footer">
      <div v-if="answered" class="ask-card-answered">已提交</div>
      <div v-else class="ask-card-spacer"></div>
      <button
        v-if="!answered" type="button" class="ask-card-submit"
        :disabled="isStreaming || !canSubmit()"
        @click="emit('submit')"
      >提交</button>
    </div>
  </div>
</template>

<style scoped>
.ask-card { margin: 10px 0; border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent); border-radius: 8px; background: var(--color-surface-1); overflow: hidden; }
.ask-card-tabs { display: flex; min-height: 38px; border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface-0); overflow-x: auto; }
.ask-card-tab { min-width: 96px; padding: 9px 14px; border: 0; border-right: 1px solid var(--color-border-subtle); background: transparent; color: var(--color-text-muted); font-size: 12px; font-weight: 600; cursor: default; white-space: nowrap; }
.ask-card-tab.active { color: var(--color-text-primary); background: color-mix(in oklch, var(--color-accent) 12%, var(--color-surface-1)); }
.ask-card-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); margin-right: 6px; vertical-align: middle; transition: background 0.2s; }
.ask-card-tab-dot.answered { background: var(--color-accent); }
.ask-card-body { padding: 14px 16px; }
.ask-card-question { color: var(--color-text-primary); font-size: 14px; font-weight: 600; line-height: 1.55; margin-bottom: 12px; }
.ask-card-options { display: flex; flex-direction: column; gap: 8px; }
.ask-card-option { width: 100%; min-height: 38px; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-0); color: var(--color-text-secondary); font-size: 13px; line-height: 1.45; text-align: left; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.ask-card-option:hover:not(:disabled) { color: var(--color-text-primary); border-color: var(--color-accent); background: var(--color-surface-2); }
.ask-card-option.selected { color: var(--color-text-primary); border-color: var(--color-accent); background: color-mix(in oklch, var(--color-accent) 16%, var(--color-surface-1)); }
.ask-card-option:disabled { cursor: default; opacity: 0.65; }
.ask-card-option-desc { font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; }
.ask-card-custom { min-height: 38px; }
.ask-card-custom-input { width: 100%; min-height: 38px; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--color-accent); background: var(--color-surface-0); color: var(--color-text-primary); font-size: 13px; outline: none; }
.ask-card-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); background: color-mix(in oklch, var(--color-surface-0) 75%, transparent); }
.ask-card-spacer { flex: 1; }
.ask-card-answered { flex: 1; min-width: 0; color: var(--color-text-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-card-submit { min-width: 82px; padding: 7px 16px; border: 1px solid var(--color-accent); border-radius: 6px; background: var(--color-accent); color: var(--color-surface-0); font-size: 13px; font-weight: 650; cursor: pointer; }
.ask-card-submit:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
