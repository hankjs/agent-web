<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type User } from '../composables/api'

const users = ref<User[]>([])
const newUsername = ref('')
const newPassword = ref('')
const newCanAdmin = ref(false)
const newCanClient = ref(true)
const showForm = ref(false)

async function load() {
  users.value = await api.listUsers()
}

async function createUser() {
  if (!newUsername.value || !newPassword.value) return
  await api.createUser(newUsername.value, newPassword.value, newCanAdmin.value, newCanClient.value)
  newUsername.value = ''
  newPassword.value = ''
  newCanAdmin.value = false
  newCanClient.value = true
  showForm.value = false
  await load()
}

async function togglePermission(user: User, field: 'can_login_admin' | 'can_login_client') {
  const update = { [field]: !user[field] }
  await api.updateUser(user.id, update)
  await load()
}

async function deleteUser(user: User) {
  if (!confirm(`确定删除用户 "${user.username}"？`)) return
  await api.deleteUser(user.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-lg font-semibold text-text-primary">用户管理</h1>
      <button
        @click="showForm = !showForm"
        class="text-[13px] text-accent hover:text-accent-hover transition-colors"
      >{{ showForm ? '取消' : '+ 新建用户' }}</button>
    </div>

    <div v-if="showForm" class="mb-8 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <input
          v-model="newUsername"
          placeholder="用户名"
          class="bg-transparent border border-border rounded-md px-3 py-2 text-[13px] placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
        />
        <input
          v-model="newPassword"
          type="password"
          placeholder="密码"
          class="bg-transparent border border-border rounded-md px-3 py-2 text-[13px] placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
        />
      </div>
      <div class="flex items-center gap-5 text-[13px] text-text-secondary">
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input v-model="newCanAdmin" type="checkbox" class="rounded" />
          管理后台
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input v-model="newCanClient" type="checkbox" class="rounded" />
          客户端
        </label>
      </div>
      <button
        @click="createUser"
        class="px-3.5 py-1.5 bg-text-primary text-surface-raised text-[13px] rounded-md hover:opacity-80 transition-opacity"
      >创建</button>
    </div>

    <div class="text-[12px] text-text-tertiary grid grid-cols-[1fr_80px_80px_60px] gap-2 px-2 pb-2 border-b border-border-subtle font-medium">
      <span>用户名</span>
      <span class="text-center">管理后台</span>
      <span class="text-center">客户端</span>
      <span></span>
    </div>

    <div class="divide-y divide-border-subtle">
      <div
        v-for="user in users"
        :key="user.id"
        class="grid grid-cols-[1fr_80px_80px_60px] gap-2 items-center px-2 py-2.5"
      >
        <span class="text-[13px] text-text-primary">{{ user.username }}</span>
        <span class="text-center">
          <button
            @click="togglePermission(user, 'can_login_admin')"
            class="text-[12px] px-2 py-0.5 rounded transition-colors"
            :class="user.can_login_admin ? 'bg-active text-text-primary' : 'text-text-tertiary hover:bg-hover'"
          >{{ user.can_login_admin ? '是' : '否' }}</button>
        </span>
        <span class="text-center">
          <button
            @click="togglePermission(user, 'can_login_client')"
            class="text-[12px] px-2 py-0.5 rounded transition-colors"
            :class="user.can_login_client ? 'bg-active text-text-primary' : 'text-text-tertiary hover:bg-hover'"
          >{{ user.can_login_client ? '是' : '否' }}</button>
        </span>
        <span class="text-right">
          <button
            @click="deleteUser(user)"
            class="text-[12px] text-text-tertiary hover:text-red-500 transition-colors"
          >删除</button>
        </span>
      </div>
    </div>

    <div v-if="!users.length" class="py-12 text-center text-[13px] text-text-tertiary">暂无用户</div>
  </div>
</template>
