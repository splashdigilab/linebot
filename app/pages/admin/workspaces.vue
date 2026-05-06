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

      <template v-else-if="groupedWorkspaces.length === 0">
        <div class="ws-select-empty">
          <p>你目前沒有任何官方帳號的存取權限。</p>
          <p class="text-xs text-muted">請聯繫管理員邀請你加入。</p>
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

      <template v-else>
        <div class="ws-groups">
          <div v-for="group in groupedWorkspaces" :key="group.key">
            <div class="ws-group-header">
              <span>🏢</span>
              <span class="ws-group-name">{{ group.orgName }}</span>
              <button
                v-if="group.canCreate"
                class="ws-group-add-btn"
                :title="`在「${group.orgName}」新增官方帳號`"
                @click="openCreate(group)"
              >
                +
              </button>
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

              <!-- 無 workspace 時的提示 -->
              <div v-if="group.items.length === 0" class="ws-group-empty">
                此組織尚無官方帳號，點 + 建立第一個。
              </div>
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

  <!-- 新增官方帳號 dialog -->
  <el-dialog v-model="showCreate" title="新增官方帳號" width="420px" @closed="resetCreate">
    <div class="ws-create-dialog-body">
      <div v-if="quotaLoading" class="ws-select-loading">
        <div class="spinner" />
        <span>查詢額度中…</span>
      </div>
      <div v-else-if="quotaInfo" class="ws-quota-row">
        <span class="ws-quota-label">已使用額度</span>
        <span class="ws-quota-value" :class="{ 'ws-quota-full': quotaInfo.remaining === 0 }">
          {{ quotaInfo.used }} / {{ quotaInfo.limit === Infinity ? '無限制' : quotaInfo.limit }}
        </span>
        <el-tag v-if="quotaInfo.remaining === 0" type="warning" size="small">已達上限</el-tag>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="官方帳號名稱" tight />
        <el-input
          v-model="createForm.name"
          placeholder="例：MyFeel 官方帳號"
          :disabled="quotaInfo?.remaining === 0"
          @keyup.enter="submitCreate"
        />
      </div>
    </div>
    <template #footer>
      <el-button @click="showCreate = false">取消</el-button>
      <el-button
        type="primary"
        :loading="createSaving"
        :disabled="!createForm.name.trim() || quotaInfo?.remaining === 0"
        @click="submitCreate"
      >
        建立
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { WorkspaceItem } from '~~/app/composables/useWorkspace'

definePageMeta({ middleware: 'auth', layout: false })
useHead({ title: '選擇官方帳號 — LINE Bot 管理系統' })

const { logout } = useAuth()
const { loadWorkspaceList, orgAdminOf } = useWorkspace()
const { $auth } = useNuxtApp()

const loading = ref(true)
const workspaceList = ref<WorkspaceItem[]>([])
const isSuperAdmin = ref(false)

const visibleWorkspaceList = computed(() =>
  workspaceList.value.filter(ws => ws.workspaceId !== 'default'),
)

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role
}

interface OrgGroup {
  key: string
  orgName: string
  orgId: string | null
  items: WorkspaceItem[]
  canCreate: boolean
}

const groupedWorkspaces = computed<OrgGroup[]>(() => {
  const groups: Record<string, OrgGroup> = {}

  // 從 workspace 列表建立群組
  for (const ws of visibleWorkspaceList.value) {
    const key = ws.organizationId ?? '__none__'
    if (!groups[key]) {
      const orgId = ws.organizationId ?? null
      groups[key] = {
        key,
        orgId,
        orgName: ws.organizationName ?? (orgId ?? '未歸屬組織'),
        items: [],
        canCreate: orgId !== null && orgAdminOf.value.some((o: { id: string }) => o.id === orgId),
      }
    }
    groups[key].items.push(ws)
  }

  // 補入 org admin 管轄但目前還沒有 workspace 的組織（空白狀態入口）
  for (const org of orgAdminOf.value) {
    if (!groups[org.id]) {
      groups[org.id] = {
        key: org.id,
        orgId: org.id,
        orgName: org.name,
        items: [],
        canCreate: true,
      }
    }
  }

  return Object.values(groups).sort((a, b) => {
    if (a.key === '__none__') return 1
    if (b.key === '__none__') return -1
    return 0
  })
})

async function enter(workspaceId: string) {
  await navigateTo(`/admin/${workspaceId}/conversation-stats`)
}

// ── 新增官方帳號 ──────────────────────────────────────────────────

const showCreate = ref(false)
const createSaving = ref(false)
const quotaLoading = ref(false)
const createTargetOrgId = ref<string | null>(null)
const createForm = reactive({ name: '' })

interface QuotaInfo { plan: string; limit: number; used: number; remaining: number }
const quotaInfo = ref<QuotaInfo | null>(null)

async function openCreate(group: OrgGroup) {
  createTargetOrgId.value = group.orgId
  createForm.name = ''
  quotaInfo.value = null
  showCreate.value = true

  if (group.orgId) {
    quotaLoading.value = true
    try {
      const token = await $auth.currentUser?.getIdToken()
      quotaInfo.value = await $fetch<QuotaInfo>(`/api/admin/org/${group.orgId}/quota`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    catch { /* quota 顯示失敗不阻擋建立 */ }
    finally {
      quotaLoading.value = false
    }
  }
}

function resetCreate() {
  createForm.name = ''
  quotaInfo.value = null
  createTargetOrgId.value = null
}

async function submitCreate() {
  if (!createForm.name.trim() || !createTargetOrgId.value) return
  createSaving.value = true
  try {
    const token = await $auth.currentUser?.getIdToken()
    await $fetch(`/api/admin/org/${createTargetOrgId.value}/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name: createForm.name.trim() },
    })
    showCreate.value = false
    workspaceList.value = await loadWorkspaceList()
  }
  catch (e: any) {
    const msg = e?.data?.statusMessage || e?.message || '建立失敗'
    alert(msg)
  }
  finally {
    createSaving.value = false
  }
}

// ── Init ──────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const [list, tokenResult] = await Promise.all([
      loadWorkspaceList(),
      $auth.currentUser?.getIdTokenResult(),
    ])
    workspaceList.value = list
    isSuperAdmin.value = tokenResult?.claims.superAdmin === true

    if (!isSuperAdmin.value && visibleWorkspaceList.value.length === 1 && orgAdminOf.value.length === 0) {
      await enter(visibleWorkspaceList.value[0].workspaceId)
    }
  }
  catch {
    workspaceList.value = []
  }
  finally {
    loading.value = false
  }
})
</script>
