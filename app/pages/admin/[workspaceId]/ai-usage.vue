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
        <!-- ── AI 狀態列：老闆第一眼要知道 AI 有沒有在跑；未啟用時點明數字是歷史/測試 ── -->
        <div v-if="aiStatus" class="usage-status" :class="`usage-status--${aiStatus.tone}`">
          <span class="usage-status__dot" />
          <div class="usage-status__body">
            <span class="usage-status__title">{{ aiStatus.title }}</span>
            <span class="usage-status__desc">{{ aiStatus.desc }}</span>
          </div>
          <el-button v-if="aiStatus.tone === 'off'" size="small" type="primary" @click="goSettings">去啟用</el-button>
        </div>

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
                <span class="section-title">方案額度</span>
                <span class="text-xs text-muted">{{ planQuota.name }} · 本期 {{ quotaPeriodLabel }}</span>
              </div>
              <div class="plan-card-head-actions">
                <span v-if="planQuota.currentPeriodEnd" class="text-xs text-muted">{{ planQuota.currentPeriodEnd }} 續期</span>
                <!-- 無固定則數上限（客製/內部方案）打不到額度，升級對他沒意義 → 不顯示，避免噪音 -->
                <el-button v-if="quotaLimit != null" size="small" @click="upgradeDialogOpen = true">升級方案</el-button>
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
              <span class="section-title">核心指標</span>
              <span class="text-xs text-muted">{{ periodLabel }}</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div v-if="loading && !summary" class="usage-loading"><div class="spinner" /></div>
            <template v-else>
              <!-- Hero：AI 介入 = 答完 + 轉真人 + 反問（乾淨拆解，一條分段長條看懂產出結構） -->
              <div class="usage-hero">
                <div class="usage-hero__head">
                  <strong class="usage-hero__num">{{ formatNumber(summary?.invocations) }}</strong>
                  <span class="usage-hero__label">次 <b>AI 介入</b><br>本期間 AI 出手的總次數</span>
                </div>
                <template v-if="(summary?.invocations ?? 0) > 0">
                  <div
                    class="usage-segbar"
                    role="img"
                    :aria-label="`答完 ${summary?.answered}、轉真人 ${summary?.handoffs}、反問 ${summary?.disambiguations}`"
                  >
                    <span class="usage-seg usage-seg--answered" :style="{ width: `${segPct.answered}%` }" />
                    <span class="usage-seg usage-seg--handoff" :style="{ width: `${segPct.handoff}%` }" />
                    <span class="usage-seg usage-seg--clarify" :style="{ width: `${segPct.clarify}%` }" />
                  </div>
                  <div class="usage-legend">
                    <div class="usage-leg usage-leg--answered">
                      <span class="usage-leg__dot" />
                      <span class="usage-leg__k">答完</span>
                      <span class="usage-leg__v">{{ formatNumber(summary?.answered) }}</span>
                      <span class="usage-leg__pct">{{ formatPercent(summary?.autoReplyRate) }}</span>
                    </div>
                    <div class="usage-leg usage-leg--handoff">
                      <span class="usage-leg__dot" />
                      <span class="usage-leg__k">轉真人</span>
                      <span class="usage-leg__v">{{ formatNumber(summary?.handoffs) }}</span>
                      <span class="usage-leg__pct">{{ formatPercent(summary?.handoffRate) }}</span>
                    </div>
                    <div class="usage-leg usage-leg--clarify">
                      <span class="usage-leg__dot" />
                      <span class="usage-leg__k">
                        反問澄清
                        <el-tooltip placement="top" content="AI 先問客人「要哪一個」才作答；偏高通常代表知識卡標題太相近，或可到設定調整反問門檻">
                          <el-icon class="usage-leg__info"><InfoFilled /></el-icon>
                        </el-tooltip>
                      </span>
                      <span class="usage-leg__v">{{ formatNumber(summary?.disambiguations) }}</span>
                      <span class="usage-leg__pct">{{ formatPercent(summary?.disambiguationRate) }}</span>
                    </div>
                  </div>
                </template>
                <div v-else class="usage-empty">本期間 AI 尚未出手</div>
              </div>

              <!-- 次要指標：品質 proxy + 成本（標籤不寫死「本月」——月份可切到過去） -->
              <div class="usage-substats">
                <div class="usage-substat">
                  <span class="usage-substat__label">
                    答後仍轉真人
                    <el-tooltip placement="top" content="AI 回答後客人還是要找真人，可視為「沒答到重點」，越低越好">
                      <el-icon class="usage-substat__info"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </span>
                  <strong class="usage-substat__value" :class="metricTone('answeredThenHandoff', summary?.answeredThenHandoffRate)">{{ formatPercent(summary?.answeredThenHandoffRate) }}</strong>
                  <span class="usage-substat__sub">{{ formatNumber(summary?.answeredThenHandoffs) }} 次</span>
                </div>
                <div class="usage-substat">
                  <span class="usage-substat__label">
                    AI 成本
                    <el-tooltip placement="top" content="只計「客人對話」。知識庫建置（匯入 / 建索引）與 playground 測試的花費，都在下方「用量明細」分開列，不含在此、也不影響每對話成本">
                      <el-icon class="usage-substat__info"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </span>
                  <strong class="usage-substat__value">${{ summary?.estimatedCostUsd?.toFixed(2) ?? '0.00' }}</strong>
                  <span class="usage-substat__sub">
                    每對話約 ${{ summary?.perConversationUsd?.toFixed(4) ?? '0.0000' }} USD<template v-if="((summary?.buildCostUsd ?? 0) + (summary?.testCostUsd ?? 0)) > 0"> · 建置 / 測試另計，見明細</template>
                  </span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- ── Token breakdown（技術明細，預設收合：老闆在乎成本不在乎 token） ── -->
        <div class="message-card usage-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="section-title">用量明細（Token）</span>
              <span class="text-xs text-muted">成本估算的技術依據</span>
            </div>
            <el-button text size="small" @click="tokenOpen = !tokenOpen">
              {{ tokenOpen ? '收合' : '展開技術明細' }}
              <el-icon class="el-icon--right"><component :is="tokenOpen ? ArrowUp : ArrowDown" /></el-icon>
            </el-button>
          </div>
          <div v-show="tokenOpen" class="card-section-stack">
            <!-- 依「用途」把花費拆三桶：客人對話才是上方「AI 成本」；建置與測試各自獨立、不灌進每對話成本 -->
            <div class="usage-cost-split">
              <div class="usage-cost-row">
                <span class="usage-cost-row__dot usage-cost-row__dot--conv" />
                <span class="usage-cost-row__k">客人對話</span>
                <span class="usage-cost-row__tok">{{ formatNumber(summary?.conversationTokens) }} tokens</span>
                <strong class="usage-cost-row__cost">${{ (summary?.estimatedCostUsd ?? 0).toFixed(2) }}</strong>
              </div>
              <div class="usage-cost-row">
                <span class="usage-cost-row__dot usage-cost-row__dot--build" />
                <span class="usage-cost-row__k">知識庫建置</span>
                <span class="usage-cost-row__tok">{{ formatNumber(summary?.buildTokens) }} tokens</span>
                <strong class="usage-cost-row__cost">${{ (summary?.buildCostUsd ?? 0).toFixed(2) }}</strong>
              </div>
              <div class="usage-cost-row">
                <span class="usage-cost-row__dot usage-cost-row__dot--test" />
                <span class="usage-cost-row__k">後台測試</span>
                <span class="usage-cost-row__tok">{{ formatNumber(summary?.testTokens) }} tokens</span>
                <strong class="usage-cost-row__cost">${{ (summary?.testCostUsd ?? 0).toFixed(2) }}</strong>
              </div>
              <div class="usage-cost-total">
                <span>合計 · 工作區總花費</span>
                <strong>${{ totalCostUsd.toFixed(2) }}</strong>
              </div>
            </div>
            <p class="usage-hint">
              成本依「用途」拆三塊：<strong>客人對話</strong>＝跟真客人來回問答（上方「AI 成本」就是這桶）；<strong>知識庫建置</strong>＝匯入、切卡、建索引，屬一次性 / 偶爾的花費，不是每次對話都有；<strong>後台測試</strong>＝你在 playground「重演」試打，不計入客人成本。
            </p>
            <p class="usage-hint">
              金額是依 Gemini Flash 公開價格估算的<strong>偏高參考值</strong>（部分呼叫實際走更便宜的 Flash-Lite）<template v-if="pricing">，每 100 萬用量：送入 ${{ pricing.inputPerM }} / 產生 ${{ pricing.outputPerM }} / 搜尋 ${{ pricing.embedPerM }}</template>。實際費用以 Google 帳單為準。
            </p>
          </div>
        </div>

        <!-- ── 低信心 / 轉真人案例 ──────────────── -->
        <div class="message-card usage-card" data-tour="usg-cases">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="section-title">近期轉真人案例</span>
              <span class="text-xs text-muted">還沒處理的問題</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="usage-hint">
              客人問了 AI 但答不出來的情況。點「補知識」直接到知識庫補一張對應卡。
            </p>
            <!-- 篩選移到卡片內（不再擠在標題列），並補中文 placeholder（原本顯示英文「Select」） -->
            <div class="usage-handoff-toolbar">
              <el-select v-model="reasonFilter" size="small" placeholder="全部原因" style="width: 150px" @change="loadHandoffs">
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
            <div v-if="loadingHandoffs && !handoffs.length" class="usage-loading"><div class="spinner" /></div>
            <!-- 和解：此清單＝「目前還卡著、尚未處理」的對話（不分月份），與上方本月轉接次數不是同一份計數，
                 避免「本月 141 次轉接」與「0 待處理」被誤讀成互相矛盾。空狀態要像「已清空」而非「沒資料」。 -->
            <div v-else-if="!handoffs.length" class="usage-empty usage-empty--good">
              <span class="usage-empty__icon">✓</span>
              <div>
                <div class="usage-empty__title">沒有待補知識的轉真人對話了</div>
                <div class="usage-empty__desc">這裡只列「目前還卡著、尚未處理」的對話，和上方本月轉接次數不是同一份計數。想回顧請勾「顯示已處理」。</div>
              </div>
            </div>
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
import { ArrowDown, ArrowUp, ChatDotRound, InfoFilled, Refresh, Upload } from '@element-plus/icons-vue'
import { HANDOFF_REASON_LABELS, type HandoffReason } from '~~/shared/types/ai-knowledge'
import { useAdminToast } from '~~/app/composables/useAdminToast'
import { derivePlanState } from '~~/shared/billing/plan-state'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const { showToast } = useAdminToast()

