<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useSession } from "../composables/useSession";
import { useExploreAgent } from "../agents/ExploreAgent";
import { useSidebarPanels } from "../composables/useSidebarPanels";
import { useAgentBlocks } from "../composables/useAgentBlocks";
import AgentLayout from "../components/AgentLayout.vue";
import AgentHeader from "../components/AgentHeader.vue";
import AgentInput, { type PendingImage } from "../components/AgentInput.vue";
import AgentBlockUser from "../components/AgentBlockUser.vue";
import AgentBlockText from "../components/AgentBlockText.vue";
import AgentBlockError from "../components/AgentBlockError.vue";
import AgentBlockThinking from "../components/AgentBlockThinking.vue";
import AgentBlockTool from "../components/AgentBlockTool.vue";
import AgentBlockExploreRound from "../components/AgentBlockExploreRound.vue";
import AgentBlockAskUser from "../components/AgentBlockAskUser.vue";
import ChangeChatPanel from "../panels/ChangeChatPanel.vue";

const props = defineProps<{ sessionId: string }>();

const { currentSession, sessions, goBack, updateSessionTitle } = useSession();

const sessionTitle = computed(() => currentSession.value?.title || "");
const sessionWorkDir = computed(() => currentSession.value?.work_dir || "");

async function handleUpdateTitle(newTitle: string) {
  await updateSessionTitle(props.sessionId, newTitle);
}

// Sidebar
const { activePanelId, registerPanel } = useSidebarPanels();
registerPanel({ id: "changes", icon: "changes", title: "需求", order: 1 });

// Agent blocks composable (forward-declared, wired after exploreAgent init)
const blocksComposable = {} as ReturnType<typeof useAgentBlocks>;

const changesPanelRefreshKey = ref(0);

// Explore agent
const exploreAgent = useExploreAgent({
  sessionId: props.sessionId,
  metadata: currentSession.value?.metadata || null,
  workDir: currentSession.value?.work_dir || "",
  onBlock: (block) => blocksComposable.onBlock(block),
  onStreaming: (v) => blocksComposable.onStreaming(v),
  onComplete: () => { changesPanelRefreshKey.value++; },
});

// Initialize blocks composable
Object.assign(blocksComposable, useAgentBlocks(props.sessionId, exploreAgent));

const { blocks, isStreaming, messagesEl, selectOption, submitAskUser, loadHistory } = blocksComposable;

const input = ref("");
const pendingImages = ref<PendingImage[]>([]);

function handleImagesChange(images: PendingImage[]) {
  pendingImages.value = images;
}

const starters = [
  "从代码库现状开始，帮我找出这个需求还缺哪些关键信息。",
  "先用选项问题确认用户目标、范围边界和验收标准。",
  "按快速探索模式推进，只确认能进入 Spec 和 Task 的最小信息。",
];

const isEmpty = computed(() => blocks.value.length === 0 && !isStreaming.value);

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
  isStreaming.value = false;
}

// Load session on mount
onMounted(async () => {
  const s = sessions.value.find(s => s.id === props.sessionId);
  if (s) {
    (currentSession as any).value = s;
  }
  await loadHistory();
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
          <AgentBlockUser v-if="block.kind === 'user'" :content="block.content" />
          <AgentBlockText v-else-if="block.kind === 'text'" :content="block.content" />
          <AgentBlockError v-else-if="block.kind === 'error'" :content="block.content" />
          <AgentBlockThinking v-else-if="block.kind === 'thinking'" :content="block.content" />
          <AgentBlockTool v-else-if="block.kind === 'tool'" :tool="block.tool" />
          <AgentBlockExploreRound v-else-if="block.kind === 'explore_round'" :block="block" />
          <AgentBlockAskUser
            v-else-if="block.kind === 'ask_user'"
            :block="block"
            :is-streaming="isStreaming"
            @select-option="(qIdx, opt) => selectOption(block, qIdx, opt)"
            @submit="() => submitAskUser(block)"
          />
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

.streaming-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); animation: pulse 1s infinite; }
.scroll-spacer { height: 40px; }

.agent-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 24px; }
.agent-empty-panel { width: min(720px, 100%); }
.agent-empty-title { font-size: 18px; font-weight: 650; color: var(--color-text-primary); margin-bottom: 6px; }
.agent-empty-copy { font-size: 13px; color: var(--color-text-muted); margin-bottom: 16px; }
.agent-starters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.agent-starter { min-height: 76px; padding: 11px 12px; border-radius: 7px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); color: var(--color-text-secondary); font-size: 12px; line-height: 1.45; text-align: left; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.agent-starter:hover { background: var(--color-surface-2); border-color: var(--color-accent); color: var(--color-text-primary); }

@media (max-width: 760px) { .agent-starters { grid-template-columns: 1fr; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
