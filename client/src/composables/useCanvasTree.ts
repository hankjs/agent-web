import { ref, watch, type Ref, type ComputedRef } from "vue";
import type { TreeNode } from "./useMessageTree";

// Layout constants
const NODE_WIDTH = 120;
const NODE_HEIGHT = 32;
const NODE_SPACING_X = 150;
const NODE_SPACING_Y = 70;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.0;
const FONT_SIZE = 11;
const BORDER_RADIUS = 6;

interface LayoutNode {
  id: string;
  preview: string;
  x: number;
  y: number;
  children: LayoutNode[];
  parent: LayoutNode | null;
  // Reingold-Tilford helpers
  offset: number;
  thread: LayoutNode | null;
  ancestor: LayoutNode | null;
  change: number;
  shift: number;
  number: number;
  mod: number;
  prelim: number;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Build a layout tree from the message tree, keeping only user nodes with preview.
 */
function buildLayoutTree(nodes: TreeNode[], parent: LayoutNode | null, depth: number): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const node of nodes) {
    if (node.role === "user" && node.preview) {
      const ln: LayoutNode = {
        id: node.id,
        preview: node.preview,
        x: 0,
        y: depth,
        children: [],
        parent,
        offset: 0,
        thread: null,
        ancestor: null,
        change: 0,
        shift: 0,
        number: 0,
        mod: 0,
        prelim: 0,
      };
      ln.ancestor = ln;
      ln.children = buildLayoutTree(node.children || [], ln, depth + 1);
      result.push(ln);
    } else {
      // Skip non-user nodes but recurse into children at same depth
      const sub = buildLayoutTree(node.children || [], parent, depth);
      result.push(...sub);
    }
  }
  // Assign sibling numbers
  result.forEach((n, i) => { n.number = i + 1; });
  return result;
}

/**
 * Simplified Reingold-Tilford: position nodes so siblings are side by side
 * and parents are centered above children.
 */
function layoutTree(roots: LayoutNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  // Wrap multiple roots in a virtual root for layout
  const virtualRoot: LayoutNode = {
    id: "__root__",
    preview: "",
    x: 0,
    y: -1,
    children: roots,
    parent: null,
    offset: 0,
    thread: null,
    ancestor: null,
    change: 0,
    shift: 0,
    number: 0,
    mod: 0,
    prelim: 0,
  };
  virtualRoot.ancestor = virtualRoot;
  roots.forEach(r => { r.parent = virtualRoot; });

  firstWalk(virtualRoot);
  secondWalk(virtualRoot, -virtualRoot.prelim, 0);

  // Collect all real nodes
  const all: LayoutNode[] = [];
  function collect(node: LayoutNode) {
    if (node.id !== "__root__") all.push(node);
    node.children.forEach(collect);
  }
  collect(virtualRoot);
  return all;
}

function firstWalk(v: LayoutNode) {
  if (v.children.length === 0) {
    // Leaf
    const siblings = v.parent?.children || [];
    const idx = siblings.indexOf(v);
    if (idx > 0) {
      v.prelim = siblings[idx - 1].prelim + 1;
    }
  } else {
    let defaultAncestor = v.children[0];
    for (const w of v.children) {
      firstWalk(w);
      defaultAncestor = apportion(w, defaultAncestor);
    }
    executeShifts(v);
    const first = v.children[0];
    const last = v.children[v.children.length - 1];
    const midpoint = (first.prelim + last.prelim) / 2;
    const siblings = v.parent?.children || [];
    const idx = siblings.indexOf(v);
    if (idx > 0) {
      v.prelim = siblings[idx - 1].prelim + 1;
      v.mod = v.prelim - midpoint;
    } else {
      v.prelim = midpoint;
    }
  }
}

