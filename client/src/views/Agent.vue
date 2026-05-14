<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useSession, authFetch } from "../composables/useSession";
import { useExploreAgent, type ExplorePhase } from "../agents/ExploreAgent";
import { useSidebarPanels } from "../composables/useSidebarPanels";
import AgentLayout from "../components/AgentLayout.vue";
import AgentHeader from "../components/AgentHeader.vue";
import AgentInput, { type PendingImage } from "../components/AgentInput.vue";
import ChangeChatPanel from "../panels/ChangeChatPanel.vue";

const props = defineProps<{ sessionId: string }>();

const { currentSession, sessions, goBack, updateSessionTitle, updateSessionWorkDir } = useSession();

const sessionTitle = computed(() => currentSession.value?.title || "");
const sessionWorkDir = computed(() => currentSession.value?.work_dir || "");

async function handleUpdateTitle(newTitle: string) {
  await updateSessionTitle(props.sessionId, newTitle);
}

// Sidebar
const { activePanelId, registerPanel, reset: resetPanels } = useSidebarPanels();
registerPanel({ id: "changes", icon: "changes", title: "需求", order: 1 });

// Block types
type AskUserQuestion = { header: string; question: string; options: string[]; selected?: string; customMode?: boolean; customAnswer?: string };
type Block =
  | { kind: "user"; content: string }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: { id: string; name: string; input?: string; result?: string; isError?: boolean; isRunning: boolean; expanded: boolean } }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

const blocks = ref<Block[]>([]);
const input = ref("");
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);
const changesPanelRefreshKey = ref(0);
const pendingImages = ref<PendingImage[]>([]);

function handleImagesChange(images: PendingImage[]) {
  pendingImages.value = images;
}

// Explore agent
const exploreAgent = useExploreAgent({
  sessionId: props.sessionId,
  metadata: currentSession.value?.metadata || null,
  workDir: currentSession.value?.work_dir || "",
  onBlock: (block: Block) => { blocks.value.push(block); nextTick(scrollToBottom); },
  onStreaming: (v: boolean) => { isStreaming.value = v; },
  onComplete: () => { changesPanelRefreshKey.value++; },
});

const starters = [
  "从代码库现状开始，帮我找出这个需求还缺哪些关键信息。",
  "先用选项问题确认用户目标、范围边界和验收标准。",
  "按快速探索模式推进，只确认能进入 Spec 和 Task 的最小信息。",
];

const isEmpty = computed(() => blocks.value.length === 0 && !isStreaming.value);

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

async function send() {
  if (!input.value.trim() && pendingImages.value.length === 0) return;
  if (isStreaming.value) return;
  const content = input.value.trim();
  const images = pendingImages.value.length > 0
    ? pendingImages.value.map(img => ({ media_type: img.media_type, data: img.data }))
    : undefined;
  input.value = "";
  pendingImages.value = [];
  await exploreAgent.handleUserInput(content, images);
}

function stop() {
  // Explore agent doesn't have a cancel mechanism yet — just mark not streaming
  isStreaming.value = false;
}

function selectOption(block: Extract<Block, { kind: "ask_user" }>, qIdx: number, opt: string) {
  if (block.answered || isStreaming.value) return;
  const q = block.questions[qIdx];
  q.selected = opt;
  q.customMode = false;
}

async function submitAskUser(block: Extract<Block, { kind: "ask_user" }>) {
  if (block.answered) return;
  block.answered = true;
  const answers = block.questions.map(q => q.customMode ? (q.customAnswer || "") : (q.selected || "")).join("; ");
  exploreAgent.resume();
  await exploreAgent.handleUserInput(answers);
}

// Load session on mount
onMounted(() => {
  if (!currentSession.value) {
    const s = sessions.value.find(s => s.id === props.sessionId);
    if (s) {
      // Set current session from list
      (currentSession as any).value = s;
    }
  }
});

// Watch session changes to update agent options
watch(() => currentSession.value, (s) => {
  if (s) {
    // Agent options are set at creation time, but we can update title display
  }
});
</script>

