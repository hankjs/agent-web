import { ref, onUnmounted } from "vue";

export interface ContextMenuItem {
  label: string;
  action: () => void;
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export function useContextMenu() {
  const visible = ref(false);
  const position = ref({ x: 0, y: 0 });
  const items = ref<ContextMenuItem[]>([]);

  function open(event: MouseEvent, menuItems: ContextMenuItem[]) {
    event.preventDefault();
    event.stopPropagation();
    items.value = menuItems;

    // Position at cursor, will be adjusted by component if overflowing
    position.value = { x: event.clientX, y: event.clientY };
    visible.value = true;
  }

  function close() {
    visible.value = false;
  }

  return { visible, position, items, open, close };
}
