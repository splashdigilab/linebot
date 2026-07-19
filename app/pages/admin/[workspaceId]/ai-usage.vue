<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="AI 客服"
        title="用量 / 監控"
        caption="這個月的 AI 用量、自動回覆率、待補知識清單"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-select v-model="period" size="small" data-tour="usg-period" style="width: 130px" @change="loadAll">
          <el-option
            v-for="opt in periodOptions"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">重新整理</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="usage-body admin-panel-stack">
        <!-- ── 方案額度（D1 進度條 / D2 超量提示） ── -->
        <template v-if="planQuota">
          <el-alert
            v-if="isCurrentPeriod && quotaState === 'over'"
            type="error"
            :closable="false"
            show-icon
            title="本月則數已用完"
            style="margin-bottom: 16px"
          >
            <div class="quota-alert-body">
              <span>AI 自動回覆已暫停、改由真人接手。升級方案或加購額度即可恢復自動回覆。</span>
              <el-button size="small" type="primary" @click="upgradeDialogOpen = true">升級方案</el-button>
            </div>
          </el-alert>
          <el-alert
            v-else-if="isCurrentPeriod && quotaState === 'near'"
            type="warning"
            :closable="false"
            show-icon
            title="本月則數即將用完"
            style="margin-bottom: 16px"
          >
            <div class="quota-alert-body">
              <span>已使用 {{ quotaPercentRaw }}%，用完後 AI 會暫停自動回覆並轉真人，建議提前升級方案。</span>
              <el-button size="small" type="primary" @click="upgradeDialogOpen = true">升級方案</el-button>
            </div>
          </el-alert>

          <div class="message-card usage-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">方案額度</span>
                <span class="text-xs text-muted">{{ planQuota.name }} · 本期 {{ quotaPeriodLabel }}</span>
              </div>
              <div class="plan-card-head-actions">
                <span v-if="planQuota.currentPeriodEnd" class="text-xs text-muted">{{ planQuota.currentPeriodEnd }} 續期</span>
                <el-button size="small" @click="upgradeDialogOpen = true">升級方案</el-button>
              </div>
            </div>
            <div class="card-section-stack">
              <template v-if="quotaLimit != null">
                <el-progress
                  :percentage="quotaPercent"
                  :color="quotaColor"
                  :stroke-width="18"
                  :text-inside="true"
                  :format="() => `${quotaPercentRaw}%`"
                />
                <p class="usage-hint">
                  本期已用 <strong>{{ formatNumber(quotaUsed) }}</strong> / {{ formatNumber(quotaLimit) }} 則
                  <template v-if="quotaRemaining !== null">（剩 {{ formatNumber(quotaRemaining) }} 則）</template>
                  <template v-if="planQuota.overagePerReply">・超量加購 NT${{ planQuota.overagePerReply }}/則</template>
                </p>
              </template>
              <p v-else class="usage-hint">此方案為客製額度，無固定則數上限。</p>
            </div>
          </div>

          <AdminPlanUpgradeDialog v-model="upgradeDialogOpen" :current-plan-id="planQuota.id" />
        </template>

        <!-- ── KPI cards ─────────────────────── -->
        <div class="message-card usage-card" data-tour="usg-kpi">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">核心指標</span>
              <span class="text-xs text-muted">{{ periodLabel }}</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div v-if="loading && !summary" class="usage-loading"><div class="spinner" /></div>
            <div v-else class="usage-kpi-grid">
              <div class="usage-kpi">
                <span class="usage-kpi__label">AI 介入次數</span>
                <strong>{{ formatNumber(summary?.invocations) }}</strong>
              </div>
              <div class="usage-kpi usage-kpi--success">
                <span class="usage-kpi__label">自動回覆率</span>
                <strong>{{ formatPercent(summary?.autoReplyRate) }}</strong>
                <span class="usage-kpi__sub">{{ formatNumber(summary?.answered) }} 次自動答完</span>
              </div>
              <div class="usage-kpi usage-kpi--warning">
                <span class="usage-kpi__label">轉真人率</span>
                <strong>{{ formatPercent(summary?.handoffRate) }}</strong>
                <span class="usage-kpi__sub">{{ formatNumber(summary?.handoffs) }} 次轉接</span>
              </div>
              <div class="usage-kpi usage-kpi--warning">
                <span class="usage-kpi__label">答後仍轉真人</span>
                <strong>{{ formatPercent(summary?.answeredThenHandoffRate) }}</strong>
                <span class="usage-kpi__sub">{{ formatNumber(summary?.answeredThenHandoffs) }} 次（AI 回答後客人還是要找真人，可視為「沒答到重點」，越低越好）</span>
              </div>
              <div class="usage-kpi usage-kpi--warning">
                <span class="usage-kpi__label">反問澄清率</span>
                <strong>{{ formatPercent(summary?.disambiguationRate) }}</strong>
                <span class="usage-kpi__sub">{{ formatNumber(summary?.disambiguations) }} 次反問（AI 先問客人「要哪一個」才作答；偏高通常代表知識卡標題太相近，或可到設定調整反問門檻）</span>
              </div>
              <div class="usage-kpi">
                <span class="usage-kpi__label">每對話成本</span>
                <strong>${{ summary?.perConversationUsd?.toFixed(4) ?? '0.0000' }}</strong>
                <span class="usage-kpi__sub">本月 ${{ summary?.estimatedCostUsd?.toFixed(2) ?? '0.00' }} USD</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Token breakdown ─────────────────── -->
        <div class="message-card usage-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">用量明細（Token）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="usage-tokens">
              <div class="usage-token-row">
                <span class="text-muted">Input</span>
                <strong>{{ formatNumber(summary?.inputTokens) }}</strong>
                <span class="text-xs text-muted">送進 AI 的內容（客人問題 + 參考的知識卡）</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">Output</span>
                <strong>{{ formatNumber(summary?.outputTokens) }}</strong>
                <span class="text-xs text-muted">AI 生成的回覆</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">Embedding</span>
                <strong>{{ formatNumber(summary?.embeddingTokens) }}</strong>
                <span class="text-xs text-muted">把客人問題轉成可搜尋的形式，用來找對應的知識卡</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">匯入 / 整理</span>
                <strong>{{ formatNumber((summary?.importInputTokens ?? 0) + (summary?.importOutputTokens ?? 0)) }}</strong>
                <span class="text-xs text-muted">匯入資料時，AI 幫忙切成知識卡、整理內容所花的量（已含在上方 Input / Output 內）</span>
              </div>
            </div>
            <p class="usage-hint">
              這裡的金額是依 Gemini Flash 公開價格估算的<strong>偏高參考值</strong>（部分呼叫實際走更便宜的 Flash-Lite）<template v-if="pricing">，每 100 萬用量：送入 ${{ pricing.inputPerM }} / 產生 ${{ pricing.outputPerM }} / 搜尋 ${{ pricing.embedPerM }}</template>。
              實際費用還是以 Google 帳單為準。
            </p>
          </div>
        </div>

        <!-- ── 低信心 / 轉真人案例 ──────────────── -->
        <div class="message-card usage-card" data-tour="usg-cases">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">近期轉真人案例</span>
              <span class="text-xs text-muted">最近待處理・不分月份</span>
              <el-select v-model="reasonFilter" size="small" style="width: 150px" @change="loadHandoffs">
                <el-option label="全部原因" value="" />
                <!-- 由共用標籤表導出:手打第二份會漂移(曾發生下拉與列表徽章同一原因兩種名字) -->
                <el-option
                  v-for="opt in reasonOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <el-checkbox v-model="showResolved" size="small" @change="loadHandoffs">顯示已處理</el-checkbox>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="usage-hint">
              客人問了 AI 但答不出來的情況。點「📥 補知識」直接到知識庫補一張對應卡。
            </p>
            <div v-if="loadingHandoffs && !handoffs.length" class="usage-loading"><div class="spinner" /></div>
            <div v-else-if="!handoffs.length" class="usage-empty">目前沒有待處理的轉真人案例 🎉</div>
            <div v-else class="usage-handoff-list">
              <div v-for="row in handoffs" :key="`${row.userId}-${row.updatedAtMs}`" class="usage-handoff-row" :class="{ 'usage-handoff-row--resolved': row.resolved }">
                <div class="usage-handoff-meta">
                  <span :class="reasonBadgeClass(row.handoffReason)">{{ reasonLabel(row.handoffReason) }}</span>
                  <span v-if="row.resolved" class="badge badge-gray">已處理</span>
                  <span class="text-xs text-muted">信心 {{ row.lastConfidence.toFixed(2) }} · {{ formatTime(row.updatedAtMs) }}</span>
                </div>
                <div class="usage-handoff-query">
                  <span class="usage-handoff-user">{{ row.displayName || '匿名客人' }}：</span>
                  <span>{{ row.lastQuery || '(無問題內容)' }}</span>
                </div>
                <div v-if="row.sources.length" class="usage-handoff-sources">
                  最相近卡：{{ row.sources.slice(0, 2).map(s => s.title).join('、') }}
                </div>
                <div class="usage-handoff-actions">
                  <el-button :icon="ChatDotRound" size="small" plain @click="goConversation(row.userId)">開對話</el-button>
                  <el-button :icon="Upload" size="small" type="primary" plain @click="goAddKnowledge(row.lastQuery)">補知識</el-button>
                  <el-button size="small" plain @click="goPlayground(row.lastQuery)">▶ 重演</el-button>
                  <el-button v-if="!row.resolved" size="small" type="success" plain :loading="resolvingUserId === row.userId" @click="resolveHandoff(row.userId)">✓ 已處理</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { ChatDotRound, Refresh, Upload } from '@element-plus/icons-vue'
