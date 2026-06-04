<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { listImageProviders, generateImage, editImage, type ImageProvider, type ImageResult } from "../api/imageGen";

const providers = ref<ImageProvider[]>([]);
const selectedProviderId = ref("");
const selectedModel = ref("");
const prompt = ref("");
const size = ref("1024x1024");
const quality = ref("standard");
const n = ref(1);
const loading = ref(false);
const error = ref("");
const results = ref<ImageResult[]>([]);
const history = ref<{ prompt: string; images: ImageResult[]; provider: string; model: string }[]>([]);

// Image-to-image
const refImage = ref<File | null>(null);
const refImageUrl = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const currentProvider = computed(() =>
  providers.value.find((p) => p.id === selectedProviderId.value)
);

const modelOptions = computed(() => {
  const p = currentProvider.value;
  if (!p) return [];
  const m = p.models || {};
  return Object.keys(m).length > 0 ? Object.keys(m) : p.default_model ? [p.default_model] : [];
});

onMounted(async () => {
  const res = await listImageProviders();
  if (res.ok && res.data) {
    providers.value = res.data.providers;
    if (providers.value.length > 0) {
      selectedProviderId.value = providers.value[0].id;
      selectedModel.value = providers.value[0].default_model;
    }
  }
});

function onProviderChange() {
  const p = currentProvider.value;
  if (p) selectedModel.value = p.default_model;
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  refImage.value = file;
  refImageUrl.value = URL.createObjectURL(file);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  refImage.value = file;
  refImageUrl.value = URL.createObjectURL(file);
}

function clearRefImage() {
  refImage.value = null;
  if (refImageUrl.value) URL.revokeObjectURL(refImageUrl.value);
  refImageUrl.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

async function generate() {
  if (!prompt.value.trim()) return;
  loading.value = true;
  error.value = "";
  results.value = [];
  try {
    const params = {
      prompt: prompt.value,
      provider_id: selectedProviderId.value || undefined,
      model: selectedModel.value || undefined,
      size: size.value,
      n: n.value,
    };
    const res = refImage.value
      ? await editImage({ ...params, image: refImage.value })
      : await generateImage({ ...params, quality: quality.value });
    if (res.ok && res.data) {
      results.value = res.data.images;
      history.value.unshift({ prompt: prompt.value, images: res.data.images, provider: res.data.provider, model: res.data.model });
      if (history.value.length > 20) history.value.pop();
    } else {
      error.value = res.msg || "生成失败";
    }
  } finally {
    loading.value = false;
  }
}

const sizes = ["1024x1024", "1792x1024", "1024x1792", "512x512", "256x256"];
const qualities = ["standard", "hd"];
</script>

<template>
  <div class="image-gen">
    <div class="ig-left">
      <div class="ig-header">
        <h2 class="ig-title">AI 生图</h2>
      </div>

      <div class="ig-form">
        <!-- Provider -->
        <div class="ig-field" v-if="providers.length > 0">
          <label class="ig-label">Provider</label>
          <select v-model="selectedProviderId" @change="onProviderChange" class="ig-select">
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-else class="ig-no-provider">
          未配置生图 Provider，请在管理后台添加
        </div>

        <!-- Model -->
        <div class="ig-field" v-if="modelOptions.length > 0">
          <label class="ig-label">模型</label>
          <select v-model="selectedModel" class="ig-select">
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <!-- Size & Quality -->
        <div class="ig-row">
          <div class="ig-field">
            <label class="ig-label">尺寸</label>
            <select v-model="size" class="ig-select">
              <option v-for="s in sizes" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="ig-field">
            <label class="ig-label">质量</label>
            <select v-model="quality" class="ig-select">
              <option v-for="q in qualities" :key="q" :value="q">{{ q }}</option>
            </select>
          </div>
          <div class="ig-field ig-field-n">
            <label class="ig-label">数量</label>
            <select v-model="n" class="ig-select">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="4">4</option>
            </select>
          </div>
        </div>

        <!-- Reference Image -->
        <div class="ig-field">
          <label class="ig-label">参考图（图生图，可选）</label>
          <div
            class="ig-drop-zone"
            :class="{ 'has-image': refImageUrl }"
            @click="fileInput?.click()"
            @dragover.prevent
            @drop="onDrop"
          >
            <img v-if="refImageUrl" :src="refImageUrl" class="ig-ref-preview" />
            <template v-else>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity="0.5">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
              <span class="ig-drop-hint">点击或拖拽上传图片</span>
            </template>
            <button v-if="refImageUrl" class="ig-ref-clear" @click.stop="clearRefImage" aria-label="移除图片">×</button>
          </div>
          <input ref="fileInput" type="file" accept="image/*" class="ig-file-hidden" @change="onFileChange" />
        </div>

        <!-- Prompt -->
        <div class="ig-field">
          <label class="ig-label">提示词</label>
          <textarea
            v-model="prompt"
            class="ig-textarea"
            placeholder="描述你想生成的图片..."
            rows="5"
            @keydown.ctrl.enter="generate"
            @keydown.meta.enter="generate"
          />
          <div class="ig-hint">Ctrl+Enter 生成</div>
        </div>

        <button class="ig-btn" :disabled="loading || !prompt.trim() || providers.length === 0" @click="generate">
          <span v-if="loading" class="ig-spinner" />
          {{ loading ? "生成中..." : "生成图片" }}
        </button>

        <div v-if="error" class="ig-error">{{ error }}</div>
      </div>

      <!-- History -->
      <div v-if="history.length > 0" class="ig-history">
        <div class="ig-history-title">历史记录</div>
        <div
          v-for="(item, i) in history"
          :key="i"
          class="ig-history-item"
          @click="results = item.images; prompt = item.prompt"
        >
          <img v-if="item.images[0]?.url" :src="item.images[0].url" class="ig-history-thumb" />
          <span class="ig-history-prompt">{{ item.prompt }}</span>
        </div>
      </div>
    </div>

    <!-- Results -->
    <div class="ig-right">
      <div v-if="loading" class="ig-loading">
        <div class="ig-loading-spinner" />
        <span>正在生成...</span>
      </div>
      <div v-else-if="results.length > 0" class="ig-results">
        <div v-for="(img, i) in results" :key="i" class="ig-result-item">
          <img v-if="img.url" :src="img.url" class="ig-result-img" />
          <img v-else-if="img.b64_json" :src="`data:image/png;base64,${img.b64_json}`" class="ig-result-img" />
          <div v-if="img.revised_prompt" class="ig-revised-prompt">{{ img.revised_prompt }}</div>
          <a v-if="img.url" :href="img.url" target="_blank" download class="ig-download">下载</a>
        </div>
      </div>
      <div v-else class="ig-empty">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" opacity="0.3">
          <rect x="8" y="8" width="48" height="48" rx="8" stroke="currentColor" stroke-width="2"/>
          <circle cx="24" cy="24" r="5" stroke="currentColor" stroke-width="2"/>
          <path d="M8 42l14-14 10 10 8-8 16 16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <p>输入提示词，点击生成</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-gen {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.ig-left {
  width: 320px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border-subtle);
  overflow-y: auto;
}

