<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="👥 成員管理"
        caption="以 Email 邀請成員（無需對方已註冊 Firebase）；已註冊者會直接加入，尚未註冊者待建立帳號後首次登入即生效。若官方帳號已綁定組織，列表底部會一併列出「組織擁有者（登記）」與「組織管理員」帳號（僅供檢視；變更請由 Super Admin 組織管理處理）。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button v-if="canWrite" type="primary" @click="openInvite">邀請成員</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">成員列表</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div v-if="loading" class="tags-loading">
              <div class="spinner" />
              <span>載入中…</span>
            </div>
            <el-table v-else :data="members" size="small">
              <el-table-column label="Email / UID">
                <template #default="{ row }">
                  <div>{{ row.invitedEmail || row.uid || '—' }}</div>
                  <div v-if="row.pendingInvite" class="text-xs text-muted">待加入（尚未註冊 Firebase）</div>
                  <div v-else-if="row.readOnly && row.linkedSource === 'org_member'" class="text-xs text-muted">組織管理員（組織內全部官方帳號）</div>
                  <div v-else-if="row.readOnly && row.linkedSource === 'org_owner'" class="text-xs text-muted">組織擁有者（登記 Email）</div>
                  <div v-else-if="row.uid" class="text-xs text-muted">{{ row.uid }}</div>
                </template>
              </el-table-column>
              <el-table-column label="角色" width="120">
                <template #default="{ row }">
                  <el-tag :type="roleTagType(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="canWrite" label="操作" width="160" align="right">
                <template #default="{ row }">
                  <template v-if="!row.readOnly && row.role !== 'owner'">
                    <el-select
                      :model-value="row.role"
                      size="small"
                      style="width: 90px; margin-right: 4px"
                      @change="(val: string) => changeRole(row, val)"
                    >
                      <el-option label="管理員" value="admin" />
                      <el-option label="客服" value="agent" />
                      <el-option label="觀察者" value="viewer" />
                    </el-select>
                    <el-button size="small" type="danger" plain @click="removeMember(row)">移除</el-button>
                  </template>
                  <span v-else-if="row.readOnly" class="text-xs text-muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- Invite dialog -->
  <el-dialog v-model="showInvite" title="邀請成員" width="400px">
    <div class="admin-panel-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="Email" tight />
        <el-input v-model="inviteEmail" placeholder="對方 Email（可不已有 Firebase 帳號）" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="角色" tight />
        <el-select v-model="inviteRole" style="width: 100%">
          <el-option label="管理員" value="admin" />
          <el-option label="客服" value="agent" />
          <el-option label="觀察者" value="viewer" />
        </el-select>
      </div>
    </div>
    <template #footer>
      <el-button @click="showInvite = false">取消</el-button>
      <el-button type="primary" :loading="inviting" @click="invite">邀請</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })
useHead({ title: '成員管理 — LINE Bot 管理系統' })

const { showToast } = useAdminToast()
const { workspaceId, apiFetch, canWrite } = useWorkspace()

const loading = ref(false)
const members = ref<any[]>([])
const showInvite = ref(false)
const inviteEmail = ref('')
const inviteRole = ref('agent')
const inviting = ref(false)

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
  org_admin: '組織管理員',
  org_owner: '組織擁有者（登記）',
}

function roleLabel(role: string) { return ROLE_LABELS[role] ?? role }
function roleTagType(role: string) {
  if (role === 'owner' || role === 'org_owner') return 'danger'
  if (role === 'admin' || role === 'org_admin') return 'warning'
  if (role === 'agent') return 'success'
  return 'info'
}

function openInvite() {
  inviteEmail.value = ''
  inviteRole.value = 'agent'
  showInvite.value = true
}

async function load() {
  loading.value = true
  try {
    members.value = await apiFetch<any[]>(
      `/api/admin/workspaces/${workspaceId.value}/members`,
    )
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  } finally {
    loading.value = false
  }
}

async function invite() {
  if (!inviteEmail.value.trim()) return showToast('請輸入 Email', 'error')
  inviting.value = true
  try {
    const res = await apiFetch<{ pending?: boolean }>(
      `/api/admin/workspaces/${workspaceId.value}/members`,
      {
        method: 'POST',
        body: { email: inviteEmail.value.trim(), role: inviteRole.value },
      },
    )
    showToast(
      res.pending
        ? '已送出邀請（對方註冊 Firebase 後首次登入即可加入）'
        : '已邀請成員',
      'success',
    )
    showInvite.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '邀請失敗', 'error')
  } finally {
    inviting.value = false
  }
}

async function changeRole(row: any, role: string) {
  try {
    if (row.pendingInvite && row.inviteId) {
      await apiFetch(`/api/admin/workspaces/${workspaceId.value}/member-invites/${row.inviteId}`, {
        method: 'PUT',
        body: { role },
      })
    }
    else {
      await apiFetch(`/api/admin/workspaces/${workspaceId.value}/members/${row.uid}`, {
        method: 'PUT',
        body: { role },
      })
    }
    showToast('角色已更新', 'success')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失敗', 'error')
  }
}

async function removeMember(row: any) {
  const label = row.pendingInvite ? '此邀請' : '此成員'
  if (!confirm(`確定移除${label}？`)) return
  try {
    if (row.pendingInvite && row.inviteId) {
      await apiFetch(`/api/admin/workspaces/${workspaceId.value}/member-invites/${row.inviteId}`, {
        method: 'DELETE',
      })
    }
    else {
      await apiFetch(`/api/admin/workspaces/${workspaceId.value}/members/${row.uid}`, {
        method: 'DELETE',
      })
    }
    showToast(row.pendingInvite ? '已取消邀請' : '已移除成員', 'success')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '移除失敗', 'error')
  }
}

onMounted(load)
</script>