import { HANDOFF_REASON_LABELS, type HandoffReason } from '~~/shared/types/ai-knowledge'
import { useAdminToast } from '~~/app/composables/useAdminToast'
import { derivePlanState } from '~~/shared/billing/plan-state'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const { showToast } = useAdminToast()

interface Summary {
  period: string
  /** 本期（訂閱週期）已用則數 —— 額度進度條看這個，與攔截同一顆計數器；不隨月份切換。 */
  quotaAnswered: number
  invocations: number
  answered: number
  handoffs: number
  answeredThenHandoffs: number
  answeredThenHandoffRate: number
  disambiguations: number
  disambiguationRate: number
  inputTokens: number
  outputTokens: number
  embeddingTokens: number
  importInputTokens: number
  importOutputTokens: number
  autoReplyRate: number
  handoffRate: number
  estimatedCostUsd: number
  perConversationUsd: number
  pricing: { inputPerM: number; outputPerM: number; embedPerM: number }
  plan: {
    id: string
    name: string
    answeredQuota: number | null
    overagePerReply: number | null
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
  } | null
}

interface HandoffRow {
  userId: string
  displayName: string
  lastQuery: string
  lastConfidence: number
  handoffReason: HandoffReason | null
  resolved: boolean
  sources: Array<{ chunkId: string; title: string }>
  updatedAtMs: number
}

