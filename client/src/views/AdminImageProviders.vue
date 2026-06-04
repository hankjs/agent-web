<script setup lang="ts">
import { ref, onMounted } from "vue";
import { adminListImageProviders, adminCreateImageProvider, adminUpdateImageProvider, adminDeleteImageProvider } from "../api/imageGen";

const providers = ref<any[]>([]);
const editing = ref<any | null>(null);
const isNew = ref(false);
const saving = ref(false);
const error = ref("");

const emptyForm = () => ({
  name: "", provider_type: "openai", api_key: "",
  base_url: "", default_model: "", models: "{}", priority: 0, enabled: true,
});

onMounted(fetchProviders);

async function fetchProviders() {
  const res = await adminListImageProviders();
  if (res.ok && res.data) providers.value = res.data as any[];
}

function startNew() {
  editing.value = emptyForm();
  isNew.value = true;
  error.value = "";
}

function startEdit(p: any) {
  editing.value = { ...p, models: typeof p.models === "object" ? JSON.stringify(p.models) : p.models };
  isNew.value = false;
  error.value = "";
}

function cancelEdit() { editing.value = null; }

async function save() {
  if (!editing.value) return;
  saving.value = true;
  error.value = "";
  try {
    let models: any;
    try { models = JSON.parse(editing.value.models || "{}"); } catch { models = {}; }
    const payload = { ...editing.value, models };
    const res = isNew.value
      ? await adminCreateImageProvider(payload)
      : await adminUpdateImageProvider(editing.value.id, payload);
    if (res.ok) { editing.value = null; await fetchProviders(); }
    else error.value = res.msg || "保存失败";
  } finally { saving.value = false; }
}

async function remove(id: string) {
  if (!confirm("确认删除？")) return;
  await adminDeleteImageProvider(id);
  await fetchProviders();
}
</script>

<template>
  <div class="aip">
    <div class="aip-header">
      <h2 class="aip-title">生图 Providers</h2>
      <button class="aip-btn-add" @click="startNew">+ 添加</button>
    </div>

    <div v-if="providers.length === 0 && !editing" class="aip-empty">暂无生图 Provider</div>

    <div class="aip-list">
      <div v-for="p in providers" :key="p.id" class="aip-item">
        <div class="aip-item-info">
          <span class="aip-name">{{ p.name }}</span>
          <span class="aip-type">{{ p.provider_type }}</span>
          <span class="aip-model">{{ p.default_model }}</span>
          <span class="aip-status" :class="p.enabled ? 'on' : 'off'">{{ p.enabled ? "启用" : "禁用" }}</span>
        </div>
        <div class="aip-item-actions">
          <button class="aip-btn-sm" @click="startEdit(p)">编辑</button>
          <button class="aip-btn-sm danger" @click="remove(p.id)">删除</button>
        </div>
      </div>
    </div>

    <!-- Edit form -->
    <div v-if="editing" class="aip-form">
      <h3 class="aip-form-title">{{ isNew ? "新增 Provider" : "编辑 Provider" }}</h3>
      <div class="aip-field">
        <label>名称</label>
        <input v-model="editing.name" placeholder="e.g. openai-image" />
      </div>
      <div class="aip-field">
        <label>类型</label>
        <input v-model="editing.provider_type" placeholder="openai" />
      </div>
      <div class="aip-field">
        <label>API Key</label>
        <input v-model="editing.api_key" type="password" placeholder="sk-..." />
      </div>
      <div class="aip-field">
        <label>Base URL（可选）</label>
        <input v-model="editing.base_url" placeholder="https://api.openai.com" />
      </div>
      <div class="aip-field">
        <label>默认模型</label>
        <input v-model="editing.default_model" placeholder="dall-e-3" />
      </div>
      <div class="aip-field">
        <label>模型列表（JSON）</label>
        <textarea v-model="editing.models" rows="3" placeholder='{"dall-e-3": "DALL-E 3"}' />
      </div>
      <div class="aip-row">
        <div class="aip-field">
          <label>优先级</label>
          <input v-model.number="editing.priority" type="number" />
        </div>
        <div class="aip-field aip-field-check">
          <label><input type="checkbox" v-model="editing.enabled" /> 启用</label>
        </div>
      </div>
      <div v-if="error" class="aip-error">{{ error }}</div>
      <div class="aip-form-actions">
        <button class="aip-btn-sm" @click="cancelEdit">取消</button>
        <button class="aip-btn-primary" :disabled="saving" @click="save">{{ saving ? "保存中..." : "保存" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aip { padding: var(--space-4); max-width: 640px; }
.aip-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4); }
.aip-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.aip-empty { font-size: 13px; color: var(--color-text-muted); }
.aip-list { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); }
.aip-item { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border-subtle); }
.aip-item-info { display: flex; align-items: center; gap: var(--space-3); }
.aip-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
.aip-type, .aip-model { font-size: 11px; color: var(--color-text-muted); }
.aip-status { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 3px; }
.aip-status.on { color: var(--color-success, #40d67a); background: oklch(0.7 0.15 145 / 0.12); }
.aip-status.off { color: var(--color-text-muted); background: var(--color-surface-3); }
.aip-item-actions { display: flex; gap: var(--space-1); }
.aip-btn-sm { height: 26px; padding: 0 var(--space-2); font-size: 11px; background: var(--color-surface-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-secondary); cursor: pointer; }
.aip-btn-sm:hover { color: var(--color-text-primary); }
.aip-btn-sm.danger:hover { color: var(--color-error); }
.aip-btn-add { height: 30px; padding: 0 var(--space-3); font-size: 12px; background: var(--color-accent); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.aip-form { background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.aip-form-title { margin: 0 0 var(--space-1); font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.aip-field { display: flex; flex-direction: column; gap: 4px; }
.aip-field label { font-size: 11px; color: var(--color-text-muted); }
.aip-field input, .aip-field textarea { padding: var(--space-1) var(--space-2); background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-primary); font-size: 12px; font-family: inherit; outline: none; }
.aip-field input:focus, .aip-field textarea:focus { border-color: var(--color-accent); }
.aip-field-check { justify-content: flex-end; }
.aip-field-check label { display: flex; align-items: center; gap: var(--space-1); font-size: 12px; color: var(--color-text-secondary); cursor: pointer; }
.aip-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.aip-error { font-size: 12px; color: var(--color-error); }
.aip-form-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.aip-btn-primary { height: 30px; padding: 0 var(--space-3); font-size: 12px; background: var(--color-accent); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.aip-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
