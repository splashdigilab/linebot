<template>
  <AdminSplitLayout :is-empty="!selectedItem && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">📣 推播</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!broadcasts.length" class="split-sidebar-empty">
        <span>尚無推播</span>
        <el-button size="small" type="primary" plain @click="openCreate">立即建立</el-button>
      </div>
      <div v-else class="split-list">
        <AdminSplitListItem
          v-for="bc in broadcasts"
          :key="bc.id"
          :title="bc.name"
          :active="selectedId === bc.id"
          :chip-text="statusLabel(bc.status)"
          :chip-tone="bc.status === 'completed' || bc.status === 'scheduled' ? 'success' : 'neutral'"
          :meta-text="bcMetaText(bc)"
          meta-truncate
          @select="selectItem(bc)"
        />
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">📣</span>
      <h3>選擇一則推播來查看或編輯</h3>
      <p>或點擊左側「➕ 新增」建立新推播</p>
      <el-button type="primary" @click="openCreate">建立推播</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <AdminEditorHeaderTitle
        v-model="form.name"
        field-label="推播名稱"
        create-prefix="新增推播:"
        placeholder="請輸入推播名稱…"
        caption="為這則推播命名，方便後續管理"
        :is-creating="isCreating"
      />
      <div class="flex gap-1 admin-header-actions">
        <!-- 已完成/取消 → 只看報表 -->
        <template v-if="isReadOnly">
          <el-button @click="cancelEdit">關閉</el-button>
        </template>
        <!-- 可編輯 -->
        <template v-else>
          <el-button
            v-if="!isCreating && selectedItem && ['draft','scheduled'].includes(selectedItem.status)"
            type="danger"
            plain
            @click="cancelBroadcast"
          >
            取消推播
          </el-button>
          <el-button @click="cancelEdit">取消</el-button>
          <el-button :loading="saving" @click="saveDraft">儲存草稿</el-button>
          <el-button type="primary" :loading="validating" @click="openValidateDialog">
            驗證並發送
          </el-button>
        </template>
      </div>
    </template>

    <!-- ── Editor Body（與 auto-reply 相同：可捲動 + padding + 區塊間距）── -->
    <template #editor-body>
      <div class="ar-editor-body admin-panel-stack">
        <el-form label-position="top" class="admin-form-vertical bc-editor-form" @submit.prevent>

        <!-- ①  受眾設定 -->
        <div class="message-card bc-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">👥 受眾設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="admin-field-group">
              <AdminFieldLabel text="發送對象" tight />
              <el-radio-group v-model="form.audienceType" :disabled="isReadOnly">
                <el-radio value="all">全部好友</el-radio>
                <el-radio value="tags">依標籤篩選</el-radio>
                <el-radio value="import">匯入名單</el-radio>
              </el-radio-group>
            </div>

            <!-- 依標籤 -->
            <div v-if="form.audienceType === 'tags'" class="admin-field-group">
              <AdminFieldLabel text="選擇標籤（符合任一即納入）" tight />
              <el-select
                v-model="form.tagIds"
                multiple
                collapse-tags
                placeholder="選擇標籤"
                :disabled="isReadOnly"
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

            <!-- 匯入名單 -->
            <div v-if="form.audienceType === 'import'" class="admin-field-group">
              <AdminFieldLabel text="LINE User IDs（每行一筆）" tight />
              <el-input
                v-model="form.importText"
                type="textarea"
                :rows="5"
                placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                :disabled="isReadOnly"
              />
              <span class="tags-hint">共 {{ importUserIds.length }} 筆</span>
            </div>

            <!-- 受眾快照（已發送） -->
            <div v-if="isReadOnly && selectedItem?.audienceSnapshot?.estimatedCount" class="bc-snapshot-info">
              <span>發送時受眾：{{ selectedItem.audienceSnapshot.estimatedCount }} 位</span>
            </div>
          </div>
        </div>

        <!-- ②  訊息內容（與圖文訊息區塊相同：動作類型 + 欄位） -->
        <div class="message-card bc-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">💬 訊息內容</span>
            </div>
          </div>
          <div class="card-section-stack">
            <AdminAreaActionEditor
              :model-value="form.contentAction"
              :module-options="flowOptions"
              :disabled="isReadOnly"
              @update:model-value="onContentActionUpdate"
            />
            <p class="bc-click-hint text-muted">
              成效「開封數」來自 LINE 官方聚合（發送後自動帶彙總單位）。「追蹤連結點擊」僅在使用者經由
              <code class="bc-click-hint__code">/api/r</code>
              開啟 https 目標時累加（需設定
              <code class="bc-click-hint__code">CLICK_TRACKING_BASE_URL</code>）。純文字與 postback 不會增加追蹤連結點擊。
            </p>
          </div>
        </div>

        <!-- ③  發送設定 -->
        <div v-if="!isReadOnly" class="message-card bc-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⏰ 發送設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="admin-field-group">
              <AdminFieldLabel text="發送時間" tight />
              <el-radio-group v-model="form.scheduleMode">
                <el-radio value="now">立即發送</el-radio>
                <el-radio value="schedule">排程發送</el-radio>
              </el-radio-group>
            </div>
            <div v-if="form.scheduleMode === 'schedule'" class="admin-field-group">
              <AdminFieldLabel text="排程時間" tight />
              <el-date-picker
                v-model="form.scheduleAt"
                type="datetime"
                placeholder="選擇日期與時間"
                format="YYYY/MM/DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ss"
                :disabled-date="disabledPastDate"
              />
            </div>
          </div>
        </div>

        <!-- ④  成效報表（已發送） -->
        <div v-if="report" class="message-card bc-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📊 成效報表</span>
            </div>
            <el-button size="small" @click="loadReport">重新整理</el-button>
          </div>
          <div class="card-section-stack">
            <div class="bc-stats-row">
              <div class="bc-stat-box">
                <div class="bc-stat-label">發送總數</div>
                <div class="bc-stat-value">{{ report.totalCount }}</div>
              </div>
              <div class="bc-stat-box">
                <div class="bc-stat-label">成功</div>
                <div class="bc-stat-value">{{ report.sentCount }}</div>
              </div>
              <div class="bc-stat-box">
                <div class="bc-stat-label">失敗</div>
                <div class="bc-stat-value">{{ report.failedCount }}</div>
              </div>
              <div class="bc-stat-box">
                <div class="bc-stat-label">開封數（LINE）</div>
                <div class="bc-stat-value">{{ formatNullableStat(report.lineUniqueImpression) }}</div>
              </div>
              <div class="bc-stat-box">
                <div class="bc-stat-label">追蹤連結點擊</div>
                <div class="bc-stat-value">{{ report.linkClickCount ?? report.clickCount }}</div>
              </div>
            </div>
            <div class="admin-field-stack">
              <div class="admin-field-group">
                <AdminFieldLabel text="開封率（LINE 聚合／非即時）" tight />
                <span class="bc-ctr-value">{{ formatPercentRate(report.openRate) }}</span>
              </div>
              <div class="admin-field-group">
                <AdminFieldLabel text="追蹤連結點擊率" tight />
                <span class="bc-ctr-value">{{ (report.ctr * 100).toFixed(2) }}%</span>
              </div>
              <div v-if="report.lineUniqueClick != null" class="admin-field-group">
                <AdminFieldLabel text="LINE 官方．訊息內網址點擊人數（聚合）" tight />
                <span class="bc-ctr-value">{{ report.lineUniqueClick }}</span>
              </div>
              <p v-if="report.lineInsightError === 'LINE_AGGREGATION_SKIPPED'" class="bc-insight-warn text-muted">
                此推播發送時未帶入 LINE 彙總單位（常見原因：LINE 回 400 不支援，系統已改為一般 multicast），後台無法向 LINE Insight 查開封數。請再發新推播並確認日誌未出現「改為不帶彙總重試」；開封可改由 LINE Official Account Manager 查看。
              </p>
              <p v-else-if="report.lineInsightError" class="bc-insight-warn text-muted">
                LINE Insight：{{ report.lineInsightError }}（發送後常需數小時才有數字；請稍後按「重新整理」）
              </p>
              <p
                v-else-if="report.lineUniqueImpression == null && report.lineInsightAggregationApplied !== false"
                class="bc-insight-warn text-muted"
              >
                開封數為 —：LINE 彙總通常非即時；若實際互動人數很少，LINE 會因隱私政策回傳空值（與聊天室「已讀」顯示未必同步出現在 API）。
              </p>
            </div>
          </div>
        </div>

        </el-form>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- 驗證 / 發送確認 Dialog -->
  <el-dialog v-model="validateDialogVisible" class="bc-dialog-validate" title="發送前確認" width="440px">
    <div v-if="validateLoading" class="bc-validate-loading">
      <div class="spinner" />
      <span>分析受眾中…</span>
    </div>
    <div v-else-if="validateResult" class="admin-field-stack">
      <div v-if="validateResult.errors?.length" class="admin-alert admin-alert--warn">
        <ul>
          <li v-for="e in validateResult.errors" :key="e">{{ e }}</li>
        </ul>
      </div>
      <div v-else class="bc-validate-ok">
        <div class="bc-stats-row">
          <div class="bc-stat-box">
            <div class="bc-stat-label">預估發送人數</div>
            <div class="bc-stat-value">{{ validateResult.estimatedCount }}</div>
          </div>
        </div>
        <div v-if="validateResult.previewUserIds?.length" class="bc-preview-ids">
          <AdminFieldLabel text="名單預覽（前幾筆）" tight />
          <ul class="bc-preview-list">
            <li v-for="uid in validateResult.previewUserIds" :key="uid" class="td-code">{{ uid }}</li>
          </ul>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="validateDialogVisible = false">取消</el-button>
      <el-button
        v-if="validateResult && !validateResult.errors?.length"
        type="primary"
        :loading="sending"
        @click="confirmSend"
      >
        確認發送
      </el-button>
    </template>
  </el-dialog>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
