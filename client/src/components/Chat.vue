<script setup lang="ts">
import { ref, nextTick, onMounted } from "vue";

interface ToolCall {
  id: string;
  name: string;
  input?: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  expanded: boolean;
}

type Block =
  | { kind: "user"; content: string }
  | { kind: "text"; content: string }
  | { kind: "tool"; tool: ToolCall };

interface ToastItem {
  id: number;
  message: string;
}

const blocks = ref<Block[]>([]);
const input = ref("");
const isConnected = ref(false);
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);
const toasts = ref<ToastItem[]>([]);
let toastId = 0;
const sessionId = ref(crypto.randomUUID());
const token = ref("");
const allExpanded = ref(false);

const API_BASE = "http://localhost:3000";

function showError(message: string) {
  const id = ++toastId;
  toasts.value.push({ id, message });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 5000);
}

function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
// PART2_PLACEHOLDER

function toggleAll() {
  allExpanded.value = !allExpanded.value;
  for (const b of blocks.value) {
    if (b.kind === "tool") b.tool.expanded = allExpanded.value;
  }
}

function toggleToolCall(tc: ToolCall) {
  tc.expanded = !tc.expanded;
}

function toolSummary(tc: ToolCall): string {
  if (!tc.input) return "";
  try {
    const parsed = JSON.parse(tc.input);
    if (parsed.command) return parsed.command;
    return tc.input;
  } catch {
    return tc.input;
  }
}

function previewLines(text: string): string {
  return text.split("\n").slice(0, 3).join("\n");
}

function hasMoreLines(text: string): boolean {
  return text.split("\n").length > 3;
}

async function connect() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      showError(`Authentication failed: ${res.status}`);
      return;
    }
    const data = await res.json();
    token.value = data.token;
    isConnected.value = true;
  } catch (e: any) {
    showError(`Connection failed: ${e.message || e}`);
  }
}

function handleServerEvent(event: any) {
  switch (event.type) {
    case "text_delta": {
      const last = blocks.value[blocks.value.length - 1];
      if (last && last.kind === "text") {
        last.content += event.text;
      } else {
        blocks.value.push({ kind: "text", content: event.text });
      }
      break;
    }
    case "tool_start": {
      blocks.value.push({
        kind: "tool",
        tool: {
          id: event.id,
          name: event.name,
          input: event.input,
          isRunning: true,
          expanded: allExpanded.value,
        },
      });
      break;
    }
    case "tool_result": {
      for (let i = blocks.value.length - 1; i >= 0; i--) {
        const b = blocks.value[i];
        if (b.kind === "tool" && b.tool.id === event.id) {
          b.tool.result = event.content;
          b.tool.isError = event.is_error;
          b.tool.isRunning = false;
          break;
        }
      }
      break;
    }
    case "turn_complete":
      isStreaming.value = false;
      break;
    case "error":
      showError(event.message);
      isStreaming.value = false;
      break;
  }

  nextTick(() => {
    messagesEl.value?.scrollTo(0, messagesEl.value.scrollHeight);
  });
}
// PART3_PLACEHOLDER

