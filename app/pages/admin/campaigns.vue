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
            <p class="ar-section-hint">停用的活動儲存後會隱藏活動進入網址。</p>
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
              這裡是客服／行政日常會看的重點。活動連結會在儲存後自動更新。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="活動說明（選填）" tight />
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                placeholder="備註此活動的用途或來源"
              />
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="活動檔期（選填）" tight />
              <p class="text-xs text-muted">僅供內部／行銷紀錄，不影響連結或貼標；清空後儲存可刪除。</p>
              <div class="flex flex-wrap gap-2 admin-w-full">
                <el-date-picker
                  v-model="form.startsAt"
                  type="datetime"
                  placeholder="開始時間"
                  value-format="YYYY-MM-DDTHH:mm:ss"
                  class="admin-w-full cmp-date-field"
                />
                <el-date-picker
                  v-model="form.endsAt"
                  type="datetime"
                  placeholder="結束時間"
                  value-format="YYYY-MM-DDTHH:mm:ss"
                  class="admin-w-full cmp-date-field"
                />
              </div>
            </div>

            <template v-if="!isCreating && selectedCampaign">
              <hr class="divider">
              <h4 class="admin-field-title">🔗 活動進入網址（貼標用）</h4>
              <p class="ar-section-hint">
                這個網址給客服／行政貼到問卷完成頁、簡訊、廣告按鈕即可。
                使用者點入後會先綁 LINE；之後加官方帳號為好友時，系統才會自動貼上本活動標籤。
              </p>
              <div class="admin-field-group">
                <AdminFieldLabel text="活動進入網址" tight />
                <div v-if="ctaUrl" class="cmp-url-row">
                  <el-input :model-value="ctaUrl" readonly />
                  <el-button @click="copyCtaUrl">複製</el-button>
                </div>
                <div v-else class="ar-any-text-note">
                  尚未有網址：請確認活動為「啟用」，再按上方「儲存變更」。
                </div>
              </div>

              <hr class="divider">
              <div class="flex items-center justify-between gap-2">
                <h4 class="admin-field-title">📊 行銷成效</h4>
                <el-button size="small" :loading="statsLoading" @click="loadStats">重新整理</el-button>
              </div>
              <p class="ar-section-hint">
                看法很簡單：先看「待加好友」有多少，再看「已加好友並貼標」有多少。
                「加好友→貼標完成率」越高，代表這波活動名單越順利轉成可用名單。
              </p>
              <div v-if="statsLoading" class="ar-modules-loading">
                <div class="spinner" />
              </div>
              <div v-else-if="stats" class="cmp-stats-row">
                <div class="cmp-stat-box">
                  <div class="cmp-stat-label">已加好友並貼標</div>
                  <div class="cmp-stat-value">{{ stats.applied }}</div>
                </div>
                <div class="cmp-stat-box">
                  <div class="cmp-stat-label">待加好友（只綁 LINE）</div>
                  <div class="cmp-stat-value">{{ stats.claimed }}</div>
                </div>
                <div class="cmp-stat-box">
                  <div class="cmp-stat-label">加好友→貼標完成率</div>
                  <div class="cmp-stat-value">{{ stats.tagCompletionRate }}%</div>
                  <div v-if="stats.claimed + stats.applied === 0" class="cmp-stat-sub text-xs text-muted">尚無已完成綁定的名單</div>
                </div>
              </div>
            </template>
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
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const ctaUrl = ref('')
const stats = ref<{
  applied: number
  claimed: number
  tagCompletionRate: number
} | null>(null)
const statsLoading = ref(false)
/** 產 CTA 時實際 fallback 的預設 LIFF（僅 Firestore） */
const effectiveDefaultLiffId = ref('')

const { $auth } = useNuxtApp()

function campaignTimestampToPicker(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string')
    return v.length >= 19 ? v.slice(0, 19) : v
  if (typeof v === 'object' && v !== null) {
    const o = v as { seconds?: number; _seconds?: number }
    const sec = typeof o.seconds === 'number' ? o.seconds : o._seconds
    if (typeof sec === 'number')
      return new Date(sec * 1000).toISOString().slice(0, 19)
  }
  return ''
}

const defaultForm = () => ({
  name: '',
  campaignCode: '',
  liffId: '',
  tagIds: [] as string[],
  moduleId: null as string | null,
  description: '',
  startsAt: '' as string,
  endsAt: '' as string,
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
  ctaUrl.value = String(c.publishedCtaUrl || '')
  stats.value = null
  form.value = {
    name: c.name ?? '',
    campaignCode: c.campaignCode ?? '',
    liffId: c.liffId ?? '',
    tagIds: Array.isArray(c.tagIds) ? [...c.tagIds] : [],
    moduleId: c.moduleId ?? null,
    description: c.description ?? '',
    startsAt: campaignTimestampToPicker(c.startsAt),
    endsAt: campaignTimestampToPicker(c.endsAt),
    isActive: c.isActive !== false,
  }
  loadStats()
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  ctaUrl.value = ''
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
  if (!effectiveDefaultLiffId.value.trim()) {
    return showToast('請先到「LINE 連線」設定預設 LIFF', 'error')
  }
  if (!form.value.tagIds.length) return showToast('請至少選擇一個標籤', 'error')

  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      liffId: '',
      tagIds: form.value.tagIds,
      moduleId: form.value.moduleId,
      description: form.value.description,
      startsAt: form.value.startsAt || '',
      endsAt: form.value.endsAt || '',
      isActive: form.value.isActive,
    }
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
      const updated = campaigns.value.find(c => c.id === selectedId.value)
      if (updated) selectCampaign(updated)
      else await loadStats()
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

async function copyCtaUrl() {
  try {
    await navigator.clipboard.writeText(ctaUrl.value)
    showToast('已複製到剪貼簿', 'success')
  }
  catch {
    showToast('複製失敗，請手動複製', 'error')
  }
}

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
