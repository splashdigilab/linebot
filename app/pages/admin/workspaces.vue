<template>
  <div class="ws-select-page">
    <div class="ws-select-card">
      <div class="ws-select-logo">
        <span class="logo-icon">💬</span>
        <h1>LINE Bot 管理系統</h1>
      </div>
      <p class="ws-select-sub">選擇要管理的官方帳號</p>

      <div v-if="loading" class="ws-select-loading">
        <div class="spinner" />
        <span>載入中…</span>
      </div>

      <template v-else-if="workspaceList.length === 0">
        <div class="ws-select-empty">
          <p>你目前沒有任何官方帳號的存取權限。</p>
          <p class="text-xs text-muted">請聯繫管理員邀請你加入。</p>
        </div>
        <div class="ws-select-footer">
          <el-button @click="logout">登出</el-button>
        </div>
      </template>

      <template v-else>
        <div class="ws-groups">
          <div v-for="group in groupedWorkspaces" :key="group.key">
            <div class="ws-group-header">
              <span>🏢</span>
              <span>{{ group.orgName }}</span>
            </div>
            <div class="ws-group-items">
              <button
                v-for="ws in group.items"
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
          </div>
        </div>

        <NuxtLink v-if="isSuperAdmin" to="/admin/super" class="ws-super-admin-link">
          <span>⚙️</span>
          <span>Super Admin 後台</span>
          <span class="ws-item-arrow">→</span>
        </NuxtLink>

        <div class="ws-select-footer">
          <el-button @click="logout">登出</el-button>
        </div>
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
const { $auth } = useNuxtApp()

const loading = ref(true)
const workspaceList = ref<WorkspaceItem[]>([])
const isSuperAdmin = ref(false)

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role
}

const groupedWorkspaces = computed(() => {
  const groups: Record<string, { orgName: string; items: WorkspaceItem[] }> = {}

  for (const ws of workspaceList.value) {
    const key = ws.organizationId ?? '__none__'
    if (!groups[key]) {
      groups[key] = {
        orgName: ws.organizationName ?? (ws.organizationId ? ws.organizationId : '未歸屬組織'),
        items: [],
      }
    }
    groups[key].items.push(ws)
  }

  return Object.entries(groups)
    .sort(([a], [b]) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return 0
    })
    .map(([key, group]) => ({ key, ...group }))
})

async function enter(workspaceId: string) {
  await navigateTo(`/admin/${workspaceId}`)
}

onMounted(async () => {
  try {
    const [list, tokenResult] = await Promise.all([
      loadWorkspaceList(),
      $auth.currentUser?.getIdTokenResult(),
    ])
    workspaceList.value = list
    isSuperAdmin.value = tokenResult?.claims.superAdmin === true

    if (!isSuperAdmin.value && list.length === 1) {
      await enter(list[0].workspaceId)
    }
  } catch {
    workspaceList.value = []
  } finally {
    loading.value = false
  }
})
</script>
