import { ref, readonly, computed } from "vue";
import { authFetch, apiRequest } from "./useSession";

export interface TreeNode {
  id: string;
  parent_id: string | null;
  role: string;
  preview: string;
  created_at: string;
  children?: TreeNode[];
}

const treeNodes = ref<TreeNode[]>([]);
const activeLeafId = ref<string | null>(null);
const scrollTargetId = ref<string | null>(null);

/** Build a nested tree from flat node list */
function buildTree(nodes: TreeNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  for (const node of nodes) {
    const treeNode = map.get(node.id)!;
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children!.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  return roots;
}

/** Check if the tree has any branching (any node with >1 child) */
function hasBranches(nodes: TreeNode[]): boolean {
  const childCount = new Map<string | null, number>();
  for (const node of nodes) {
    const key = node.parent_id;
    childCount.set(key, (childCount.get(key) || 0) + 1);
  }
  for (const count of childCount.values()) {
    if (count > 1) return true;
  }
  return false;
}

const tree = computed(() => buildTree(treeNodes.value));
const hasBranching = computed(() => hasBranches(treeNodes.value));

/** Get sibling nodes at a given message (same parent_id) */
function getSiblings(messageId: string): TreeNode[] {
  const node = treeNodes.value.find((n) => n.id === messageId);
  if (!node) return [];
  return treeNodes.value.filter((n) => n.parent_id === node.parent_id);
}

/** Get the active path (set of node IDs from root to active leaf) */
function getActivePath(leafId: string | null): Set<string> {
  const path = new Set<string>();
  if (!leafId) return path;
  const map = new Map(treeNodes.value.map((n) => [n.id, n]));
  let current = leafId;
  while (current) {
    path.add(current);
    const node = map.get(current);
    current = node?.parent_id || "";
    if (!current) break;
  }
  return path;
}

/** Find the leaf node of a branch starting from a given node */
function findLeafFromNode(nodeId: string): string {
  const childMap = new Map<string, TreeNode[]>();
  for (const node of treeNodes.value) {
    const parent = node.parent_id || "__root__";
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push(node);
  }

  let current = nodeId;
  while (true) {
    const children = childMap.get(current);
    if (!children || children.length === 0) break;
    // Follow the first child (most recent branch)
    current = children[children.length - 1].id;
  }
  return current;
}

async function fetchTree(sessionId: string) {
  const result = await apiRequest(`/api/sessions/${sessionId}/tree`);
  if (result.ok && result.data) {
    treeNodes.value = result.data;
  }
}

async function switchBranch(sessionId: string, leafId: string) {
  const result = await apiRequest(`/api/sessions/${sessionId}/active-leaf`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaf_id: leafId }),
  });
  if (result.ok) {
    activeLeafId.value = leafId;
  }
}

function setActiveLeafId(id: string | null) {
  activeLeafId.value = id;
}

function requestScrollTo(messageId: string) {
  scrollTargetId.value = messageId;
}

function clearScrollTarget() {
  scrollTargetId.value = null;
}

export function useMessageTree() {
  return {
    treeNodes: readonly(treeNodes),
    tree,
    hasBranching,
    activeLeafId: readonly(activeLeafId),
    scrollTargetId: readonly(scrollTargetId),
    fetchTree,
    switchBranch,
    setActiveLeafId,
    getSiblings,
    getActivePath,
    findLeafFromNode,
    requestScrollTo,
    clearScrollTarget,
  };
}
