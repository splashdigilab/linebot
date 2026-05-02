<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="👥 成員管理"
        caption="邀請成員加入此官方帳號，並設定其角色與權限。"
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
                  <div>{{ row.invitedEmail || row.uid }}</div>
                  <div class="text-xs text-muted">{{ row.uid }}</div>
                </template>
              </el-table-column>
              <el-table-column label="角色" width="120">
                <template #default="{ row }">
                  <el-tag :type="roleTagType(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="canWrite" label="操作" width="160" align="right">
                <template #default="{ row }">
                  <template v-if="row.role !== 'owner'">
                    <el-select
                      :model-value="row.role"
                      size="small"
                      style="width: 90px; margin-right: 4px"
                      @change="(val: string) => changeRole(row.uid, val)"
                    >
                      <el-option label="管理員" value="admin" />
                      <el-option label="客服" value="agent" />
                      <el-option label="觀察者" value="viewer" />
                    </el-select>
                    <el-button size="small" type="danger" plain @click="removeMember(row.uid)">移除</el-button>
                  </template>
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
        <el-input v-model="inviteEmail" placeholder="成員的 Firebase 登入 Email" />
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
}

function roleLabel(role: string) { return ROLE_LABELS[role] ?? role }
function roleTagType(role: string) {
  if (role === 'owner') return 'danger'
  if (role === 'admin') return 'warning'
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
    await apiFetch(`/api/admin/workspaces/${workspaceId.value}/members`, {
      method: 'POST',
      body: { email: inviteEmail.value.trim(), role: inviteRole.value },
    })
    showToast('已邀請成員', 'success')
    showInvite.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '邀請失敗', 'error')
  } finally {
    inviting.value = false
  }
}

async function changeRole(uid: string, role: string) {
  try {
    await apiFetch(`/api/admin/workspaces/${workspaceId.value}/members/${uid}`, {
      method: 'PUT',
      body: { role },
    })
    showToast('角色已更新', 'success')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失敗', 'error')
  }
}

async function removeMember(uid: string) {
  if (!confirm('確定移除此成員？')) return
  try {
    await apiFetch(`/api/admin/workspaces/${workspaceId.value}/members/${uid}`, {
      method: 'DELETE',
    })
    showToast('已移除成員', 'success')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '移除失敗', 'error')
  }
}

onMounted(load)
</script>
