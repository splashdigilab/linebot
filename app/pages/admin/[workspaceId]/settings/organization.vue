<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="🏢 組織與 LINE"
        caption="組織與官方帳號名稱；以及 LINE OA 憑證、LIFF 與 Webhook。預設 LIFF 必填；Token／Secret 第一次要貼，存過後以黑點顯示，點黑點可改。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button :loading="loading" @click="reloadAll">重新載入</el-button>
        <el-button type="primary" :loading="saving" @click="save">儲存</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🏢 組織與官方帳號</span>
            </div>
          </div>
          <div class="card-section-stack card-section-stack--relaxed-summary">
            <div class="admin-field-group">
              <AdminFieldLabel text="組織名稱" tight />
              <div class="text-sm">{{ organizationNameDisplay }}</div>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="官方帳號名稱" tight />
              <div class="text-sm">{{ officialAccountDisplayName }}</div>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="你的角色" tight />
              <el-tag :type="roleTagType(currentRole)">{{ roleLabel(currentRole) }}</el-tag>
            </div>
          </div>
        </div>

        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⚙️ LINE 憑證與 Webhook</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              請到 LINE Developers → Messaging API 複製貼上。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="預設 LIFF（必填）" tight />
              <el-input
                v-model="form.defaultLiffId"
                placeholder="例：2007123456-AbCdEfGh"
              />
              <p class="text-xs text-muted">活動沒填 LIFF 時會用這一組。</p>
            </div>
            <p class="ar-section-hint">
              在 LINE Developers 建立／編輯<strong>同一個</strong> LIFF 時，Endpoint URL 請設為下方「活動 LIFF 頁」，<strong>不可</strong>填 Webhook 路徑（<code>/webhook</code>），否則點活動連結會 404。
            </p>
            <div v-if="suggestedLiffEndpointUrl" class="admin-field-group">
              <AdminFieldLabel text="活動 LIFF 頁（貼到 LINE Developers → 該 LIFF 的 Endpoint URL）" tight />
              <div class="cmp-url-row">
                <el-input :model-value="suggestedLiffEndpointUrl" readonly />
                <el-button @click="copyLiffEndpointUrl">複製</el-button>
              </div>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="Channel Access Token（必填）" tight />
              <div
                v-if="showMaskedAccessToken"
                class="ls-cred-mask"
                role="button"
                tabindex="0"
                aria-label="Channel Access Token 已儲存，點擊以變更"
                @click="revealAccessToken"
                @keydown.enter.prevent="revealAccessToken"
              >
                <span class="ls-cred-mask-dots" aria-hidden="true">{{ maskDots }}</span>
                <span v-if="meta.channelAccessTokenSuffix" class="ls-cred-mask-suffix">末四碼 {{ meta.channelAccessTokenSuffix }}</span>
                <span class="ls-cred-mask-hint">已儲存（內容隱藏），點此變更</span>
              </div>
              <el-input
                v-else
                ref="accessTokenInputRef"
                v-model="form.channelAccessToken"
                type="password"
                show-password
                placeholder="貼上完整 Token"
                autocomplete="off"
                @blur="onAccessTokenBlur"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="Channel Secret（必填）" tight />
              <div
                v-if="showMaskedSecret"
                class="ls-cred-mask"
                role="button"
                tabindex="0"
                aria-label="Channel Secret 已儲存，點擊以變更"
                @click="revealSecret"
                @keydown.enter.prevent="revealSecret"
              >
                <span class="ls-cred-mask-dots" aria-hidden="true">{{ maskDots }}</span>
                <span v-if="meta.channelSecretSuffix" class="ls-cred-mask-suffix">末四碼 {{ meta.channelSecretSuffix }}</span>
                <span class="ls-cred-mask-hint">已儲存（內容隱藏），點此變更</span>
              </div>
              <el-input
                v-else
                ref="channelSecretInputRef"
                v-model="form.channelSecret"
                type="password"
                show-password
                placeholder="貼上完整 Secret"
                autocomplete="off"
                @blur="onSecretBlur"
              />
              <p class="text-xs text-muted">須與 LINE 後台同一組。</p>
            </div>
            <div v-if="!meta.savedInFirestore && !meta.channelAccessTokenConfigured" class="text-xs text-muted">
              尚未在此頁存過憑證，請貼上 Token、Secret 後按儲存。
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
              → Messaging API → Webhook URL 貼下面這個（須為 https、網路上連得到）。Secret 要跟上面同一組。後台按「Verify」若回 401，幾乎都是 Secret 與伺服器上的不一致或部署環境未帶入 Secret。
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
                      <p
                        v-if="!webhookVerifyResult.test.success && webhookVerifyResult.test.statusCode === 401"
                        class="ar-section-hint"
                      >
                        HTTP 401 表示你的網站有收到 LINE 的 POST，但<strong>驗簽失敗</strong>。請確認本頁儲存的 Channel Secret 與 LINE Developers → Messaging API 的 Channel secret 為<strong>同一組</strong>。目前系統只吃 Firestore 憑證，Secret 錯誤、未儲存，或部署環境無法讀取 Firestore 都會 401。
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
import type { WorkspaceMemberRole } from '~~/shared/types/organization'