// 用量明細（Token）預設收合：一般人只看成本，需要技術數字才展開
const tokenOpen = ref(false)

interface Summary {
  period: string
  /** AI 自動回覆是否已啟用；未啟用時 webhook 不跑 AI，畫面數字皆為歷史/測試 */
  aiEnabled: boolean
  replyMode: 'auto' | 'draft'
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
  /** 三桶用途拆分：客人對話（headline 成本就是這桶）/ 知識庫建置 / 後台測試 */
  conversationTokens: number
  buildTokens: number
  buildCostUsd: number
  testTokens: number
  testCostUsd: number
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

// AI 介入的三種結果佔比（分段長條寬度）。已驗證每次介入只記一種結果，
// 故 invocations = answered + handoffs + disambiguations 恆等，三段相加即 100%。
const segPct = computed(() => {
  const total = summary.value?.invocations || 0
  if (!total) return { answered: 0, handoff: 0, clarify: 0 }
  return {
    answered: ((summary.value?.answered ?? 0) / total) * 100,
    handoff: ((summary.value?.handoffs ?? 0) / total) * 100,
    clarify: ((summary.value?.disambiguations ?? 0) / total) * 100,
  }
})

// 頂端狀態列：AI 有沒有在跑（老闆第一眼要知道的）。未啟用時特別點明「數字是歷史/測試」。
const aiStatus = computed(() => {
  if (!summary.value) return null
  if (!summary.value.aiEnabled) {
    return { tone: 'off', title: 'AI 客服尚未啟用', desc: '客人目前不會收到 AI 回覆。下方數字是先前建置或測試留下的，不是真實客服表現。' }
  }
  if (summary.value.replyMode === 'draft') {
    return { tone: 'draft', title: 'AI 草稿模式', desc: 'AI 會擬好回覆放進收件匣，但不會自動發送給客人。' }
  }
  return { tone: 'on', title: 'AI 客服運作中', desc: '客人傳訊息時，AI 會自動回答；答不出來的會轉給真人。' }
})
function goSettings() {
  router.push(`/admin/${workspaceId.value}/ai-settings`)
}

// 三桶成本相加＝工作區總花費（客人對話 + 知識庫建置 + 後台測試）
const totalCostUsd = computed(() => {
  const s = summary.value
  if (!s) return 0
  return (s.estimatedCostUsd ?? 0) + (s.buildCostUsd ?? 0) + (s.testCostUsd ?? 0)
})

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

/**
 * 依「數值門檻」決定數字顏色（rates 為 0~1）。
 * 正向指標（越高越好）好→綠；負向指標（越高越糟）過線才橘。
 * 重點：0% 的「答後仍轉真人」是滿分，要綠不是橘——不再無條件警告。
 */
function metricTone(kind: string, v?: number | null): string {
  const x = v ?? 0
  if (kind === 'autoReply') return x >= 0.5 ? 'is-good' : x < 0.2 ? 'is-warn' : 'is-neutral'
  if (kind === 'handoff') return x <= 0.3 ? 'is-good' : x > 0.6 ? 'is-warn' : 'is-neutral'
  if (kind === 'answeredThenHandoff') return x <= 0.1 ? 'is-good' : x > 0.25 ? 'is-warn' : 'is-neutral'
  if (kind === 'disambiguation') return x <= 0.15 ? 'is-good' : x > 0.3 ? 'is-warn' : 'is-neutral'
  return 'is-neutral'
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
  /* width:100% 是關鍵：.usage-body 也是 flex 直向容器（admin-panel-stack），
     一旦吃 margin:0 auto 又沒給寬度，flex 子項會縮到內容寬 → 整柱塌成 ~280px、
     max-width 形同虛設。給 100% 才會撐到 960 再置中。 */
  width: 100%;
  padding: 16px;
  max-width: 960px;
  margin: 0 auto;
}

.usage-card {
  margin-bottom: 16px;
}

/* 頂端 AI 狀態列：運作中=綠、草稿=琥珀、未啟用=灰。顏色帶語意，一眼判斷 AI 有沒有在跑 */
.usage-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  background: var(--bg-surface);

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    background: var(--text-muted);
  }
  &__body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  &__title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }
  &__desc {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &--on {
    background: var(--brand-green-wash);
    border-color: rgba(6, 199, 85, 0.3);

    .usage-status__dot {
      background: var(--brand-green);
      box-shadow: 0 0 0 4px rgba(6, 199, 85, 0.18);
    }
  }
  &--draft {
    background: #fdf6e9;
    border-color: rgba(217, 154, 43, 0.35);

    .usage-status__dot { background: #d99a2b; }
  }
  &--off {
    background: var(--el-fill-color-light);

    .usage-status__dot { background: var(--text-muted); }
  }
}

.usage-loading {
  display: flex;
  justify-content: center;
  padding: 24px;
}

/* ── Hero：AI 介入 = 答完 + 轉真人 + 反問（分母一致、相加成整體） ── */
.usage-hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.usage-hero__head {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.usage-hero__num {
  font-size: 40px;
  font-weight: 750;
  line-height: 0.95;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.usage-hero__label {
  font-size: 12px;
  line-height: 1.35;
  color: var(--el-text-color-secondary);
  padding-bottom: 4px;

  b { color: var(--text-primary); font-weight: 600; }
}

/* 分段長條：顏色帶語意——答完＝綠（自助成功）、轉真人＝藍（正常交接、非壞事）、反問＝琥珀 */
.usage-segbar {
  display: flex;
  height: 26px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--el-fill-color, #f0f2f5);
}
.usage-seg {
  display: block;
  height: 100%;
  transition: width 0.3s ease;

  &--answered { background: var(--brand-green-deep); }
  &--handoff  { background: #5b7a9d; }
  &--clarify  { background: #d99a2b; }
}

.usage-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.usage-leg {
  display: flex;
  align-items: baseline;
  gap: 7px;

  &__dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    align-self: center;
    flex: none;
  }
  &__k {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  &__info {
    font-size: 12px;
    color: var(--text-muted);
    cursor: help;
  }
  &__v {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  &__pct {
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  &--answered { .usage-leg__dot { background: var(--brand-green-deep); } .usage-leg__v { color: var(--brand-green-text); } }
  &--handoff  { .usage-leg__dot { background: #5b7a9d; } .usage-leg__v { color: #3f5a78; } }
  &--clarify  { .usage-leg__dot { background: #d99a2b; } .usage-leg__v { color: #b45309; } }
}

/* ── 次要指標：品質 proxy + 成本；數字依門檻上色（見 metricTone） ── */
.usage-substats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.usage-substat {
  display: flex;
  flex-direction: column;
  gap: 3px;

  &__label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  &__info {
    font-size: 13px;
    color: var(--text-muted);
    cursor: help;
  }
  &__value {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);

    &.is-good { color: var(--brand-green-text); }
    &.is-warn { color: #b45309; }
    &.is-bad  { color: #b91c1c; }
  }
  &__sub {
    font-size: 11px;
    color: var(--el-text-color-secondary);
  }
}

/* 成本三桶：客人對話 / 知識庫建置 / 後台測試 —— 依用途拆分，數字靠右對齊成一欄 */
.usage-cost-split {
  display: flex;
  flex-direction: column;
}

.usage-cost-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--el-fill-color-light);

  &__dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex: none;

    &--conv { background: var(--brand-green-deep); }
    &--build { background: #8a6fb0; }
    &--test { background: #b0783f; }
  }
  &__k {
    font-weight: 600;
    color: var(--text-primary);
    min-width: 80px;
  }
  &__tok {
    flex: 1;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    font-variant-numeric: tabular-nums;
  }
  &__cost {
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
}

.usage-cost-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 10px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);

  strong {
    font-size: 15px;
    color: var(--text-primary);
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

/* 「已清空」而非「沒資料」：正向框 + 下一步，並說明此清單與上方本月次數計數不同 */
.usage-empty--good {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  text-align: left;
  font-style: normal;
  background: var(--brand-green-wash);
  border: 1px solid rgba(6, 199, 85, 0.3);
  border-radius: 8px;
}
.usage-empty__icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--brand-green);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex: none;
}
.usage-empty__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.usage-empty__desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

/* 篩選列改放卡片內（不擠在標題）；與清單之間留一條分隔 */
.usage-handoff-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--el-fill-color-light);
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