<template>
  <AgentLayout :active-panel-id="activePanelId">
    <template #header>
      <AgentHeader
        :title="sessionTitle || 'Explore'"
        :work-dir="sessionWorkDir"
        @back="goBack"
        @update:title="handleUpdateTitle"
      >
        <template #badges>
          <template v-if="currentSession?.metadata">
            <span class="explore-chip">{{ currentSession.metadata.depth === 'quick' ? '快速' : currentSession.metadata.depth === 'deep' ? '深入' : '标准' }}</span>
            <span class="explore-chip">{{ currentSession.metadata.questionStyle === 'open' ? '开放追问' : '选项优先' }}</span>
            <span class="explore-chip" v-if="currentSession.metadata.focusAreas?.length">{{ currentSession.metadata.focusAreas.join('、') }}</span>
          </template>
        </template>
      </AgentHeader>
    </template>

    <!-- Messages area -->
    <div v-if="blocks.length > 0 || isStreaming" ref="messagesEl" class="agent-messages">
      <div class="agent-messages-inner">
        <template v-for="(block, idx) in blocks" :key="idx">
          <div v-if="block.kind === 'user'" class="user-block">
            <pre class="whitespace-pre-wrap text-[13px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ block.content }}</pre>
          </div>
          <div v-else-if="block.kind === 'text'" class="agent-block">
            <div class="markdown-body" v-html="renderMarkdown(block.content)"></div>
          </div>
          <div v-else-if="block.kind === 'error'" class="error-block">{{ block.content }}</div>
          <div v-else-if="block.kind === 'tool'" class="tool-block" @click="block.tool.expanded = !block.tool.expanded">
            <div class="tool-header">
              <span class="tool-indicator" :class="{ running: block.tool.isRunning, error: block.tool.isError }"></span>
              <span class="tool-name">{{ block.tool.name }}</span>
              <span v-if="block.tool.isRunning" class="tool-running">运行中...</span>
            </div>
            <div v-if="block.tool.expanded" class="tool-detail">
              <pre v-if="block.tool.input" class="tool-input">{{ block.tool.input }}</pre>
              <pre v-if="block.tool.result" class="tool-result" :class="{ 'tool-error': block.tool.isError }">{{ block.tool.result?.slice(0, 500) }}</pre>
            </div>
          </div>
          <div v-else-if="block.kind === 'ask_user'" class="ask-card">
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
                  @click="selectOption(block, qIdx, opt)"
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
                @click="submitAskUser(block)"
              >提交</button>
            </div>
          </div>
        </template>
        <div v-if="isStreaming && blocks.length === 0" class="streaming-dot"></div>
        <div class="scroll-spacer"></div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="agent-empty">
      <div class="agent-empty-panel">
        <div class="agent-empty-title">Explore -> Spec -> Task</div>
        <div class="agent-empty-copy">选择一个起手式，或直接描述你想构建的能力。</div>
        <div class="agent-starters">
          <button v-for="s in starters" :key="s" class="agent-starter" @click="input = s">{{ s }}</button>
        </div>
      </div>
    </div>

    <template #input>
      <AgentInput
        v-model="input"
        :is-streaming="isStreaming"
        :is-connected="true"
        :is-empty="isEmpty"
        placeholder="描述需求，或让模型先阅读代码并追问..."
        :show-image-upload="true"
        @send="send"
        @stop="stop"
        @images-change="handleImagesChange"
      />
    </template>

    <!-- Panel content teleported to AppShell right panel -->
    <Teleport to="#shell-panel-content" v-if="activePanelId">
      <ChangeChatPanel v-if="activePanelId === 'changes'" :session-id="sessionId" :work-dir="currentSession?.work_dir || ''" :key="changesPanelRefreshKey" />
    </Teleport>
  </AgentLayout>
</template>

<style scoped>
.explore-chip { padding: 2px 8px; border-radius: var(--radius-sm); background: var(--color-env-local-bg); font-size: 11px; color: var(--color-env-local); }

.agent-messages { flex: 1; overflow-y: auto; }
.agent-messages-inner { max-width: 720px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }

.user-block { padding: 12px 16px; border-radius: 8px; background: var(--color-surface-1); }
.agent-block { padding: 4px 0; }
.error-block { padding: 8px 12px; border-radius: 6px; background: var(--color-error-surface); color: var(--color-error); font-size: 13px; }

.tool-block { padding: 6px 10px; border-radius: 6px; background: var(--color-surface-1); cursor: pointer; font-size: 12px; }
.tool-header { display: flex; align-items: center; gap: 8px; }
.tool-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); }
.tool-indicator.running { background: var(--color-success); animation: pulse 1s infinite; }
.tool-indicator.error { background: var(--color-error); }
.tool-name { font-weight: 500; color: var(--color-text-secondary); }
.tool-running { color: var(--color-text-muted); font-size: 11px; }
.tool-detail { margin-top: 8px; }
.tool-input, .tool-result { font-size: 11px; padding: 6px 8px; border-radius: 4px; background: var(--color-surface-2); overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
.tool-result { margin-top: 4px; }
.tool-error { color: var(--color-error); }

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

.agent-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 24px; }
.agent-empty-panel { width: min(720px, 100%); }
.agent-empty-title { font-size: 18px; font-weight: 650; color: var(--color-text-primary); margin-bottom: 6px; }
.agent-empty-copy { font-size: 13px; color: var(--color-text-muted); margin-bottom: 16px; }
.agent-starters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.agent-starter { min-height: 76px; padding: 11px 12px; border-radius: 7px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); color: var(--color-text-secondary); font-size: 12px; line-height: 1.45; text-align: left; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.agent-starter:hover { background: var(--color-surface-2); border-color: var(--color-accent); color: var(--color-text-primary); }

.streaming-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); animation: pulse 1s infinite; }
.scroll-spacer { height: 40px; }

.markdown-body { font-size: 14px; line-height: 1.6; color: var(--color-text-primary); }
.markdown-body :deep(p) { margin: 0.5em 0; }
.markdown-body :deep(code) { padding: 2px 5px; border-radius: 3px; background: var(--color-surface-2); font-size: 0.9em; }
.markdown-body :deep(pre) { padding: 12px; border-radius: 6px; background: var(--color-surface-2); overflow-x: auto; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (max-width: 760px) { .agent-starters { grid-template-columns: 1fr; } }
</style>
