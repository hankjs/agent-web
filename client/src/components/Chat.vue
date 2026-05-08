<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from "vue";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { id: string; name: string; result?: string; isError?: boolean }[];
}

const messages = ref<ChatMessage[]>([]);
const input = ref("");
const isConnected = ref(false);
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

let ws: WebSocket | null = null;
const serverUrl = "ws://localhost:3000/ws";

async function connect() {
  // Get token first
  const res = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const { token } = await res.json();

  ws = new WebSocket(`${serverUrl}?token=${token}`);
  ws.onopen = () => {
    isConnected.value = true;
  };
  ws.onclose = () => {
    isConnected.value = false;
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerEvent(data);
  };
}

function handleServerEvent(event: any) {
  const last = messages.value[messages.value.length - 1];

  switch (event.type) {
    case "text_delta":
      if (last && last.role === "assistant") {
        last.content += event.text;
      } else {
        messages.value.push({ role: "assistant", content: event.text });
      }
      break;
    case "tool_start":
      if (last && last.role === "assistant") {
        if (!last.toolCalls) last.toolCalls = [];
        last.toolCalls.push({ id: event.id, name: event.name });
      }
      break;
    case "tool_result":
      if (last && last.toolCalls) {
        const tc = last.toolCalls.find((t) => t.id === event.id);
        if (tc) {
          tc.result = event.content;
          tc.isError = event.is_error;
        }
      }
      break;
    case "turn_complete":
      isStreaming.value = false;
      break;
    case "error":
      messages.value.push({ role: "assistant", content: `Error: ${event.message}` });
      isStreaming.value = false;
      break;
  }

  nextTick(() => {
    messagesEl.value?.scrollTo(0, messagesEl.value.scrollHeight);
  });
}

function send() {
  if (!input.value.trim() || !ws || !isConnected.value) return;

  const content = input.value.trim();
  messages.value.push({ role: "user", content });
  input.value = "";
  isStreaming.value = true;

  ws.send(
    JSON.stringify({
      type: "send_message",
      content,
      session_id: "default",
    })
  );
}

onMounted(() => {
  connect();
});

onUnmounted(() => {
  ws?.close();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Messages -->
    <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-for="(msg, i) in messages" :key="i" class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
        <div class="max-w-[80%] rounded-lg px-4 py-2" :class="msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'">
          <pre class="whitespace-pre-wrap text-sm font-sans">{{ msg.content }}</pre>
          <div v-if="msg.toolCalls" class="mt-2 space-y-1">
            <div v-for="tc in msg.toolCalls" :key="tc.id" class="text-xs bg-gray-800 rounded p-2">
              <div class="text-yellow-400 font-mono">{{ tc.name }}</div>
              <pre v-if="tc.result" class="mt-1 text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{{ tc.result }}</pre>
            </div>
          </div>
        </div>
      </div>
      <div v-if="isStreaming" class="text-gray-400 text-sm">Thinking...</div>
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
