<script setup lang="ts">
import { ref, nextTick, watch } from "vue";

export interface ProviderOption {
  name: string;
  key: string;
  source: "local" | "server";
}

export interface PendingImage {
  file: File;
  preview: string;
  media_type: string;
  data: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  isStreaming: boolean;
  isConnected?: boolean;
  isEmpty?: boolean;
  placeholder?: string;
  providerOptions?: ProviderOption[];
  selectedProvider?: string;
  showImageUpload?: boolean;
  disableImageUpload?: boolean;
}>(), {
  isConnected: true,
  isEmpty: false,
  placeholder: "",
  providerOptions: () => [],
  selectedProvider: "",
  showImageUpload: true,
  disableImageUpload: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:selectedProvider": [value: string];
  send: [];
  stop: [];
  "images-change": [images: PendingImage[]];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const showProviderDropdown = ref(false);
const pendingImages = ref<PendingImage[]>([]);

function autoResize() {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    emit("send");
  }
  if (e.key === "j" && e.ctrlKey) {
    e.preventDefault();
    const ta = textareaRef.value;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = props.modelValue;
    emit("update:modelValue", val.substring(0, start) + "\n" + val.substring(end));
    nextTick(() => {
      ta.selectionStart = ta.selectionEnd = start + 1;
      autoResize();
    });
  }
}

function handleInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
  autoResize();
}

function triggerImagePicker() {
  fileInputRef.value?.click();
}

function handleImageSelect(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files) return;
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      pendingImages.value.push({ file, preview: dataUrl, media_type: file.type, data: base64 });
      emit("images-change", pendingImages.value);
    };
    reader.readAsDataURL(file);
  }
  (e.target as HTMLInputElement).value = "";
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles: File[] = [];
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length === 0) return;
  e.preventDefault();
  for (const file of imageFiles) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      pendingImages.value.push({ file, preview: dataUrl, media_type: file.type, data: base64 });
      emit("images-change", pendingImages.value);
    };
    reader.readAsDataURL(file);
  }
}

function removeImage(index: number) {
  pendingImages.value.splice(index, 1);
  emit("images-change", pendingImages.value);
}

function selectProvider(key: string) {
  emit("update:selectedProvider", key);
  showProviderDropdown.value = false;
}

// Expose for parent to reset images after send
function clearImages() {
  pendingImages.value = [];
}

// Expose for parent to get pending images
function getImages() {
  return pendingImages.value;
}

defineExpose({ clearImages, getImages, textareaRef });
</script>

