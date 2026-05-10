<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface AgentConfig {
  name: string;
  agent_type: string;
  binary_path: string;
}

const emit = defineEmits<{ close: [] }>();

const agents = ref<AgentConfig[]>([]);
const newName = ref("");
const newType = ref("claude-code");
const newPath = ref("");
const testResult = ref<Record<string, { ok: boolean; message: string }>>({});
const isAdding = ref(false);

async function loadAgents() {
  try {
    agents.value = await invoke<AgentConfig[]>("acp_get_agents");
  } catch (e: any) {
    console.error("Failed to load agents:", e);
  }
}

async function addAgent() {
  if (!newName.value.trim() || !newPath.value.trim()) return;
  try {
    await invoke("acp_add_agent", {
      name: newName.value.trim(),
      agentType: newType.value,
      binaryPath: newPath.value.trim(),
    });
    newName.value = "";
    newPath.value = "";
    isAdding.value = false;
    await loadAgents();
  } catch (e: any) {
    console.error("Failed to add agent:", e);
  }
}

async function removeAgent(name: string) {
  try {
    await invoke("acp_remove_agent", { name });
    await loadAgents();
  } catch (e: any) {
    console.error("Failed to remove agent:", e);
  }
}

async function testAgent(name: string) {
  testResult.value[name] = { ok: false, message: "Testing..." };
  try {
    const msg = await invoke<string>("acp_test_agent", { name });
    testResult.value[name] = { ok: true, message: msg };
  } catch (e: any) {
    testResult.value[name] = { ok: false, message: String(e) };
  }
}

async function browsePath() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Select agent binary",
  });
  if (selected) {
    newPath.value = selected as string;
  }
}

onMounted(loadAgents);
</script>

<template>
  <div class="settings-panel">
    <div class="settings-header">
      <h2>Local Agent Settings</h2>
      <button class="close-btn" @click="emit('close')">&times;</button>
    </div>

    <div class="agent-list">
      <div v-for="agent in agents" :key="agent.name" class="agent-item">
        <div class="agent-info">
          <span class="agent-name">{{ agent.name }}</span>
          <span class="agent-type">{{ agent.agent_type }}</span>
          <span class="agent-path">{{ agent.binary_path }}</span>
        </div>
        <div class="agent-actions">
          <button class="btn-sm" @click="testAgent(agent.name)">Test</button>
          <button class="btn-sm btn-danger" @click="removeAgent(agent.name)">Remove</button>
        </div>
        <div v-if="testResult[agent.name]" class="test-result" :class="{ ok: testResult[agent.name].ok }">
          {{ testResult[agent.name].message }}
        </div>
      </div>
      <div v-if="agents.length === 0" class="empty-state">
        No agents configured. Add one below.
      </div>
    </div>

    <div v-if="isAdding" class="add-form">
      <input v-model="newName" placeholder="Agent name (e.g. claude-code)" class="input" />
      <select v-model="newType" class="input">
        <option value="claude-code">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="custom">Custom</option>
      </select>
      <div class="path-row">
        <input v-model="newPath" placeholder="Binary path" class="input flex-1" />
        <button class="btn-sm" @click="browsePath">Browse</button>
      </div>
      <div class="form-actions">
        <button class="btn-primary" @click="addAgent">Add</button>
        <button class="btn-sm" @click="isAdding = false">Cancel</button>
      </div>
    </div>
    <button v-else class="btn-primary" @click="isAdding = true">+ Add Agent</button>
  </div>
</template>

<style scoped>
.settings-panel {
  padding: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}
.settings-header h2 {
  font-size: 1.125rem;
  font-weight: 600;
}
.close-btn {
  font-size: 1.5rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.agent-list {
  margin-bottom: 1rem;
}
.agent-item {
  padding: 0.75rem;
  border: 1px solid var(--color-border, #333);
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
}
.agent-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.agent-name {
  font-weight: 600;
}
.agent-type {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.agent-path {
  font-size: 0.75rem;
  font-family: monospace;
  color: var(--color-text-tertiary, #888);
}
.agent-actions {
  display: flex;
  gap: 0.5rem;
}
.test-result {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--color-error, #f44);
}
.test-result.ok {
  color: var(--color-success, #4f4);
}
.empty-state {
  color: var(--color-text-secondary);
  text-align: center;
  padding: 2rem;
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.path-row {
  display: flex;
  gap: 0.5rem;
}
.input {
  padding: 0.5rem;
  border: 1px solid var(--color-border, #333);
  border-radius: 0.375rem;
  background: var(--color-surface-1, #1a1a1a);
  color: var(--color-text-primary);
  width: 100%;
}
.form-actions {
  display: flex;
  gap: 0.5rem;
}
.btn-sm {
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border, #333);
  background: var(--color-surface-1, #1a1a1a);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.8rem;
}
.btn-sm:hover {
  background: var(--color-surface-2, #2a2a2a);
}
.btn-danger {
  color: var(--color-error, #f44);
  border-color: var(--color-error, #f44);
}
.btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: none;
  background: var(--color-accent, #6366f1);
  color: white;
  cursor: pointer;
  font-size: 0.875rem;
}
.btn-primary:hover {
  opacity: 0.9;
}
</style>