definePageMeta({ middleware: 'auth', layout: 'default' })

useHead({
  title: '組織與 LINE — LINE Bot 管理系統',
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
}

const { showToast } = useAdminToast()
const {
  getBearer,
  workspaceId,
  workspaceList,
  loadWorkspaceList,
  currentWorkspaceName,
  currentRole,
} = useWorkspace()

const currentWorkspaceRow = computed(() =>
  workspaceList.value.find(w => w.workspaceId === workspaceId.value) ?? null,
)

const organizationNameDisplay = computed(() => {
  const n = currentWorkspaceRow.value?.organizationName?.trim()
  return n || '—'
})

const officialAccountDisplayName = computed(() => currentWorkspaceName.value || '—')

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}

function roleLabel(role: WorkspaceMemberRole | null) {
  return role ? (ROLE_LABELS[role] ?? role) : '—'
}

function roleTagType(role: WorkspaceMemberRole | null) {
  if (role === 'owner') return 'danger'
  if (role === 'admin') return 'warning'
  if (role === 'agent') return 'success'
  return 'info'
}

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
})

const form = ref({
  defaultLiffId: '',
  channelAccessToken: '',
  channelSecret: '',
})

const maskDots = '••••••••••••'

const accessTokenInputRef = ref<{ focus: () => void } | null>(null)
const channelSecretInputRef = ref<{ focus: () => void } | null>(null)
const accessTokenReveal = ref(false)
const secretReveal = ref(false)

const showMaskedAccessToken = computed(
  () =>
    meta.value.channelAccessTokenConfigured
    && !form.value.channelAccessToken.trim()
    && !accessTokenReveal.value,
)

const showMaskedSecret = computed(
  () =>
    meta.value.channelSecretConfigured
    && !form.value.channelSecret.trim()
    && !secretReveal.value,
)

function revealAccessToken() {
  accessTokenReveal.value = true
  nextTick(() => accessTokenInputRef.value?.focus?.())
}

function revealSecret() {
  secretReveal.value = true
  nextTick(() => channelSecretInputRef.value?.focus?.())
}

function onAccessTokenBlur() {
  if (!form.value.channelAccessToken.trim() && meta.value.channelAccessTokenConfigured)
    accessTokenReveal.value = false
}

function onSecretBlur() {
  if (!form.value.channelSecret.trim() && meta.value.channelSecretConfigured)
    secretReveal.value = false
}

const suggestedWebhookUrl = ref('')
const suggestedLiffEndpointUrl = ref('')

function refreshSuggestedWebhookUrl() {
  if (typeof window === 'undefined') return
  suggestedWebhookUrl.value = `${window.location.origin}/webhook`
}

function refreshSuggestedLiffEndpointUrl() {
  if (typeof window === 'undefined') return
  suggestedLiffEndpointUrl.value = `${window.location.origin}/liff/lead`
}

async function copyLiffEndpointUrl() {
  if (!suggestedLiffEndpointUrl.value) return
  try {
    await navigator.clipboard.writeText(suggestedLiffEndpointUrl.value)
    showToast('已複製活動 LIFF 頁網址', 'success')
  }
  catch {
    showToast('複製失敗，請手動複製', 'error')
  }
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
    accessTokenReveal.value = false
    secretReveal.value = false
  }
  catch (e: any) {
    showToast(e?.data?.message || e?.message || '載入失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

async function reloadAll() {
  await loadWorkspaceList().catch(() => {})
  await load()
}

async function save() {
  const defaultLiffId = form.value.defaultLiffId.trim()
  const t = form.value.channelAccessToken.trim()
  const s = form.value.channelSecret.trim()
  const tc = meta.value.channelAccessTokenConfigured
  const sc = meta.value.channelSecretConfigured

  if (!defaultLiffId) {
    showToast('請填寫預設 LIFF', 'error')
    return
  }
  if (!tc && !t) {
    showToast('請填寫 Channel Access Token', 'error')
    return
  }
  if (!sc && !s) {
    showToast('請填寫 Channel Secret', 'error')
    return
  }
  if (t && !s && !sc) {
    showToast('請填寫 Channel Secret', 'error')
    return
  }
  if (s && !t && !tc) {
    showToast('請填寫 Channel Access Token', 'error')
    return
  }

  saving.value = true
  try {
    const token = await getBearer()
    const body: Record<string, unknown> = { defaultLiffId }
    if (t) body.channelAccessToken = t
    if (s) body.channelSecret = s
    await $fetch('/api/admin/line-workspace', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        ...body,
        verifyWebhookOnSave: true,
        compareWebhookUrl: suggestedWebhookUrl.value || undefined,
      },
    })
    showToast('已儲存（已自動測試 Webhook）', 'success')
    await loadWorkspaceList().catch(() => {})
    await load()
    await verifyWebhook(false)
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

onMounted(async () => {
  refreshSuggestedWebhookUrl()
  refreshSuggestedLiffEndpointUrl()
  await loadWorkspaceList().catch(() => {})
  await load()
})
</script>
