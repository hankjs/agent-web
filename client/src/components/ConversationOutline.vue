<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useMessageTree } from "../composables/useMessageTree";
import { useCanvasTree } from "../composables/useCanvasTree";

const props = defineProps<{
  sessionId: string;
}>();

const { tree, activeLeafId, getActivePath, findLeafFromNode, switchBranch, requestScrollTo } = useMessageTree();

const activePath = computed(() => getActivePath(activeLeafId.value));

const canvasRef = ref<HTMLCanvasElement | null>(null);

function handleNodeClick(node: { id: string }) {
  const isOnCurrentBranch = activePath.value.has(node.id);
  if (isOnCurrentBranch) {
    requestScrollTo(node.id);
  } else {
    const leafId = findLeafFromNode(node.id);
    switchBranch(props.sessionId, leafId);
    requestScrollTo(node.id);
  }
}

const { setup, teardown, render, focusOnNode } = useCanvasTree(
  canvasRef,
  tree,
  activePath,
  handleNodeClick,
);

onMounted(() => {
  setup();
  observeResize();
});

onBeforeUnmount(() => {
  teardown();
  if (resizeObserver) resizeObserver.disconnect();
});

// Auto-focus on active leaf when it changes
watch(activeLeafId, (id) => {
  if (id) focusOnNode(id);
});

// Handle resize
let resizeObserver: ResizeObserver | null = null;
function observeResize() {
  if (!canvasRef.value) return;
  resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvasRef.value);
}
</script>

<template>
  <div class="outline-panel">
    <div class="outline-canvas-wrap">
      <canvas ref="canvasRef" class="outline-canvas"></canvas>
    </div>
  </div>
</template>

<style scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface-0, #1a1a1a);
  width: 100%;
  overflow: hidden;
}
.outline-canvas-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
}
.outline-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
.outline-canvas:active {
  cursor: grabbing;
}
</style>