import type { UnifiedAction } from '~~/shared/action-schema'
import { normalizeUnifiedAction, validateUnifiedAction } from '~~/shared/action-schema'
import { parseLineMessagesToUnifiedAction, unifiedActionToLineMessages } from '~~/shared/broadcast-content'
import { parseFirestoreDate } from '~~/shared/firestore-date'

definePageMeta({ middleware: 'auth', layout: 'default' })

/** 排程：不可選今天以前的日期 */
function disabledPastDate(d: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

// ── 狀態 ────────────────────────────────────────────────────────────
const broadcasts = ref<any[]>([])
const flows = ref<{ id: string; name: string }[]>([])
const { tags: allTags, loadTags: loadTagOptions } = useAdminTagList()
const loading = ref(true)
const saving = ref(false)
const validating = ref(false)
const sending = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const validateDialogVisible = ref(false)
const validateLoading = ref(false)
const validateResult = ref<any>(null)
const report = ref<any>(null)
const { toasts, showToast } = useAdminToast()

const defaultForm = () => ({
  name: '',
  audienceType: 'all' as 'all' | 'tags' | 'import',
  tagIds: [] as string[],
  importText: '',
  contentAction: normalizeUnifiedAction({ type: 'message', text: '' }, 'A') as UnifiedAction,
  scheduleMode: 'now' as 'now' | 'schedule',
  scheduleAt: '',
})
const form = ref(defaultForm())

const flowOptions = computed(() =>
  (flows.value ?? []).map((f) => ({ id: f.id, name: f.name || f.id })),
)

function onContentActionUpdate(next: Record<string, unknown>) {
  form.value.contentAction = normalizeUnifiedAction(next, 'A') as UnifiedAction
}

// ── 計算屬性 ─────────────────────────────────────────────────────────
const selectedItem = computed(() => broadcasts.value.find((b) => b.id === selectedId.value) ?? null)

const isReadOnly = computed(() => {
  if (isCreating.value) return false
  const s = selectedItem.value?.status
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'processing'
})

const importUserIds = computed(() =>
  form.value.importText.split('\n').map((l) => l.trim()).filter(Boolean),
)

// ── 工具函式 ─────────────────────────────────────────────────────────
function statusLabel(s: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    scheduled: '已排程',
    processing: '發送中',
    completed: '已完成',
    failed: '失敗',
    cancelled: '已取消',
  }
  return map[s] ?? s
}

