<script setup lang="ts">
import { computed } from "vue";
import { useMessageTree, type TreeNode } from "../composables/useMessageTree";

const props = defineProps<{
  sessionId: string;
}>();

const { tree, activeLeafId, getActivePath, findLeafFromNode, switchBranch, requestScrollTo } = useMessageTree();

const activePath = computed(() => getActivePath(activeLeafId.value));

interface FlatNode {
  node: TreeNode;
  depth: number;
}

/** Flatten tree into a list, only user nodes with non-empty preview */
const flatNodes = computed<FlatNode[]>(() => {
  const result: FlatNode[] = [];
  function walk(nodes: TreeNode[], depth: number) {
    for (const node of nodes) {
      if (node.role === "user" && node.preview) {
        result.push({ node, depth });
      }
      if (node.children && node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(tree.value, 0);
  return result;
});

/** Check if a node is a branch point (has siblings) */
function isBranchPoint(node: TreeNode): boolean {
  const siblings = flatNodes.value.filter(
    (item) => item.node.parent_id === node.parent_id
  );
  return siblings.length > 1;
}

function handleNodeClick(node: TreeNode) {
  const isOnCurrentBranch = activePath.value.has(node.id);
  if (isOnCurrentBranch) {
    // Already on this branch, just scroll to it
    requestScrollTo(node.id);
  } else {
    // Switch branch then scroll
    const leafId = findLeafFromNode(node.id);
    switchBranch(props.sessionId, leafId);
    requestScrollTo(node.id);
  }
}

function nodeLabel(node: TreeNode): string {
  if (node.role === "user") {
    return node.preview || "(empty)";
  }
  return node.preview || "(assistant)";
}

function isActive(nodeId: string): boolean {
  return activePath.value.has(nodeId);
}
</script>

<template>
  <div class="outline-panel">
    <div class="outline-header">
      <span class="outline-title">Outline</span>
    </div>
    <div class="outline-tree">
      <button
        v-for="item in flatNodes"
        :key="item.node.id"
        class="outline-node"
        :class="{
          active: isActive(item.node.id),
          'is-branch': isBranchPoint(item.node),
        }"
        @click="handleNodeClick(item.node)"
      >
        <span class="node-dot"></span>
        <span class="node-label">{{ nodeLabel(item.node) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-left: 1px solid var(--color-border-subtle);
  background: var(--color-surface-0, #1a1a1a);
  width: 240px;
  min-width: 200px;
  overflow: hidden;
}
.outline-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.outline-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.outline-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
}
.outline-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background 0.12s;
}
.outline-node:hover { background: var(--color-surface-1); }
.outline-node.active { background: color-mix(in srgb, var(--color-accent, #3b82f6) 12%, transparent); }
.outline-node.active .node-label { color: var(--color-text-primary); }
.node-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-primary);
}
.is-branch .node-dot { background: var(--color-accent, #3b82f6); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent, #3b82f6) 25%, transparent); }
.node-label {
  font-size: 12px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
