<script setup lang="ts">
import type { Block } from "../agents/ExploreAgent/types";
import AskUserCard from "./chat/AskUserCard.vue";
import { watch } from "vue";

type AskUserBlock = Extract<Block, { kind: "ask_user" }>;

const props = defineProps<{ block: AskUserBlock; isStreaming: boolean }>();
const emit = defineEmits<{
  "select-option": [qIdx: number, opt: string];
  "submit": [];
}>();

function handleSelectOption(qIdx: number, opt: string) {
  emit("select-option", qIdx, opt);
}

watch(() => props.block, () => {
    console.log('props.block', props.block);
}, { immediate: true });

function handleStartCustom(qIdx: number) {
  const q = props.block.questions[qIdx];
  q.customMode = true;
  q.selected = undefined;
}

function handleUpdateActiveTab(tab: number) {
  props.block.activeTab = tab;
}
</script>

<template>
  <AskUserCard
    :tool-use-id="block.toolUseId"
    :questions="block.questions"
    :answered="block.answered"
    :active-tab="block.activeTab"
    :is-streaming="isStreaming"
    @select-option="handleSelectOption"
    @start-custom="handleStartCustom"
    @submit="emit('submit')"
    @update:active-tab="handleUpdateActiveTab"
  />
</template>
