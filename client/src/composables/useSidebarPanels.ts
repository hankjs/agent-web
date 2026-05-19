import { ref, computed } from "vue";

export interface PanelDefinition {
  id: string;
  icon: string;
  title: string;
  order: number;
}

const registeredPanels = ref<PanelDefinition[]>([]);
const activePanelId = ref<string | null>(null);

export function useSidebarPanels() {
  const sortedPanels = computed<PanelDefinition[]>(() =>
    [...registeredPanels.value].sort((a, b) => a.order - b.order)
  );

  function registerPanel(def: PanelDefinition) {
    if (!registeredPanels.value.find((p) => p.id === def.id)) {
      registeredPanels.value.push(def);
    }
  }

  function unregisterPanel(id: string) {
    registeredPanels.value = registeredPanels.value.filter((p) => p.id !== id);
    if (activePanelId.value === id) {
      activePanelId.value = null;
    }
  }

  function togglePanel(id: string) {
    activePanelId.value = activePanelId.value === id ? null : id;
  }

  function closePanel() {
    activePanelId.value = null;
  }

  function reset() {
    registeredPanels.value = [];
    activePanelId.value = null;
  }

  return {
    panels: sortedPanels,
    activePanelId,
    registerPanel,
    unregisterPanel,
    togglePanel,
    closePanel,
    reset,
  };
}