const summary = ref<Summary | null>(null)
const handoffs = ref<HandoffRow[]>([])
const loading = ref(false)
const loadingHandoffs = ref(false)
const reasonFilter = ref<'' | HandoffReason>('')
const showResolved = ref(false)

// 'manual' 是內部人工指定,不提供篩選(後端白名單同樣排除)
const reasonOptions = (Object.entries(HANDOFF_REASON_LABELS) as Array<[HandoffReason, string]>)
  .filter(([value]) => value !== 'manual')
  .map(([value, label]) => ({ value, label }))

// 單價由 summary API 回傳（後端單一事實來源），還沒載到前先不顯示數字
const pricing = computed(() => summary.value?.pricing ?? null)

// ── Period selector（過去 3 個月） ─────────────────────────
function makePeriodOptions() {
  const opts: Array<{ value: string; label: string }> = []
  // 月結桶用台灣時區（與 server currentYyyyMm / taipeiYyyyMm 同一把尺;台灣固定 UTC+8）
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000)
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth() - i, 1))
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    opts.push({ value: `${y}${m}`, label: `${y}-${m}` })
  }
  return opts
}
const periodOptions = makePeriodOptions()
const period = ref(periodOptions[0]!.value)
const periodLabel = computed(() => periodOptions.find(o => o.value === period.value)?.label ?? period.value)
const isCurrentPeriod = computed(() => period.value === periodOptions[0]!.value)

// ── 方案額度（D1/D2） ─────────────────────────────────────
// 額度狀態（門檻/顏色）由共用的 derivePlanState 導出，與設定頁方案卡同一份邏輯。
// 進度條吃 quotaAnswered（本期 = 訂閱週期）而不是 answered（所選月份的報表數字）——
// 額度按錨定日重置，跟日曆月不是同一把尺，拿報表數字當進度條會顯示錯的剩餘則數。
const planQuota = computed(() => summary.value?.plan ?? null)
const upgradeDialogOpen = ref(false)
const planState = computed(() => derivePlanState(planQuota.value, summary.value?.quotaAnswered ?? 0))
// 額度週期的起訖（錨定日制，例如 07/28 ~ 08/27）；與下方報表的月份選擇無關。
const quotaPeriodLabel = computed(() => {
  const p = planQuota.value
  if (!p?.currentPeriodStart || !p.currentPeriodEnd) return '—'
  return `${p.currentPeriodStart.slice(5)} ~ ${p.currentPeriodEnd.slice(5)}`
})
const quotaUsed = computed(() => planState.value.used)
const quotaLimit = computed(() => planState.value.limit)
const quotaPercentRaw = computed(() => planState.value.percentRaw)
const quotaPercent = computed(() => planState.value.percent)
const quotaRemaining = computed(() => planState.value.remaining)
const quotaState = computed(() => planState.value.state)
const quotaColor = computed(() => planState.value.color)