function apportion(v: LayoutNode, defaultAncestor: LayoutNode): LayoutNode {
  const siblings = v.parent?.children || [];
  const idx = siblings.indexOf(v);
  if (idx > 0) {
    const w = siblings[idx - 1];
    let vir = v; // inner right
    let vor = v; // outer right
    let vil = w; // inner left
    let vol = siblings[0]; // outer left
    let sir = vir.mod;
    let sor = vor.mod;
    let sil = vil.mod;
    let sol = vol.mod;

    while (nextRight(vil) && nextLeft(vir)) {
      vil = nextRight(vil)!;
      vir = nextLeft(vir)!;
      vol = nextLeft(vol)!;
      vor = nextRight(vor)!;
      vor.ancestor = v;
      const shift = (vil.prelim + sil) - (vir.prelim + sir) + 1;
      if (shift > 0) {
        const a = ancestor(vil, v, defaultAncestor);
        moveSubtree(a, v, shift);
        sir += shift;
        sor += shift;
      }
      sil += vil.mod;
      sir += vir.mod;
      sol += vol.mod;
      sor += vor.mod;
    }
    if (nextRight(vil) && !nextRight(vor)) {
      vor.thread = nextRight(vil)!;
      vor.mod += sil - sor;
    }
    if (nextLeft(vir) && !nextLeft(vol)) {
      vol.thread = nextLeft(vir)!;
      vol.mod += sir - sol;
      defaultAncestor = v;
    }
  }
  return defaultAncestor;
}

function nextLeft(v: LayoutNode): LayoutNode | null {
  return v.children.length > 0 ? v.children[0] : v.thread;
}
function nextRight(v: LayoutNode): LayoutNode | null {
  return v.children.length > 0 ? v.children[v.children.length - 1] : v.thread;
}
function ancestor(vil: LayoutNode, v: LayoutNode, defaultAncestor: LayoutNode): LayoutNode {
  const siblings = v.parent?.children || [];
  if (vil.ancestor && siblings.includes(vil.ancestor)) return vil.ancestor;
  return defaultAncestor;
}
function moveSubtree(wl: LayoutNode, wr: LayoutNode, shift: number) {
  const subtrees = wr.number - wl.number;
  if (subtrees > 0) {
    wr.change -= shift / subtrees;
    wr.shift += shift;
    wl.change += shift / subtrees;
    wr.prelim += shift;
    wr.mod += shift;
  }
}
function executeShifts(v: LayoutNode) {
  let shift = 0;
  let change = 0;
  for (let i = v.children.length - 1; i >= 0; i--) {
    const w = v.children[i];
    w.prelim += shift;
    w.mod += shift;
    change += w.change;
    shift += w.shift + change;
  }
}
function secondWalk(v: LayoutNode, m: number, depth: number) {
  v.x = v.prelim + m;
  v.y = depth;
  for (const w of v.children) {
    secondWalk(w, m + v.mod, depth + 1);
  }
}

/**
 * Main composable: binds canvas rendering and interaction to a canvas element.
 */
