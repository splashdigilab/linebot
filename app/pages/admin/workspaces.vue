<template>
  <div class="ws-select-page">
    <div class="ws-select-card">
      <div class="ws-select-logo">
        <span>💬</span>
        <h1>LINE Bot 管理系統</h1>
      </div>
      <p class="ws-select-sub">選擇要管理的官方帳號</p>

      <div v-if="loading" class="ws-select-loading">
        <div class="spinner" />
        <span>載入中…</span>
      </div>

      <div v-else-if="workspaceList.length === 0" class="ws-select-empty">
        <p>你目前沒有任何官方帳號的存取權限。</p>
        <p class="text-xs text-muted">請聯繫管理員邀請你加入。</p>
        <el-button class="ws-select-logout" @click="logout">登出</el-button>
      </div>

      <template v-else>
        <div class="ws-list">
          <button
            v-for="ws in workspaceList"
            :key="ws.workspaceId"
            class="ws-item"
            @click="enter(ws.workspaceId)"
          >
            <div class="ws-item-icon">💬</div>
            <div class="ws-item-info">
              <div class="ws-item-name">{{ ws.name }}</div>
              <div class="ws-item-role">{{ roleLabel(ws.role) }}</div>
            </div>
            <span class="ws-item-arrow">→</span>
          </button>
        </div>
        <el-button class="ws-select-logout" @click="logout">登出</el-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WorkspaceItem } from '~~/app/composables/useWorkspace'

definePageMeta({ middleware: 'auth', layout: false })
useHead({ title: '選擇官方帳號 — LINE Bot 管理系統' })

const { logout } = useAuth()
const { loadWorkspaceList } = useWorkspace()

const loading = ref(true)
const workspaceList = ref<WorkspaceItem[]>([])

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role
}

async function enter(workspaceId: string) {
  await navigateTo(`/admin/${workspaceId}`)
}

onMounted(async () => {
  try {
    workspaceList.value = await loadWorkspaceList()
    // 只有一個 workspace 時直接跳入
    if (workspaceList.value.length === 1) {
      await enter(workspaceList.value[0].workspaceId)
    }
  } catch {
    workspaceList.value = []
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.ws-select-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg, #f5f7fa);
  padding: 2rem;
}
.ws-select-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.ws-select-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.ws-select-logo span { font-size: 2rem; }
.ws-select-logo h1 { font-size: 1.25rem; font-weight: 700; margin: 0; }
.ws-select-sub { color: var(--color-text-muted, #888); font-size: 0.9rem; margin: 0; }
.ws-select-loading { display: flex; align-items: center; gap: 0.5rem; color: #888; }
.ws-select-empty { display: flex; flex-direction: column; gap: 0.5rem; }
.ws-list { display: flex; flex-direction: column; gap: 0.5rem; }
.ws-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
  width: 100%;
}
.ws-item:hover { border-color: #409eff; background: #f0f7ff; }
.ws-item-icon { font-size: 1.5rem; flex-shrink: 0; }
.ws-item-info { flex: 1; min-width: 0; }
.ws-item-name { font-weight: 600; font-size: 0.95rem; }
.ws-item-role { font-size: 0.75rem; color: #888; }
.ws-item-arrow { color: #aaa; font-size: 1rem; }
.ws-select-logout { align-self: center; }
</style>