// ── Loaders ───────────────────────────────────────────────
async function loadSummary() {
  loading.value = true
  try {
    summary.value = await apiFetch<Summary>(`/api/ai/usage/summary?period=${period.value}`)
  }
  catch {
    summary.value = null
  }
  finally {
    loading.value = false
  }
}

async function loadHandoffs() {
  loadingHandoffs.value = true
  try {
    const params = new URLSearchParams({ limit: '20' })
    if (reasonFilter.value) params.set('reason', reasonFilter.value)
    if (showResolved.value) params.set('includeResolved', '1')
    handoffs.value = await apiFetch<HandoffRow[]>(`/api/ai/usage/handoffs?${params.toString()}`)
  }
  catch {
    handoffs.value = []
  }
  finally {
    loadingHandoffs.value = false
  }
}

async function loadAll() {
  await Promise.all([loadSummary(), loadHandoffs()])
}

// ── Format helpers ────────────────────────────────────────
function formatNumber(n?: number | null) {
  return (n ?? 0).toLocaleString('zh-TW')
}
function formatPercent(n?: number | null) {
  return `${Math.round((n ?? 0) * 100)}%`
}
function formatTime(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
function reasonLabel(r: HandoffReason | null) {
  return r ? HANDOFF_REASON_LABELS[r] ?? r : '(未知)'
}
function reasonBadgeClass(r: HandoffReason | null) {
  if (r === 'low_confidence') return 'badge badge-yellow'
  if (r === 'no_grounding') return 'badge badge-yellow'
  if (r === 'sensitive_topic') return 'badge badge-red'
  if (r === 'quota_exceeded') return 'badge badge-red'
  return 'badge badge-gray'
}

// ── Navigation ────────────────────────────────────────────
function goConversation(userId: string) {
  router.push(`/admin/${workspaceId.value}/conversations?userId=${encodeURIComponent(userId)}`)
}
function goAddKnowledge(query: string) {
  // 帶客人原句過去:來源頁會自動開「新增手寫」視窗並預填標題,不用重打一遍
  const q = (query || '').trim()
  const suffix = q ? `?q=${encodeURIComponent(q)}` : ''
  router.push(`/admin/${workspaceId.value}/knowledge/sources${suffix}`)
}
function goPlayground(query: string) {
  router.push(`/admin/${workspaceId.value}/ai-playground?q=${encodeURIComponent(query)}`)
}

const resolvingUserId = ref<string | null>(null)
async function resolveHandoff(userId: string) {
  resolvingUserId.value = userId
  try {
    await apiFetch('/api/ai/usage/handoffs/resolve', { method: 'POST', body: { userId } })
    // 「顯示已處理」開著時原地標記(可回顧);關著時直接從列表移除
    if (showResolved.value) {
      const row = handoffs.value.find(r => r.userId === userId)
      if (row) row.resolved = true
    }
    else {
      handoffs.value = handoffs.value.filter(r => r.userId !== userId)
    }
  }
  catch {
    // 保留在列表上讓使用者重試；沒有回饋會讓人以為按了沒反應而連點
    showToast('標記失敗，請再試一次', 'error')
  }
  finally {
    resolvingUserId.value = null
  }
}

onMounted(() => loadAll())
</script>

<style scoped lang="scss">
.usage-body {
  padding: 16px;
  max-width: 960px;
  margin: 0 auto;
}

.usage-card {
  margin-bottom: 16px;
}

.usage-loading {
  display: flex;
  justify-content: center;
  padding: 24px;
}

.usage-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.usage-kpi {
  background: var(--el-fill-color-light);
  padding: 14px;
  border-radius: 6px;
  text-align: center;

  &--success {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
  }
  &--warning {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
  }

  &__label {
    display: block;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
  }
  strong {
    display: block;
    font-size: 22px;
  }
  &__sub {
    display: block;
    font-size: 11px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }
}

.usage-tokens {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.usage-token-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;

  strong {
    min-width: 120px;
    font-variant-numeric: tabular-nums;
  }
}

.usage-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin: 8px 0 0;
}

.usage-empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-style: italic;
}

.usage-handoff-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.usage-handoff-row {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border-left: 3px solid var(--el-color-warning);

  &--resolved {
    opacity: 0.65;
    border-left-color: var(--el-border-color);
  }
}

.usage-handoff-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.usage-handoff-query {
  font-size: 13px;
  margin-bottom: 4px;
}

.usage-handoff-user {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.usage-handoff-sources {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.usage-handoff-actions {
  display: flex;
  gap: 6px;
}
</style>