async function send() {
  if (!input.value.trim() || !isConnected.value || isStreaming.value) return;

  const content = input.value.trim();
  blocks.value.push({ kind: "user", content });
  input.value = "";
  isStreaming.value = true;

  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${sessionId.value}/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.value}`,
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!res.ok) {
      showError(`Chat request failed: ${res.status}`);
      isStreaming.value = false;
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json) {
            try { handleServerEvent(JSON.parse(json)); } catch {}
          }
        }
      }
    }

    if (buffer.startsWith("data: ")) {
      const json = buffer.slice(6);
      if (json) {
        try { handleServerEvent(JSON.parse(json)); } catch {}
      }
    }
  } catch (e: any) {
    showError(`Request failed: ${e.message || e}`);
    isStreaming.value = false;
  }
}

onMounted(() => {
  connect();
});
</script>

<template>
  <div class="flex flex-col h-full relative">
    <!-- Toast notifications -->
    <div class="absolute top-4 right-4 z-50 space-y-2">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="flex items-start gap-2 max-w-sm bg-red-900/90 border border-red-700 text-red-100 rounded-lg px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in"
      >
        <span class="text-sm flex-1">{{ toast.message }}</span>
        <button @click="dismissToast(toast.id)" class="text-red-300 hover:text-white text-lg leading-none">&times;</button>
      </div>
    </div>

    <!-- Expand/Collapse toggle -->
    <div class="flex justify-end px-4 pt-2">
      <button @click="toggleAll" class="text-xs text-gray-400 hover:text-gray-200 transition-colors">
        {{ allExpanded ? "Collapse All" : "Expand All" }}
      </button>
    </div>

    <!-- Blocks -->
    <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-3">
      <template v-for="(block, i) in blocks" :key="i">
        <!-- User message -->
        <div v-if="block.kind === 'user'" class="flex justify-end">
          <div class="max-w-[80%] rounded-lg px-4 py-2 bg-blue-600">
            <pre class="whitespace-pre-wrap text-sm font-sans">{{ block.content }}</pre>
          </div>
        </div>

        <!-- Assistant text -->
        <div v-else-if="block.kind === 'text'" class="flex justify-start">
          <div class="max-w-[85%] rounded-lg px-4 py-2 bg-gray-700">
            <pre class="whitespace-pre-wrap text-sm font-sans">{{ block.content }}</pre>
          </div>
        </div>

        <!-- Tool call -->
        <div v-else-if="block.kind === 'tool'" class="ml-2">
          <div class="border border-gray-600 rounded overflow-hidden">
            <!-- Header -->
            <div
              @click="toggleToolCall(block.tool)"
              class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-600/50 transition-colors"
              :class="block.tool.isRunning ? 'bg-gray-800' : block.tool.isError ? 'bg-red-900/30' : 'bg-gray-800'"
            >
              <span class="text-xs text-gray-500 select-none">{{ block.tool.expanded ? '▼' : '▶' }}</span>
              <span v-if="block.tool.isRunning" class="animate-spin text-xs">⟳</span>
              <span v-else-if="block.tool.isError" class="text-red-400 text-xs">✗</span>
              <span v-else class="text-green-400 text-xs">✓</span>
              <span class="text-yellow-400 text-xs font-mono">{{ block.tool.name }}</span>
              <span class="text-gray-400 text-xs font-mono truncate flex-1">{{ toolSummary(block.tool) }}</span>
              <span v-if="block.tool.isRunning" class="text-gray-500 text-xs shrink-0">running...</span>
            </div>
            <!-- Preview (collapsed: 3 lines) -->
            <div v-if="!block.tool.expanded && block.tool.result" class="px-3 py-1.5 bg-gray-900/50 border-t border-gray-600">
              <pre class="text-xs whitespace-pre-wrap" :class="block.tool.isError ? 'text-red-300' : 'text-gray-300'">{{ previewLines(block.tool.result) }}</pre>
              <div v-if="hasMoreLines(block.tool.result)" class="text-xs text-gray-500 mt-0.5">... click to expand</div>
            </div>
            <!-- Full (expanded) -->
            <div v-if="block.tool.expanded" class="border-t border-gray-600 px-3 py-2 bg-gray-900/50">
              <div v-if="block.tool.input" class="mb-2">
                <div class="text-xs text-gray-500 mb-0.5">Input</div>
                <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto">{{ block.tool.input }}</pre>
              </div>
              <div v-if="block.tool.result">
                <div class="text-xs text-gray-500 mb-0.5">Output</div>
                <pre class="text-xs whitespace-pre-wrap max-h-48 overflow-y-auto" :class="block.tool.isError ? 'text-red-300' : 'text-gray-300'">{{ block.tool.result }}</pre>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-if="isStreaming && !blocks.length" class="text-gray-400 text-sm">Thinking...</div>
    </div>

    <!-- Input -->
    <div class="border-t border-gray-700 p-4">
      <div class="flex gap-2">
        <input
          v-model="input"
          @keydown.enter="send"
          :disabled="!isConnected || isStreaming"
          placeholder="Type a message..."
          class="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          @click="send"
          :disabled="!isConnected || isStreaming || !input.trim()"
          class="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-500 transition-colors"
        >
          Send
        </button>
      </div>
      <div class="mt-2 text-xs" :class="isConnected ? 'text-green-400' : 'text-red-400'">
        {{ isConnected ? "Connected" : "Disconnected" }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-slide-in {
  animation: slide-in 0.3s ease-out;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateX(1rem); }
  to { opacity: 1; transform: translateX(0); }
}
.animate-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
