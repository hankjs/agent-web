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
const isComposing = ref(false);

function autoResize() {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
}

function handleCompositionEnd() {
  setTimeout(() => { isComposing.value = false; });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !isComposing.value) {
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
          @compositionstart="isComposing = true"
          @compositionend="handleCompositionEnd"
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
.agent-input-area { padding: var(--space-3, 12px) var(--space-4, 16px); border-top: 1px solid var(--color-border-subtle); }
.agent-input-area.input-centered { position: absolute; bottom: 0; left: 0; right: 0; }
.agent-input-container { max-width: 720px; margin: 0 auto; width: 100%; }
.agent-input-wrapper { display: flex; align-items: flex-end; gap: var(--space-2, 8px); }
.agent-input-field { flex: 1; padding: var(--space-2, 8px) var(--space-3, 12px); border-radius: var(--radius-md, 6px); border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); color: var(--color-text-primary); font-size: 13px; resize: none; outline: none; line-height: 1.5; transition: border-color var(--duration-fast, 120ms); }
.agent-input-field:focus { border-color: var(--color-accent); }
.agent-input-field:disabled { opacity: 0.5; }
.agent-send-btn { width: 32px; height: 32px; border-radius: var(--radius-md, 6px); border: none; background: var(--color-accent); color: var(--color-surface-0); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background var(--duration-fast, 120ms); }
.agent-send-btn:hover { background: var(--color-accent-hover); }
.agent-send-btn:disabled { opacity: 0.4; cursor: default; }
.agent-send-btn.stop-mode { background: var(--color-error); }

.image-preview-row { display: flex; gap: var(--space-2, 8px); margin-top: var(--space-2, 8px); flex-wrap: wrap; }
.image-preview-item { position: relative; width: 48px; height: 48px; border-radius: var(--radius-sm, 4px); overflow: hidden; border: 1px solid var(--color-border-subtle); }
.image-preview-item img { width: 100%; height: 100%; object-fit: cover; }
.image-remove-btn { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%; background: rgba(0,0,0,0.6); color: var(--color-text-primary); border: none; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

.input-meta { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-2, 8px); }
.provider-selector { position: relative; }
.provider-current { display: flex; align-items: center; gap: 6px; padding: var(--space-1, 4px) var(--space-2, 8px); border-radius: var(--radius-sm, 4px); border: none; background: transparent; color: var(--color-text-muted); font-size: 11px; cursor: pointer; }
.provider-current:hover { background: var(--color-surface-hover); color: var(--color-text-secondary); }
.provider-source-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.provider-source-dot.local { background: var(--color-success); }
.provider-source-dot.server { background: var(--color-info); }
.provider-dropdown { position: absolute; bottom: 100%; left: 0; margin-bottom: 4px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md, 6px); padding: var(--space-1, 4px); min-width: 180px; z-index: 20; }
.provider-dropdown-item { display: flex; align-items: center; gap: var(--space-2, 8px); width: 100%; padding: var(--space-2, 8px) var(--space-2, 8px); border: none; background: transparent; color: var(--color-text-secondary); font-size: 12px; border-radius: var(--radius-sm, 4px); cursor: pointer; text-align: left; }
.provider-dropdown-item:hover { background: var(--color-surface-hover); }
.provider-dropdown-item.active { background: var(--color-surface-hover); color: var(--color-text-primary); }
.provider-dropdown-name { flex: 1; }
.provider-dropdown-tag { font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; }
.image-upload-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: var(--space-1, 4px); border-radius: var(--radius-sm, 4px); display: flex; align-items: center; justify-content: center; transition: color var(--duration-fast, 120ms); }
.image-upload-btn:hover:not(:disabled) { color: var(--color-text-secondary); background: var(--color-surface-hover); }
.image-upload-btn:disabled { opacity: 0.3; cursor: default; }
</style>
