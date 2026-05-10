import { ref } from "vue";

export interface MessageItem {
  id: number;
  text: string;
  type: "info" | "success" | "warning" | "error";
}

let nextId = 0;
const messages = ref<MessageItem[]>([]);

export function useMessage() {
  function show(text: string, type: MessageItem["type"] = "info", duration = 3000) {
    const id = nextId++;
    messages.value.push({ id, text, type });
    setTimeout(() => {
      messages.value = messages.value.filter((m) => m.id !== id);
    }, duration);
  }

  return {
    messages,
    info: (text: string) => show(text, "info"),
    success: (text: string) => show(text, "success"),
    warning: (text: string) => show(text, "warning"),
    error: (text: string) => show(text, "error"),
  };
}
