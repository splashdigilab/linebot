<template>
  <AdminSplitLayout :is-empty="!selectedCampaign && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">📋 活動貼標</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!campaigns.length" class="split-sidebar-empty">
        <span>尚無活動</span>
        <p class="text-xs text-muted">建立問券活動，讓加好友即自動貼標</p>
        <el-button size="small" type="primary" plain @click="openCreate">立即新增</el-button>
      </div>
      <div v-else class="split-list">
        <AdminSplitListItem
          v-for="c in campaigns"
          :key="c.id"
          :title="c.name"
          :active="selectedId === c.id"
          :chip-text="c.isActive ? '啟用' : '停用'"
          :chip-tone="c.isActive ? 'success' : 'neutral'"
          :meta-text="c.campaignCode"
          :meta-truncate="true"
          @select="selectCampaign(c)"
        />
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">📋</span>
      <h3>選擇一個活動開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立新的活動貼標設定</p>
      <el-button type="primary" @click="openCreate">新增活動</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <AdminEditorHeaderTitle
        v-model="form.name"
        field-label="活動名稱"
        create-prefix="新增活動:"
        placeholder="例：2026 Q2 上線通知問券"
        caption="為此次活動命名，方便後續識別"
        :is-creating="isCreating"
        @enter="submitForm"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button v-if="!isCreating && selectedCampaign" type="danger" @click="deleteCampaign">
          🗑️ 刪除
        </el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立活動' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="ar-editor-body admin-panel-stack">

        <!-- 狀態設定 -->
        <div class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📍 狀態設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">停用的活動無法產生新的 CTA 連結。</p>
            <div class="admin-field-group">
              <AdminFieldLabel text="啟用狀態" tight />
              <el-switch
                v-model="form.isActive"
                active-text="啟用中"
                inactive-text="已停用"
                class="ar-status-switch"
              />
            </div>
          </div>
        </div>

        <!-- 活動設定 -->
        <div class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⚙️ 活動設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              活動代碼用於識別此問券；LIFF 可留空，產生 CTA 時會使用「LINE 連線」的預設 LIFF（或環境變數）。填完問券後的連結會帶入這些設定，使用者進入後完成身份綁定。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel tight>
                LIFF ID <span class="text-muted">（選填；留空則用 LINE 連線預設）</span>
              </AdminFieldLabel>
              <el-input
                v-model="form.liffId"
                placeholder="例：2007123456-AbCdEfGh"
                @keydown.enter.prevent
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="活動代碼（英文小寫、數字、底線）" tight />
              <el-input
                v-model="form.campaignCode"
                placeholder="例：launch_2026_q2"
                @keydown.enter.prevent
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="活動說明（選填）" tight />
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                placeholder="備註此活動的用途或來源"
              />
            </div>
          </div>
        </div>

        <!-- 貼標設定 -->
        <div class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🏷️ 加好友後貼標</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">使用者透過此活動連結加入好友後，系統會自動貼上以下標籤，方便後續分眾推播。</p>
            <div v-if="tagsLoading" class="ar-modules-loading">
              <div class="spinner" />
            </div>
            <div v-else-if="!allTags.length" class="ar-no-modules">
              尚無標籤，請先前往「<NuxtLink to="/admin/tags" class="ar-link">標籤管理</NuxtLink>」建立。
            </div>
            <div v-else class="admin-field-group">
              <AdminFieldLabel text="選擇標籤（至少一個）" tight />
              <el-select
                v-model="form.tagIds"
                multiple
                collapse-tags
                collapse-tags-tooltip
                placeholder="選擇要貼的標籤"
                class="admin-w-full"
              >
                <el-option
                  v-for="tag in allTags"
                  :key="tag.id"
                  :label="tag.name"
                  :value="tag.id"
                >
                  <AdminTagOptionRow :label="tag.name" :color="tag.color" />
                </el-option>
              </el-select>
            </div>
          </div>
        </div>

        <!-- 模組設定 -->
        <div class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🤖 加好友後觸發模組（選填）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">使用者加入好友後，自動推送指定機器人模組。不設定則僅貼標，不觸發模組。</p>
            <div v-if="modulesLoading" class="ar-modules-loading">
              <div class="spinner" />
            </div>
            <div v-else class="admin-field-group">
              <AdminFieldLabel text="選擇模組（可清空）" tight />
              <el-select
                v-model="form.moduleId"
                clearable
                placeholder="不觸發模組"
                class="admin-w-full"
              >
                <el-option
                  v-for="m in modules"
                  :key="m.id"
                  :label="m.name"
                  :value="m.id"
                />
              </el-select>
            </div>
          </div>
        </div>

        <!-- 漏斗統計 -->
        <div v-if="!isCreating && selectedCampaign" class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📊 活動漏斗統計</span>
            </div>
            <el-button size="small" :loading="statsLoading" @click="loadStats">重新整理</el-button>
          </div>
          <div class="card-section-stack">
            <div v-if="statsLoading" class="ar-modules-loading">
              <div class="spinner" />
            </div>
            <div v-else-if="stats" class="cmp-stats-row">
              <div class="cmp-stat-box">
                <div class="cmp-stat-label">產生 CTA</div>
                <div class="cmp-stat-value">{{ stats.total }}</div>
              </div>
              <div class="cmp-stat-box">
                <div class="cmp-stat-label">已綁定</div>
                <div class="cmp-stat-value">{{ stats.claimed + stats.applied }}</div>
                <div class="cmp-stat-rate">{{ stats.claimRate }}%</div>
              </div>
              <div class="cmp-stat-box">
                <div class="cmp-stat-label">已加好友貼標</div>
                <div class="cmp-stat-value">{{ stats.applied }}</div>
                <div class="cmp-stat-rate">{{ stats.applyRate }}%</div>
              </div>
              <div class="cmp-stat-box">
                <div class="cmp-stat-label">等待加好友</div>
                <div class="cmp-stat-value">{{ stats.claimed }}</div>
              </div>
              <div class="cmp-stat-box">
                <div class="cmp-stat-label">已逾期</div>
                <div class="cmp-stat-value">{{ stats.expired }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- CTA 產生 -->
        <div v-if="!isCreating && selectedCampaign" class="message-card cmp-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔗 產生 CTA 連結</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="ar-section-hint">
              每次點擊「產生」會建立一組新的一次性連結（有效期 72 小時）。
              將此連結放在問券完成頁的 CTA 按鈕，使用者點擊後進入 LINE 完成身份綁定，加好友後即自動貼標。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="CTA 網址" tight />
              <div v-if="ctaUrl" class="cmp-url-row">
                <el-input :model-value="ctaUrl" readonly />
                <el-button @click="copyCtaUrl">複製</el-button>
              </div>
              <div v-else class="ar-any-text-note">尚未產生連結，請點擊下方按鈕。</div>
              <p v-if="ctaExpiresAt" class="cmp-url-hint">有效期限：{{ ctaExpiresAt }}</p>
            </div>
            <el-button :loading="generatingCta" @click="generateCta">
              {{ ctaUrl ? '重新產生連結' : '產生 CTA 連結' }}
            </el-button>
          </div>
        </div>

      </div>
    </template>
  </AdminSplitLayout>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

const { tags: allTags, loading: tagsLoading, loadTags } = useAdminTagList()
const { toasts, showToast } = useAdminToast()

const campaigns = ref<any[]>([])
const modules = ref<any[]>([])
const loading = ref(true)
const modulesLoading = ref(true)
const saving = ref(false)
const generatingCta = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const ctaUrl = ref('')
const ctaExpiresAt = ref('')
const stats = ref<any>(null)
const statsLoading = ref(false)
/** 產 CTA 時實際 fallback 的預設 LIFF（含 Firestore、LIFF_DEFAULT_ID） */
const effectiveDefaultLiffId = ref('')

const { $auth } = useNuxtApp()

const defaultForm = () => ({
  name: '',
  campaignCode: '',
  liffId: '',
  tagIds: [] as string[],
  moduleId: null as string | null,
  description: '',
  isActive: true,
})
const form = ref(defaultForm())

const selectedCampaign = computed(() => campaigns.value.find(c => c.id === selectedId.value) ?? null)

// ── Load ─────────────────────────────────────────────────
async function loadCampaigns() {
  loading.value = true
  campaigns.value = await $fetch<any[]>('/api/campaigns/list').catch(() => [])
  loading.value = false
}

async function loadModules() {
  modulesLoading.value = true
  modules.value = await $fetch<any[]>('/api/flow/list').catch(() => [])
  modulesLoading.value = false
}

async function loadWorkspaceEffectiveLiff() {
  try {
    const u = $auth.currentUser
    if (!u) return
    const token = await u.getIdToken()
    const data = await $fetch<{ effectiveDefaultLiffId?: string }>('/api/admin/line-workspace', {
      headers: { Authorization: `Bearer ${token}` },
    })
    effectiveDefaultLiffId.value = String(data?.effectiveDefaultLiffId ?? '').trim()
  }
  catch {
    effectiveDefaultLiffId.value = ''
  }
}

onMounted(() => {
  loadCampaigns()
  loadModules()
  loadTags({ status: 'active' })
  loadWorkspaceEffectiveLiff()
})

// ── Select / Create ───────────────────────────────────────
function selectCampaign(c: any) {
  isCreating.value = false
  selectedId.value = c.id
  ctaUrl.value = ''
  ctaExpiresAt.value = ''
  stats.value = null
  form.value = {
    name: c.name ?? '',
    campaignCode: c.campaignCode ?? '',
    liffId: c.liffId ?? '',
    tagIds: Array.isArray(c.tagIds) ? [...c.tagIds] : [],
    moduleId: c.moduleId ?? null,
    description: c.description ?? '',
    isActive: c.isActive !== false,
  }
  loadStats()
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  ctaUrl.value = ''
  ctaExpiresAt.value = ''
  stats.value = null
  form.value = defaultForm()
}

function cancelEdit() {
  if (selectedCampaign.value) {
    selectCampaign(selectedCampaign.value)
    isCreating.value = false
  }
  else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
}

// ── Save / Delete ─────────────────────────────────────────
async function submitForm() {
  if (!form.value.name.trim()) return showToast('請輸入活動名稱', 'error')
  if (!form.value.campaignCode.trim()) return showToast('請輸入活動代碼', 'error')
  if (!form.value.liffId.trim() && !effectiveDefaultLiffId.value.trim()) {
    return showToast('請填寫活動 LIFF，或在「LINE 連線」設定預設 LIFF', 'error')
  }
  if (!form.value.tagIds.length) return showToast('請至少選擇一個標籤', 'error')

  saving.value = true
  try {
    const payload = { ...form.value }
    if (isCreating.value) {
      const res = await $fetch<any>('/api/campaigns/create', { method: 'POST', body: payload })
      showToast('活動已建立', 'success')
      await loadCampaigns()
      const created = campaigns.value.find(c => c.id === res.id) ?? campaigns.value[0]
      if (created) selectCampaign(created)
      isCreating.value = false
    }
    else {
      await $fetch(`/api/campaigns/${selectedId.value}`, { method: 'PUT', body: payload })
      showToast('活動已更新', 'success')
      await loadCampaigns()
    }
  }
  catch {
    showToast('儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

async function deleteCampaign() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name}」？此操作無法復原。`)) return
  try {
    await $fetch(`/api/campaigns/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    isCreating.value = false
    form.value = defaultForm()
    await loadCampaigns()
  }
  catch {
    showToast('刪除失敗', 'error')
  }
}

// ── CTA 產生 ─────────────────────────────────────────────
async function generateCta() {
  if (!selectedId.value) return
  generatingCta.value = true
  try {
    const res = await $fetch<{ ctaUrl: string; expiresAt: string }>(
      `/api/campaigns/${selectedId.value}/create-cta`,
      { method: 'POST' },
    )
    ctaUrl.value = res.ctaUrl
    ctaExpiresAt.value = new Date(res.expiresAt).toLocaleString('zh-TW')
    showToast('CTA 連結已產生', 'success')
  }
  catch {
    showToast('產生失敗，請確認活動已儲存且啟用', 'error')
  }
  finally {
    generatingCta.value = false
  }
}

async function copyCtaUrl() {
  try {
    await navigator.clipboard.writeText(ctaUrl.value)
    showToast('已複製到剪貼簿', 'success')
  }
  catch {
    showToast('複製失敗，請手動複製', 'error')
  }
}

// ── 漏斗統計 ──────────────────────────────────────────────
async function loadStats() {
  if (!selectedId.value) return
  statsLoading.value = true
  try {
    stats.value = await $fetch(`/api/campaigns/${selectedId.value}/stats`)
  }
  catch {
    showToast('統計載入失敗', 'error')
  }
  finally {
    statsLoading.value = false
  }
}
</script>