function formatNullableStat(n: number | null | undefined): string {
  if (n == null) return '—'
  return String(n)
}

function formatPercentRate(rate: number | null | undefined): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(2)}%`
}

function bcMetaText(bc: any): string {
  const parts: string[] = []
  if (bc.audienceSnapshot?.estimatedCount) parts.push(`${bc.audienceSnapshot.estimatedCount} 人`)
  if (bc.scheduleAt) {
    const d = parseFirestoreDate(bc.scheduleAt)
    if (d) parts.push(d.toLocaleString('zh-TW'))
  }
  return parts.join(' · ')
}

function buildAudienceSource() {
  if (form.value.audienceType === 'all') return { type: 'all' }
  if (form.value.audienceType === 'tags') return { type: 'tags', tagIds: form.value.tagIds }
  return { type: 'import', importedUserIds: importUserIds.value }
}

function buildMessages(): Record<string, unknown>[] {
  return unifiedActionToLineMessages(form.value.contentAction)
}

function loadFormFromItem(item: any) {
  const src = item.audienceSource ?? {}
  form.value = {
    name: item.name ?? '',
    audienceType: src.type ?? 'all',
    tagIds: src.tagIds ?? [],
    importText: (src.importedUserIds ?? []).join('\n'),
    contentAction: parseLineMessagesToUnifiedAction(item.messages ?? []) as UnifiedAction,
    scheduleMode: item.scheduleAt ? 'schedule' : 'now',
    scheduleAt: item.scheduleAt ? (parseFirestoreDate(item.scheduleAt)?.toISOString() ?? '') : '',
  }
}

/** 列表 API 不含 messages，編輯／檢視必須另拉詳情 */
async function fetchBroadcastDetail(id: string): Promise<any | null> {
  try {
    return await $fetch(`/api/broadcast/${id}`)
  }
  catch {
    return null
  }
}

async function loadFormFromId(id: string): Promise<boolean> {
  const full = await fetchBroadcastDetail(id)
  if (!full) return false
  loadFormFromItem(full)
  return true
}

function validateForm(): string | null {
  if (!form.value.name.trim()) return '請填寫推播名稱'
  if (form.value.audienceType === 'tags' && !form.value.tagIds.length) return '請至少選擇一個標籤'
  if (form.value.audienceType === 'import' && !importUserIds.value.length) return '請輸入至少一個 LINE User ID'
  const actionErr = validateUnifiedAction(form.value.contentAction)
  if (actionErr) return actionErr
  const msgs = buildMessages()
  if (!msgs.length) return '請設定訊息內容'
  if (form.value.scheduleMode === 'schedule' && !form.value.scheduleAt) return '請選擇排程時間'
  return null
}

// ── API 操作 ─────────────────────────────────────────────────────────
async function loadData() {
  loading.value = true
  try {
    const [bcs, tagOk, flowList] = await Promise.all([
      $fetch<any[]>('/api/broadcast/list'),
      loadTagOptions({ status: 'active' }),
      $fetch<any[]>('/api/flow/list').catch(() => []),
    ])
    broadcasts.value = bcs ?? []
    flows.value = (flowList ?? []).map((f: any) => ({ id: f.id, name: f.name || f.id }))
    if (!tagOk) showToast('載入標籤失敗', 'error')
  }
  catch {
    showToast('載入推播失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

async function loadReport() {
  if (!selectedId.value) return
  try {
    report.value = await $fetch(`/api/broadcast/${selectedId.value}/report`)
  }
  catch {
    report.value = null
  }
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  report.value = null
  form.value = defaultForm()
}

async function selectItem(item: any) {
  isCreating.value = false
  selectedId.value = item.id
  report.value = null
  const ok = await loadFormFromId(item.id)
  if (!ok) {
    showToast('載入推播內容失敗', 'error')
    return
  }
  if (['completed', 'failed'].includes(item.status)) {
    loadReport()
  }
}

async function cancelEdit() {
  if (selectedId.value) {
    await loadFormFromId(selectedId.value)
    isCreating.value = false
  }
  else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
}

async function saveDraft() {
  const err = validateForm()
  if (err) return showToast(err, 'error')
  saving.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      audienceSource: buildAudienceSource(),
      messages: buildMessages(),
      scheduleAt: form.value.scheduleMode === 'schedule' ? form.value.scheduleAt : undefined,
    }
    if (isCreating.value) {
      const created = await $fetch<any>('/api/broadcast/create', { method: 'POST', body })
      showToast('草稿已建立 ✅', 'success')
      await loadData()
      selectedId.value = created.id
      isCreating.value = false
      if (!(await loadFormFromId(created.id))) showToast('已建立但載入內容失敗，請重新點選該推播', 'error')
    }
    else {
      await $fetch(`/api/broadcast/${selectedId.value}`, { method: 'PUT', body })
      showToast('草稿已儲存 ✅', 'success')
      await loadData()
      if (selectedId.value && !(await loadFormFromId(selectedId.value))) {
        showToast('已儲存但載入內容失敗，請重新點選該推播', 'error')
      }
    }
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

async function openValidateDialog() {
  const err = validateForm()
  if (err) return showToast(err, 'error')

  // 先儲存草稿確保最新內容已同步
  await saveDraft()
  if (!selectedId.value) return

  validateDialogVisible.value = true
  validateLoading.value = true
  validateResult.value = null
  try {
    validateResult.value = await $fetch(`/api/broadcast/${selectedId.value}/validate`, { method: 'POST' })
  }
  catch {
    showToast('驗證失敗', 'error')
    validateDialogVisible.value = false
  }
  finally {
    validateLoading.value = false
  }
}

async function confirmSend() {
  if (!selectedId.value) return
  sending.value = true
  try {
    const res = await $fetch<any>(`/api/broadcast/${selectedId.value}/send`, { method: 'POST' })
    showToast(`發送完成 ✅ 成功 ${res.sentCount} / 失敗 ${res.failedCount}`, 'success')
    validateDialogVisible.value = false
    await loadData()
    const found = broadcasts.value.find((b) => b.id === selectedId.value)
    if (found) await selectItem(found)
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '發送失敗', 'error')
  }
  finally {
    sending.value = false
  }
}

async function cancelBroadcast() {
  if (!selectedId.value || !confirm('確定要取消這則推播？')) return
  try {
    await $fetch(`/api/broadcast/${selectedId.value}/cancel`, { method: 'POST' })
    showToast('已取消推播', 'success')
    await loadData()
    if (selectedId.value) await loadFormFromId(selectedId.value)
  }
  catch {
    showToast('取消失敗', 'error')
  }
}

onMounted(loadData)
</script>
