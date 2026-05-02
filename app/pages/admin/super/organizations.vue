<template>
  <div class="sa-page">
    <div class="sa-page-header">
      <div>
        <h1 class="sa-page-title">🏢 組織管理</h1>
        <p class="sa-page-caption">管理系統中的所有組織，包含方案、管理員與停用狀態。</p>
      </div>
      <el-button type="primary" @click="openCreate">+ 建立組織</el-button>
    </div>

    <div class="sa-card">
      <div class="sa-card-header">
        <span class="sa-card-title">所有組織</span>
        <span class="text-xs text-muted">共 {{ orgs.length }} 筆</span>
      </div>
      <div class="sa-table-wrap">
        <el-table v-loading="loading" :data="orgs" size="small">
          <el-table-column label="組織名稱" min-width="160">
            <template #default="{ row }">
              <span :class="{ 'text-muted': row.disabled }">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="方案" width="100">
            <template #default="{ row }">
              <span :class="`sa-plan-${row.plan}`">{{ PLAN_LABELS[row.plan] ?? row.plan }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Owner Email" min-width="180">
            <template #default="{ row }">
              <span class="text-sm">{{ row.ownerEmail }}</span>
            </template>
          </el-table-column>
          <el-table-column label="狀態" width="80">
            <template #default="{ row }">
              <el-tag :type="row.disabled ? 'danger' : 'success'" size="small">
                {{ row.disabled ? '停用' : '正常' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220" align="right">
            <template #default="{ row }">
              <el-button size="small" plain @click="openMembers(row)">管理員</el-button>
              <el-button size="small" plain @click="openEdit(row)">編輯</el-button>
              <el-button
                size="small"
                :type="row.disabled ? 'success' : 'warning'"
                plain
                @click="toggleDisable(row)"
              >
                {{ row.disabled ? '啟用' : '停用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>

  <!-- Create dialog -->
  <el-dialog v-model="showCreate" title="建立組織" width="440px">
    <div class="admin-panel-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="組織名稱" tight />
        <el-input v-model="form.name" placeholder="例：MyFeel 股份有限公司" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="方案" tight />
        <el-select v-model="form.plan" style="width: 100%">
          <el-option v-for="p in PLAN_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="Owner Email" tight />
        <el-input v-model="form.ownerEmail" placeholder="owner@example.com" />
      </div>
    </div>
    <template #footer>
      <el-button @click="showCreate = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="createOrg">建立</el-button>
    </template>
  </el-dialog>

  <!-- Edit dialog -->
  <el-dialog v-model="showEdit" title="編輯組織" width="440px">
    <div class="admin-panel-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="組織名稱" tight />
        <el-input v-model="editForm.name" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="方案" tight />
        <el-select v-model="editForm.plan" style="width: 100%">
          <el-option v-for="p in PLAN_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </div>
    </div>
    <template #footer>
      <el-button @click="showEdit = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">儲存</el-button>
    </template>
  </el-dialog>

  <!-- Members dialog -->
  <el-dialog
    v-model="showMembers"
    :title="`組織管理員：${membersTarget?.name ?? ''}`"
    width="520px"
  >
    <div class="admin-panel-stack">
      <!-- 新增管理員 -->
      <div class="sa-members-add-row">
        <el-input
          v-model="newMemberEmail"
          placeholder="輸入 Email 新增組織管理員"
          style="flex: 1"
          @keyup.enter="addMember"
        />
        <el-button type="primary" :loading="memberSaving" @click="addMember">新增</el-button>
      </div>

      <!-- 管理員列表 -->
      <div v-if="membersLoading" class="ws-select-loading">
        <div class="spinner" />
        <span>載入中…</span>
      </div>
      <el-table v-else :data="members" size="small">
        <el-table-column label="Email / 名稱" min-width="200">
          <template #default="{ row }">
            <div class="text-sm font-bold">{{ row.email }}</div>
            <div v-if="row.displayName" class="text-xs text-muted">{{ row.displayName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="80">
          <template #default>
            <el-tag type="warning" size="small">管理員</el-tag>
          </template>
        </el-table-column>
        <el-table-column width="70" align="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click="removeMember(row.id)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <p v-if="!membersLoading && members.length === 0" class="text-sm text-muted">
        尚未指派任何組織管理員。
      </p>
    </div>
    <template #footer>
      <el-button @click="showMembers = false">關閉</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'super-admin'], layout: 'super-admin' })
useHead({ title: '組織管理 — Super Admin' })

const { apiFetch } = useSuperAdmin()
const { showToast } = useAdminToast()

const loading = ref(false)
const saving = ref(false)
const orgs = ref<any[]>([])

const showCreate = ref(false)
const showEdit = ref(false)
const editTarget = ref<any>(null)

const showMembers = ref(false)
const membersTarget = ref<any>(null)
const members = ref<any[]>([])
const membersLoading = ref(false)
const memberSaving = ref(false)
const newMemberEmail = ref('')

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise',
}
const PLAN_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

const form = reactive({ name: '', plan: 'free', ownerEmail: '' })
const editForm = reactive({ name: '', plan: 'free' })

async function load() {
  loading.value = true
  try {
    orgs.value = await apiFetch<any[]>('/api/admin/super/organizations')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.name = ''
  form.plan = 'free'
  form.ownerEmail = ''
  showCreate.value = true
}

function openEdit(row: any) {
  editTarget.value = row
  editForm.name = row.name
  editForm.plan = row.plan
  showEdit.value = true
}

async function openMembers(row: any) {
  membersTarget.value = row
  newMemberEmail.value = ''
  showMembers.value = true
  await loadMembers(row.id)
}

async function loadMembers(orgId: string) {
  membersLoading.value = true
  try {
    members.value = await apiFetch<any[]>(`/api/admin/super/organizations/${orgId}/members`)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  } finally {
    membersLoading.value = false
  }
}

async function createOrg() {
  if (!form.name.trim()) return showToast('請輸入組織名稱', 'error')
  if (!form.ownerEmail.trim()) return showToast('請輸入 Owner Email', 'error')
  saving.value = true
  try {
    await apiFetch('/api/admin/super/organizations', {
      method: 'POST',
      body: { name: form.name, plan: form.plan, ownerEmail: form.ownerEmail },
    })
    showToast('組織已建立', 'success')
    showCreate.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '建立失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (!editForm.name.trim()) return showToast('組織名稱不能為空', 'error')
  saving.value = true
  try {
    await apiFetch(`/api/admin/super/organizations/${editTarget.value.id}`, {
      method: 'PATCH',
      body: { name: editForm.name, plan: editForm.plan },
    })
    showToast('已更新', 'success')
    showEdit.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleDisable(row: any) {
  const action = row.disabled ? '啟用' : '停用'
  if (!confirm(`確定要${action}「${row.name}」？`)) return
  try {
    await apiFetch(`/api/admin/super/organizations/${row.id}/disable`, {
      method: 'POST',
      body: { disabled: !row.disabled },
    })
    showToast(`已${action}`, 'success')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  }
}

async function addMember() {
  const email = newMemberEmail.value.trim()
  if (!email) return
  memberSaving.value = true
  try {
    await apiFetch(`/api/admin/super/organizations/${membersTarget.value.id}/members`, {
      method: 'POST',
      body: { email },
    })
    showToast('已新增組織管理員', 'success')
    newMemberEmail.value = ''
    await loadMembers(membersTarget.value.id)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '新增失敗', 'error')
  } finally {
    memberSaving.value = false
  }
}

async function removeMember(docId: string) {
  if (!confirm('確定移除此管理員？')) return
  try {
    await apiFetch(`/api/admin/super/organizations/${membersTarget.value.id}/members/${docId}`, {
      method: 'DELETE',
    })
    showToast('已移除', 'success')
    await loadMembers(membersTarget.value.id)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '移除失敗', 'error')
  }
}

onMounted(load)
</script>