export function useCanvasTree(
  canvasRef: Ref<HTMLCanvasElement | null>,
  tree: ComputedRef<TreeNode[]>,
  activePath: ComputedRef<Set<string>>,
  onNodeClick: (node: { id: string }) => void,
) {
  const camera = ref<Camera>({ x: 0, y: 0, zoom: 1 });
  let layoutNodes: LayoutNode[] = [];
  let animFrame = 0;
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let cameraStart = { x: 0, y: 0 };

  function getPixelX(node: LayoutNode): number {
    return node.x * NODE_SPACING_X;
  }
  function getPixelY(node: LayoutNode): number {
    return node.y * NODE_SPACING_Y;
  }

  function render() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const { x: cx, y: cy, zoom } = camera.value;
    ctx.save();
    ctx.translate(rect.width / 2 + cx, 40 + cy);
    ctx.scale(zoom, zoom);

    const activeSet = activePath.value;

    // Draw edges
    for (const node of layoutNodes) {
      for (const child of node.children) {
        const x1 = getPixelX(node);
        const y1 = getPixelY(node) + NODE_HEIGHT;
        const x2 = getPixelX(child);
        const y2 = getPixelY(child);
        const isActive = activeSet.has(node.id) && activeSet.has(child.id);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const midY = (y1 + y2) / 2;
        ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
        ctx.strokeStyle = isActive ? "#3b82f6" : "rgba(150,150,150,0.4)";
        ctx.lineWidth = isActive ? 2 : 1.2;
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const node of layoutNodes) {
      const px = getPixelX(node) - NODE_WIDTH / 2;
      const py = getPixelY(node);
      const isActive = activeSet.has(node.id);

      // Background
      ctx.beginPath();
      ctx.roundRect(px, py, NODE_WIDTH, NODE_HEIGHT, BORDER_RADIUS);
      ctx.fillStyle = isActive ? "#2563eb" : "#2a2a2a";
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Text
      ctx.fillStyle = isActive ? "#ffffff" : "#a0a0a0";
      ctx.font = `${FONT_SIZE}px -apple-system, sans-serif`;
      ctx.textBaseline = "middle";
      const maxTextWidth = NODE_WIDTH - 12;
      let text = node.preview;
      while (ctx.measureText(text).width > maxTextWidth && text.length > 1) {
        text = text.slice(0, -1);
      }
      if (text !== node.preview) text += "…";
      ctx.fillText(text, px + 6, py + NODE_HEIGHT / 2);
    }

    ctx.restore();
  }

  function scheduleRender() {
    if (animFrame) return;
    animFrame = requestAnimationFrame(() => {
      animFrame = 0;
      render();
    });
  }

  function recomputeLayout() {
    const roots = buildLayoutTree(tree.value, null, 0);
    layoutNodes = layoutTree(roots);
    scheduleRender();
  }

  // Hit test: find node under screen coordinates
  function hitTest(screenX: number, screenY: number): LayoutNode | null {
    const canvas = canvasRef.value;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { x: cx, y: cy, zoom } = camera.value;
    // Convert screen to world coords
    const wx = (screenX - rect.left - rect.width / 2 - cx) / zoom;
    const wy = (screenY - rect.top - 40 - cy) / zoom;

    for (const node of layoutNodes) {
      const px = getPixelX(node) - NODE_WIDTH / 2;
      const py = getPixelY(node);
      if (wx >= px && wx <= px + NODE_WIDTH && wy >= py && wy <= py + NODE_HEIGHT) {
        return node;
      }
    }
    return null;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.value.zoom * factor));
    camera.value = { ...camera.value, zoom: newZoom };
    scheduleRender();
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    cameraStart = { x: camera.value.x, y: camera.value.y };
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    camera.value = { ...camera.value, x: cameraStart.x + dx, y: cameraStart.y + dy };
    scheduleRender();
  }

  function onMouseUp(e: MouseEvent) {
    if (!isDragging) return;
    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);
    isDragging = false;
    // If barely moved, treat as click
    if (dx < 4 && dy < 4) {
      const node = hitTest(e.clientX, e.clientY);
      if (node) onNodeClick({ id: node.id });
    }
  }

  function focusOnNode(nodeId: string) {
    const node = layoutNodes.find(n => n.id === nodeId);
    if (!node) return;
    const canvas = canvasRef.value;
    if (!canvas) return;
    const targetX = -getPixelX(node) * camera.value.zoom;
    const targetY = -getPixelY(node) * camera.value.zoom;
    // Animate camera
    const startX = camera.value.x;
    const startY = camera.value.y;
    const duration = 300;
    const startTime = performance.now();
    function animate() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const ease = t * (2 - t); // ease-out
      camera.value = {
        ...camera.value,
        x: startX + (targetX - startX) * ease,
        y: startY + (targetY - startY) * ease,
      };
      scheduleRender();
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  function setup() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    recomputeLayout();
  }

  function teardown() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    if (animFrame) cancelAnimationFrame(animFrame);
  }

  // Watch tree changes
  watch(tree, recomputeLayout, { deep: true });
  watch(activePath, scheduleRender);

  return { setup, teardown, recomputeLayout, render: scheduleRender, focusOnNode };
}




