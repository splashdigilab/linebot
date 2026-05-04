<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="Super Admin"
        title="💬 官方帳號管理"
        caption="管理系統中的所有 LINE 官方帳號（Workspace）。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button type="primary" @click="openCreate">+ 建立官方帳號</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">所有官方帳號</span>
            </div>
            <span class="text-xs text-muted">共 {{ workspaces.length }} 筆</span>
          </div>
          <div class="card-section-stack">
            <el-table v-loading="loading" :data="workspaces" size="small">
              <el-table-column label="名稱" min-width="160">
                <template #default="{ row }">{{ row.name }}</template>
              </el-table-column>
              <el-table-column label="所屬組織" min-width="150">
                <template #default="{ row }">
                  <span v-if="orgNameMap[row.organizationId]" class="text-sm">{{ orgNameMap[row.organizationId] }}</span>
                  <span v-else class="text-xs text-muted">未指定</span>
                </template>
              </el-table-column>
              <el-table-column label="ID" min-width="220">
                <template #default="{ row }">
                  <span class="text-xs text-muted sa-uid-mono">{{ row.id }}</span>
                </template>
              </el-table-column>
              <el-table-column label="LINE 設定" width="100" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.channelAccessTokenConfigured && row.channelSecretConfigured" type="success" size="small">已設定</el-tag>
                  <el-tag v-else type="warning" size="small">未完整</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="130" align="right">
                <template #default="{ row }">
                  <el-button size="small" plain @click="openEdit(row)">編輯</el-button>
                  <el-button size="small" plain @click="enterWorkspace(row.id)">進入</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- Create dialog -->
  <el-dialog v-model="showCreate" title="建立官方帳號" width="480px">
    <div class="admin-panel-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="帳號名稱" tight />
        <el-input v-model="form.name" placeholder="例：MyFeel 官方帳號" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="Owner Email" tight />
        <el-input v-model="form.ownerEmail" placeholder="owner@example.com" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="所屬組織" tight />
        <el-select v-model="form.organizationId" placeholder="選填" clearable style="width: 100%">
          <el-option v-for="org in orgs" :key="org.id" :label="org.name" :value="org.id" />
        </el-select>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="LINE Channel Access Token" tight />
        <el-input v-model="form.channelAccessToken" type="password" show-password placeholder="選填" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="LINE Channel Secret" tight />
        <el-input v-model="form.channelSecret" type="password" show-password placeholder="選填" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="LIFF ID" tight />
        <el-input v-model="form.defaultLiffId" placeholder="選填" />
      </div>
    </div>
    <template #footer>
      <el-button @click="showCreate = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="createWorkspace">建立</el-button>
    </template>
  </el-dialog>

  <!-- Edit dialog -->
  <el-dialog v-model="showEdit" title="編輯官方帳號" width="440px">
    <div class="admin-panel-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="帳號名稱" tight />
        <el-input v-model="editForm.name" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="所屬組織" tight />
        <el-select v-model="editForm.organizationId" placeholder="未指定" clearable style="width: 100%">
          <el-option v-for="org in orgs" :key="org.id" :label="org.name" :value="org.id" />
        </el-select>
      </div>
    </div>
    <template #footer>
      <el-button @click="showEdit = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">儲存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'super-admin'], layout: 'super-admin' })
useHead({ title: '官方帳號管理 — Super Admin' })

const { apiFetch } = useSuperAdmin()
const { showToast } = useAdminToast()

const loading = ref(false)
const saving = ref(false)
const workspaces = ref<any[]>([])
const orgs = ref<any[]>([])
const showCreate = ref(false)
const showEdit = ref(false)
const editTarget = ref<any>(null)

const orgNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(orgs.value.map(o => [o.id, o.name])),
)

const form = reactive({
  name: '',
  ownerEmail: '',
  organizationId: '',
  channelAccessToken: '',
  channelSecret: '',
  defaultLiffId: '',
})

const editForm = reactive({ name: '', organizationId: '' })

async function load() {
  loading.value = true
  try {
    [workspaces.value, orgs.value] = await Promise.all([
      apiFetch<any[]>('/api/admin/super/workspaces'),
      apiFetch<any[]>('/api/admin/super/organizations'),
    ])
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.name = ''
  form.ownerEmail = ''
  form.organizationId = ''
  form.channelAccessToken = ''
  form.channelSecret = ''
  form.defaultLiffId = ''
  showCreate.value = true
}

function openEdit(row: any) {
  editTarget.value = row
  editForm.name = row.name
  editForm.organizationId = row.organizationId ?? ''
  showEdit.value = true
}

async function createWorkspace() {
  if (!form.name.trim()) return showToast('請輸入帳號名稱', 'error')
  if (!form.ownerEmail.trim()) return showToast('請輸入 Owner Email', 'error')
  saving.value = true
  try {
    await apiFetch('/api/admin/super/workspaces', {
      method: 'POST',
      body: {
        name: form.name,
        ownerEmail: form.ownerEmail,
        organizationId: form.organizationId || null,
        channelAccessToken: form.channelAccessToken || undefined,
        channelSecret: form.channelSecret || undefined,
        defaultLiffId: form.defaultLiffId || undefined,
      },
    })
    showToast('官方帳號已建立', 'success')
    showCreate.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '建立失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (!editForm.name.trim()) return showToast('名稱不能為空', 'error')
  saving.value = true
  try {
    await apiFetch(`/api/admin/super/workspaces/${editTarget.value.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        organizationId: editForm.organizationId || null,
      },
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

function enterWorkspace(id: string) {
  navigateTo(`/admin/${id}/conversation-stats`)
}

onMounted(load)
</script>