<template>
  <div class="agent-input-area" :class="isEmpty ? 'input-centered' : 'input-docked'">
    <div class="agent-input-container">
      <div class="agent-input-wrapper">
        <input
          v-if="showImageUpload"
          ref="fileInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="handleImageSelect"
        />
        <textarea
          ref="textareaRef"
          :value="modelValue"
          @input="handleInput"
          @keydown="handleKeydown"
          @paste="showImageUpload ? handlePaste($event) : undefined"
          :disabled="!isConnected"
          :placeholder="!isConnected ? '离线' : placeholder"
          class="agent-input-field"
          rows="1"
          aria-label="Message input"
        ></textarea>
        <button
          class="agent-send-btn"
          :class="{ 'stop-mode': isStreaming }"
          @click="isStreaming ? emit('stop') : emit('send')"
          :disabled="!isConnected || (!isStreaming && !modelValue.trim() && pendingImages.length === 0)"
          :aria-label="isStreaming ? 'Stop' : 'Send'"
        >
          <svg v-if="!isStreaming" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 14V3M8 3L3 8M8 3L13 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <!-- Image previews -->
      <div v-if="showImageUpload && pendingImages.length > 0" class="image-preview-row">
        <div v-for="(img, idx) in pendingImages" :key="idx" class="image-preview-item">
          <img :src="img.preview" alt="Upload preview" />
          <button class="image-remove-btn" @click="removeImage(idx)" aria-label="Remove image">&times;</button>
        </div>
      </div>
      <!-- Meta row: provider + image upload btn -->
      <div class="input-meta" v-if="providerOptions.length > 0 || showImageUpload">
        <div class="provider-selector" v-if="providerOptions.length > 0">
          <button class="provider-current" @click="showProviderDropdown = !showProviderDropdown">
            <span class="provider-source-dot" :class="providerOptions.find(p => p.key === selectedProvider)?.source || 'server'"></span>
            <span>{{ providerOptions.find(p => p.key === selectedProvider)?.name || 'Select provider' }}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 4L5 6.5L7.5 4"/>
            </svg>
          </button>
          <div v-if="showProviderDropdown" class="provider-dropdown">
            <button
              v-for="p in providerOptions"
              :key="p.key"
              class="provider-dropdown-item"
              :class="{ active: selectedProvider === p.key }"
              @click="selectProvider(p.key)"
            >
              <span class="provider-source-dot" :class="p.source"></span>
              <span class="provider-dropdown-name">{{ p.name }}</span>
              <span class="provider-dropdown-tag">{{ p.source === 'local' ? 'Local' : 'Server' }}</span>
            </button>
          </div>
        </div>
        <button
          v-if="showImageUpload"
          class="image-upload-btn"
          @click="triggerImagePicker"
          :disabled="!isConnected || isStreaming || disableImageUpload"
          :title="disableImageUpload ? 'Images not supported with local agent' : 'Attach image'"
          aria-label="Attach image"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-input-area { padding: 16px 24px; border-top: 1px solid var(--color-border-subtle); }
.agent-input-area.input-centered { position: absolute; bottom: 0; left: 0; right: 0; }
.agent-input-container { max-width: 720px; margin: 0 auto; width: 100%; }
.agent-input-wrapper { display: flex; align-items: flex-end; gap: 8px; }
.agent-input-field { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); color: var(--color-text-primary); font-size: 14px; resize: none; outline: none; line-height: 1.5; }
.agent-input-field:focus { border-color: var(--color-accent); }
.agent-input-field:disabled { opacity: 0.5; }
.agent-send-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: var(--color-accent); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.agent-send-btn:disabled { opacity: 0.4; cursor: default; }
.agent-send-btn.stop-mode { background: oklch(0.55 0.15 25); }

.image-preview-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.image-preview-item { position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--color-border-subtle); }
.image-preview-item img { width: 100%; height: 100%; object-fit: cover; }
.image-remove-btn { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,0.6); color: #fff; border: none; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

.input-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.provider-selector { position: relative; }
.provider-current { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; border: none; background: transparent; color: var(--color-text-muted); font-size: 12px; cursor: pointer; }
.provider-current:hover { background: var(--color-surface-1); color: var(--color-text-secondary); }
.provider-source-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.provider-source-dot.local { background: oklch(0.7 0.15 145); }
.provider-source-dot.server { background: oklch(0.7 0.12 260); }
.provider-dropdown { position: absolute; bottom: 100%; left: 0; margin-bottom: 4px; background: var(--color-surface-2); border: 1px solid var(--color-border-subtle); border-radius: 8px; padding: 4px; min-width: 180px; z-index: 20; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
.provider-dropdown-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border: none; background: transparent; color: var(--color-text-secondary); font-size: 12px; border-radius: 4px; cursor: pointer; text-align: left; }
.provider-dropdown-item:hover { background: var(--color-surface-1); }
.provider-dropdown-item.active { background: var(--color-surface-1); color: var(--color-text-primary); }
.provider-dropdown-name { flex: 1; }
.provider-dropdown-tag { font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; }
.image-upload-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.image-upload-btn:hover:not(:disabled) { color: var(--color-text-secondary); background: var(--color-surface-1); }
.image-upload-btn:disabled { opacity: 0.3; cursor: default; }
</style>
