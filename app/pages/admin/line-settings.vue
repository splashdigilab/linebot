<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="LINE 連線"
        title="🔐 LINE OA 憑證"
        caption="以下三個欄位請填完再儲存。"
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
              <span class="badge badge-green">⚙️ LINE 憑證與 Webhook</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              三項皆為必填。請到 LINE Developers → Messaging API 複製貼上。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="預設 LIFF（必填）" tight />
              <el-input
                v-model="form.defaultLiffId"
                placeholder="例：2007123456-AbCdEfGh"
              />
              <p class="text-xs text-muted">活動沒填 LIFF 時會用這一組。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="Channel Access Token（必填）" tight />
              <el-input
                v-model="form.channelAccessToken"
                type="password"
                show-password
                placeholder="貼上完整 Token"
                autocomplete="off"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="Channel Secret（必填）" tight />
              <el-input
                v-model="form.channelSecret"
                type="password"
                show-password
                placeholder="貼上完整 Secret"
                autocomplete="off"
              />
              <p class="text-xs text-muted">須與 LINE 後台同一組。</p>
            </div>
            <div v-if="meta.savedInFirestore" class="text-xs text-muted">
              已存過：Token {{ tokenStatusLabel(meta.channelAccessTokenConfigured, meta.channelAccessTokenSuffix) }}；Secret {{ tokenStatusLabel(meta.channelSecretConfigured, meta.channelSecretSuffix) }}。
            </div>
            <div v-else class="text-xs text-muted">
              還沒在這裡存過。若要在此更新密鑰，請貼上後按儲存。
            </div>

            <hr class="divider">

            <p class="ar-section-hint">
              到
              <a
                href="https://developers.line.biz/console/"
                target="_blank"
                rel="noopener noreferrer"
                class="ar-link"
              >LINE Developers</a>
              → Messaging API → Webhook URL 貼下面這個（須為 https、網路上連得到）。Secret 要跟上面同一組。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="Webhook 網址（複製貼到 LINE）" tight />
              <div v-if="suggestedWebhookUrl" class="cmp-url-row">
                <el-input :model-value="suggestedWebhookUrl" readonly />
                <el-button @click="copyWebhookUrl">複製</el-button>
              </div>
              <p v-else class="text-xs text-muted">開啟本頁後會自動帶入。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="測試有沒有通" tight />
              <div class="flex flex-wrap gap-2">
                <el-button :loading="verifyingWebhook" type="primary" plain @click="verifyWebhook(true)">
                  測試連線
                </el-button>
                <el-button :loading="verifyingWebhook" @click="verifyWebhook(false)">
                  只看登記網址
                </el-button>
              </div>
              <p class="text-xs text-muted">用現在的 Token 問 LINE。測試有額度，別狂按。</p>
            </div>
            <div v-if="webhookVerifyResult" class="admin-field-group">
              <AdminFieldLabel text="結果" tight />
              <div class="flex flex-col gap-1 text-sm">
                <template v-if="!webhookVerifyResult.getOk">
                  <p class="text-danger">{{ webhookVerifyResult.getMessage }}</p>
                </template>
                <template v-else>
                  <p><strong>LINE 後台登記的網址：</strong>{{ webhookVerifyResult.lineEndpoint || '—' }}</p>
                  <p>
                    <strong>有沒有開 Webhook：</strong>
                    {{ webhookVerifyResult.lineActive ? '有（會收訊息）' : '沒開（收不到）' }}
                  </p>
                  <p v-if="webhookVerifyResult.urlMatchesCompare === true" class="text-success">
                    跟上面「Webhook 網址」一樣。
                  </p>
                  <p v-else-if="webhookVerifyResult.urlMatchesCompare === false" class="text-warning">
                    跟上面「Webhook 網址」不一樣；若 API 本來就架在別台再說，否則請改 LINE 後台。
                  </p>
                  <template v-if="!webhookVerifyResult.testSkipped">
                    <template v-if="webhookVerifyResult.testError">
                      <p class="text-danger">{{ webhookVerifyResult.testError }}</p>
                    </template>
                    <template v-else-if="webhookVerifyResult.test">
                      <p v-if="webhookVerifyResult.test.success" class="text-success">
                        測試 OK，LINE 連得到你的網站。
                      </p>
                      <p v-else class="text-danger">
                        測試失敗：{{ webhookVerifyResult.test.reason || '—' }}
                        <span v-if="webhookVerifyResult.test.detail">（{{ webhookVerifyResult.test.detail }}）</span>
                        <span v-if="webhookVerifyResult.test.statusCode != null"> HTTP {{ webhookVerifyResult.test.statusCode }}</span>
                      </p>
                    </template>
                  </template>
                  <p v-else class="text-muted text-xs">這次沒跑測試。</p>
                </template>
              </div>
            </div>

            <template v-if="showClearStoredCredentials">
              <hr class="divider">
              <p class="ar-section-hint">
                清掉本頁存的 Token／Secret。LINE 後台不用改；其他請交給技術人員處理。
              </p>
              <el-button type="danger" plain :loading="clearing" @click="clearWorkspace">
                清除已儲存的憑證
              </el-button>
            </template>
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
  effectiveDefaultLiffId?: string
  channelAccessTokenConfigured: boolean
  channelAccessTokenSuffix: string | null
  channelSecretConfigured: boolean
  channelSecretSuffix: string | null
  envFallbackAvailable: boolean
}

