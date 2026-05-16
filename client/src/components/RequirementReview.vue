<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  documentName: string;
  content: string;
  confirmed: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  edit: [];
}>();

const sections = computed(() => {
  const lines = props.content.split("\n");
  const result: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) result.push(current);
      current = { title: line.slice(3), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) result.push(current);
  return result;
});
</script>

<template>
  <div class="requirement-review border border-blue-200 rounded-lg p-4 bg-blue-50/50">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-blue-900">需求文档确认</h3>
      <span class="text-xs text-blue-600">{{ documentName }}</span>
    </div>

    <div class="prose prose-sm max-w-none mb-4 max-h-96 overflow-y-auto bg-white rounded p-3 border border-blue-100">
      <div v-for="(section, i) in sections" :key="i" class="mb-3">
        <h4 class="text-sm font-semibold text-gray-800 mb-1">{{ section.title }}</h4>
        <div class="text-xs text-gray-600 whitespace-pre-wrap">{{ section.body.trim() || '待填充' }}</div>
      </div>
      <div v-if="sections.length === 0" class="text-xs text-gray-400 italic">文档内容为空</div>
    </div>

    <div v-if="!confirmed" class="flex gap-2">
      <button
        class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
        @click="emit('confirm')"
      >
        确认并生成任务
      </button>
      <button
        class="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50 transition-colors"
        @click="emit('edit')"
      >
        继续完善
      </button>
    </div>
    <div v-else class="text-xs text-green-600 font-medium">已确认，正在生成任务文档...</div>
  </div>
</template>