.ig-header {
  padding: var(--space-4) var(--space-4) var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.ig-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.ig-form {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ig-field { display: flex; flex-direction: column; gap: var(--space-1); }
.ig-label { font-size: 11px; font-weight: 500; color: var(--color-text-muted); }

.ig-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.ig-field-n { grid-column: span 2; }
.ig-row .ig-field-n { grid-column: auto; }
.ig-row { grid-template-columns: 1fr 1fr 80px; }

.ig-select {
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}
.ig-select:focus { border-color: var(--color-accent); }

.ig-textarea {
  padding: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  line-height: 1.5;
}
.ig-textarea:focus { border-color: var(--color-accent); }

.ig-drop-zone {
  position: relative;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 1.5px dashed var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
  overflow: hidden;
  background: var(--color-surface-2);
}
.ig-drop-zone:hover { border-color: var(--color-accent); }
.ig-drop-zone.has-image { min-height: 120px; }

.ig-ref-preview {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  display: block;
}

.ig-drop-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}

.ig-ref-clear {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: oklch(0 0 0 / 0.5);
  color: white;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ig-file-hidden { display: none; }

.ig-hint { font-size: 10px; color: var(--color-text-muted); }

.ig-btn {
  height: 36px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  transition: opacity var(--duration-fast);
}
.ig-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ig-btn:not(:disabled):hover { opacity: 0.85; }

.ig-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.ig-error {
  font-size: 12px;
  color: var(--color-error);
  padding: var(--space-2);
  background: oklch(0.65 0.18 25 / 0.1);
  border-radius: var(--radius-sm);
}

.ig-no-provider {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: var(--space-2);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.ig-history {
  padding: var(--space-2) var(--space-4) var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}
.ig-history-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
  margin-bottom: var(--space-2);
}
.ig-history-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.ig-history-item:hover { background: var(--color-surface-hover); }
.ig-history-thumb {
  width: 32px; height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.ig-history-prompt {
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right panel */
.ig-right {
  flex: 1;
  overflow-y: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-6);
}

.ig-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: 20vh;
}
.ig-loading-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.ig-results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
  width: 100%;
}

.ig-result-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ig-result-img {
  width: 100%;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-subtle);
  display: block;
}

.ig-revised-prompt {
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.ig-download {
  font-size: 11px;
  color: var(--color-accent);
  text-decoration: none;
  align-self: flex-start;
}
.ig-download:hover { text-decoration: underline; }

.ig-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: 20vh;
}
</style>
