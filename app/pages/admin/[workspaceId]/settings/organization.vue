<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="🏢 組織資訊"
        caption="查看組織方案與基本資訊。"
      />
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div v-if="loading" class="tags-loading">
          <div class="spinner" />
          <span>載入中…</span>
        </div>
        <template v-else>
          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">🏢 組織</span>
              </div>
            </div>
            <div class="card-section-stack">
              <div class="admin-field-group">
                <AdminFieldLabel text="組織名稱" tight />
                <div class="text-sm">{{ org.name || '—' }}</div>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel text="方案" tight />
                <el-tag :type="planTagType(org.plan)">{{ planLabel(org.plan) }}</el-tag>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel text="組織 ID" tight />
                <div class="text-xs text-muted font-mono">{{ org.id || '—' }}</div>
              </div>
            </div>
          </div>

          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">💬 目前 Workspace</span>
              </div>
            </div>
            <div class="card-section-stack">
              <div class="admin-field-group">
                <AdminFieldLabel text="Workspace ID" tight />
                <div class="text-xs text-muted font-mono">{{ workspaceId }}</div>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel text="你的角色" tight />
                <el-tag :type="roleTagType(currentRole)">{{ roleLabel(currentRole) }}</el-tag>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })
useHead({ title: '組織設定 — LINE Bot 管理系統' })

const { workspaceId, currentRole, apiFetch } = useWorkspace()

const loading = ref(false)
const org = ref<any>({ id: '', name: '', plan: 'free' })

const PLAN_LABELS: Record<string, string> = {
  free: '免費版',
  starter: '入門版',
  pro: '專業版',
  enterprise: '企業版',
}
const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}

function planLabel(plan: string) { return PLAN_LABELS[plan] ?? plan }
function planTagType(plan: string) {
  if (plan === 'enterprise') return 'danger'
  if (plan === 'pro') return 'warning'
  if (plan === 'starter') return 'success'
  return 'info'
}
function roleLabel(role: string | null) { return role ? (ROLE_LABELS[role] ?? role) : '—' }
function roleTagType(role: string | null) {
  if (role === 'owner') return 'danger'
  if (role === 'admin') return 'warning'
  if (role === 'agent') return 'success'
  return 'info'
}

async function load() {
  loading.value = true
  try {
    // Workspace doc contains organizationId
    const ws = await apiFetch<any>(`/api/admin/line-workspace`)
    // For now show workspace info — org details require super admin
    org.value = { id: ws.id ?? workspaceId.value, name: ws.name ?? '', plan: 'free' }
  } catch {
    org.value = { id: workspaceId.value, name: '', plan: 'free' }
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
