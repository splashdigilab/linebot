<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="LINE 連線"
        title="🔐 LINE OA 憑證"
        caption="登入後可設定 Channel Token／Secret 與預設 LIFF；未填的敏感欄位將保留原值。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button :loading="loading" @click="load">重新載入</el-button>
        <el-button type="primary" :loading="saving" @click="save">儲存</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⚙️ 工作區設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              資料儲存在 Firestore <code class="text-muted">workspaces/default</code>。
              若未在這裡設定 Token／Secret，系統會使用部署環境的環境變數。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="顯示名稱" tight />
              <el-input v-model="form.name" placeholder="例：主要官方帳號" />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel tight>
                預設 LIFF ID <span class="text-muted">（活動未填時可 fallback）</span>
              </AdminFieldLabel>
              <el-input
                v-model="form.defaultLiffId"
                placeholder="例：2007123456-AbCdEfGh"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel tight>
                Channel Access Token <span class="text-muted">（留空表示不變更已存值）</span>
              </AdminFieldLabel>
              <el-input
                v-model="form.channelAccessToken"
                type="password"
                show-password
                placeholder="若要更新請貼上完整 Token"
                autocomplete="off"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel tight>
                Channel Secret <span class="text-muted">（留空表示不變更已存值）</span>
              </AdminFieldLabel>
              <el-input
                v-model="form.channelSecret"
                type="password"
                show-password
                placeholder="若要更新請貼上完整 Secret"
                autocomplete="off"
              />
            </div>
            <div v-if="meta.savedInFirestore" class="text-xs text-muted">
              目前狀態：Access Token {{ tokenStatusLabel(meta.channelAccessTokenConfigured, meta.channelAccessTokenSuffix) }}；
              Secret {{ tokenStatusLabel(meta.channelSecretConfigured, meta.channelSecretSuffix) }}。
            </div>
            <div v-else class="text-xs text-muted">
              尚未寫入 Firestore；{{ meta.envFallbackAvailable ? '目前使用環境變數中的憑證。' : '環境變數亦未設定完整憑證，請儲存 Token 與 Secret。' }}
            </div>
          </div>
        </div>

        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🧹 進階</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              刪除 Firestore 憑證後，系統會改回只讀取部署環境變數（不影響 LINE Developers 上的設定）。
            </p>
            <el-button type="danger" plain :loading="clearing" @click="clearWorkspace">
              移除 Firestore 憑證
            </el-button>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

useHead({
  title: 'LINE 連線設定 — LINE Bot 管理系統',
})

type WorkspaceGet = {
  id: string
  savedInFirestore: boolean
  name: string
  defaultLiffId: string
  /** 實際 CTA fallback（含 env） */
  effectiveDefaultLiffId?: string
  channelAccessTokenConfigured: boolean
  channelAccessTokenSuffix: string | null
  channelSecretConfigured: boolean
  channelSecretSuffix: string | null
  envFallbackAvailable: boolean
}

const { showToast } = useAdminToast()
const { $auth } = useNuxtApp()

const loading = ref(false)
const saving = ref(false)
const clearing = ref(false)

const meta = ref<WorkspaceGet>({
  id: 'default',
  savedInFirestore: false,
  name: 'default',
  defaultLiffId: '',
  channelAccessTokenConfigured: false,
  channelAccessTokenSuffix: null,
  channelSecretConfigured: false,
  channelSecretSuffix: null,
  envFallbackAvailable: false,
})

const form = ref({
  name: '',
  defaultLiffId: '',
  channelAccessToken: '',
  channelSecret: '',
})

function tokenStatusLabel(configured: boolean, suffix: string | null) {
  if (!configured) return '未設定'
  if (suffix) return `已設定（末四碼 ${suffix}）`
  return '已設定'
}

async function getBearer(): Promise<string> {
  const u = $auth.currentUser
  if (!u) {
    await navigateTo('/login')
    throw new Error('not logged in')
  }
  return u.getIdToken()
}

async function load() {
  loading.value = true
  try {
    const token = await getBearer()
    const data = await $fetch<WorkspaceGet>('/api/admin/line-workspace', {
      headers: { Authorization: `Bearer ${token}` },
    })
    meta.value = data
    form.value.name = data.name || 'default'
    form.value.defaultLiffId = data.defaultLiffId || ''
    form.value.channelAccessToken = ''
    form.value.channelSecret = ''
  }
  catch (e: any) {
    showToast(e?.data?.message || e?.message || '載入失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const token = await getBearer()
    const body: Record<string, unknown> = {
      name: form.value.name.trim() || 'default',
      defaultLiffId: form.value.defaultLiffId.trim(),
    }
    if (form.value.channelAccessToken.trim()) {
      body.channelAccessToken = form.value.channelAccessToken.trim()
    }
    if (form.value.channelSecret.trim()) {
      body.channelSecret = form.value.channelSecret.trim()
    }
    await $fetch('/api/admin/line-workspace', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body,
    })
    showToast('已儲存', 'success')
    await load()
  }
  catch (e: any) {
    showToast(e?.data?.message || e?.message || '儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

async function clearWorkspace() {
  if (!confirm('確定刪除 Firestore 的 LINE 憑證？刪除後將改回使用環境變數。')) return
  clearing.value = true
  try {
    const token = await getBearer()
    await $fetch('/api/admin/line-workspace', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { clearWorkspace: true },
    })
    showToast('已清除 Firestore 憑證', 'success')
    await load()
  }
  catch (e: any) {
    showToast(e?.data?.message || e?.message || '清除失敗', 'error')
  }
  finally {
    clearing.value = false
  }
}

onMounted(() => {
  load()
})
</script>