const { showToast } = useAdminToast()
const { $auth } = useNuxtApp()

/** 暫時隱藏「清除已儲存的憑證」區塊；改為 true 即可顯示 */
const showClearStoredCredentials = false

const loading = ref(false)
const saving = ref(false)
const clearing = ref(false)

const meta = ref<WorkspaceGet>({
  id: 'default',
  savedInFirestore: false,
  name: '',
  defaultLiffId: '',
  channelAccessTokenConfigured: false,
  channelAccessTokenSuffix: null,
  channelSecretConfigured: false,
  channelSecretSuffix: null,
  envFallbackAvailable: false,
})

const form = ref({
  defaultLiffId: '',
  channelAccessToken: '',
  channelSecret: '',
})

/** 與 `server/routes/webhook.post.ts` 對應的公開路徑 */
const suggestedWebhookUrl = ref('')

function refreshSuggestedWebhookUrl() {
  if (typeof window === 'undefined') return
  suggestedWebhookUrl.value = `${window.location.origin}/webhook`
}

async function copyWebhookUrl() {
  if (!suggestedWebhookUrl.value) return
  try {
    await navigator.clipboard.writeText(suggestedWebhookUrl.value)
    showToast('已複製 Webhook URL', 'success')
  }
  catch {
    showToast('複製失敗，請手動複製', 'error')
  }
}

type WebhookVerifyResult = {
  getOk: boolean
  getMessage?: string
  lineEndpoint: string | null
  lineActive: boolean | null
  urlMatchesCompare: boolean | null
  test: {
    success: boolean
    reason?: string
    detail?: string
    statusCode?: number
  } | null
  testSkipped: boolean
  testError?: string
}

const webhookVerifyResult = ref<WebhookVerifyResult | null>(null)
const verifyingWebhook = ref(false)

async function verifyWebhook(runTest: boolean) {
  verifyingWebhook.value = true
  webhookVerifyResult.value = null
  try {
    const token = await getBearer()
    const data = await $fetch<WebhookVerifyResult>('/api/admin/line-webhook-verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        compareUrl: suggestedWebhookUrl.value || undefined,
        runTest,
      },
    })
    webhookVerifyResult.value = data
    if (data.getOk && runTest && !data.testSkipped && data.test?.success) {
      showToast('Webhook 串接驗證通過', 'success')
    }
    else if (data.getOk && runTest && !data.testSkipped && data.test && !data.test.success) {
      showToast('測試派送失敗，請查看下方說明', 'error')
    }
    else if (data.getOk && data.testError) {
      showToast('無法完成測試，請查看下方說明', 'error')
    }
    else if (data.getOk) {
      showToast(runTest ? '查詢完成' : '已取得 LINE 登記網址', 'success')
    }
    else {
      showToast(data.getMessage || '查詢失敗', 'error')
    }
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || e?.data?.message || e?.message || '驗證請求失敗', 'error')
  }
  finally {
    verifyingWebhook.value = false
  }
}

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
  const defaultLiffId = form.value.defaultLiffId.trim()
  const channelAccessToken = form.value.channelAccessToken.trim()
  const channelSecret = form.value.channelSecret.trim()
  if (!defaultLiffId) {
    showToast('請填寫預設 LIFF', 'error')
    return
  }
  if (!channelAccessToken) {
    showToast('請填寫 Channel Access Token', 'error')
    return
  }
  if (!channelSecret) {
    showToast('請填寫 Channel Secret', 'error')
    return
  }

  saving.value = true
  try {
    const token = await getBearer()
    const body: Record<string, unknown> = {
      defaultLiffId,
      channelAccessToken,
      channelSecret,
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
  if (!confirm('確定清除在此頁儲存的 LINE 憑證？')) return
  clearing.value = true
  try {
    const token = await getBearer()
    await $fetch('/api/admin/line-workspace', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { clearWorkspace: true },
    })
    showToast('已清除儲存的憑證', 'success')
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
  refreshSuggestedWebhookUrl()
  load()
})
</script>
