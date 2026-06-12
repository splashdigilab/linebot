<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="AI 客服"
        title="📊 用量 / 監控"
        caption="這個月的 AI 用量、自動回覆率、待補知識清單"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-select v-model="period" size="small" style="width: 130px" @change="loadAll">
          <el-option
            v-for="opt in periodOptions"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </el-select>
        <el-button :loading="loading" @click="loadAll">🔄 重新整理</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="usage-body admin-panel-stack">
        <!-- ── KPI cards ─────────────────────── -->
        <div class="message-card usage-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📈 核心指標</span>
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
                <span class="usage-kpi__sub">{{ formatNumber(summary?.answeredThenHandoffs) }} 次（回答沒解決問題的 proxy，越低越好）</span>
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
              <span class="badge badge-green">🔢 Token 用量明細</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="usage-tokens">
              <div class="usage-token-row">
                <span class="text-muted">Input</span>
                <strong>{{ formatNumber(summary?.inputTokens) }}</strong>
                <span class="text-xs text-muted">提示 + 知識卡內容</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">Output</span>
                <strong>{{ formatNumber(summary?.outputTokens) }}</strong>
                <span class="text-xs text-muted">AI 生成的回覆</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">Embedding</span>
                <strong>{{ formatNumber(summary?.embeddingTokens) }}</strong>
                <span class="text-xs text-muted">查詢向量化</span>
              </div>
              <div class="usage-token-row">
                <span class="text-muted">匯入 / 整理</span>
                <strong>{{ formatNumber((summary?.importInputTokens ?? 0) + (summary?.importOutputTokens ?? 0)) }}</strong>
                <span class="text-xs text-muted">切卡與 AI 整理（已含在上方 Input / Output 內）</span>
              </div>
            </div>
            <p class="usage-hint">
              成本估算依 Gemini Flash 公開計價（input ${{ pricing.inputPerM }} / output ${{ pricing.outputPerM }} / embed ${{ pricing.embedPerM }} per 1M tokens）。
              實際帳單以 Google 為準。
            </p>
          </div>
        </div>

        <!-- ── 低信心 / 轉真人案例 ──────────────── -->
        <div class="message-card usage-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🚨 近期轉真人案例</span>
              <el-select v-model="reasonFilter" size="small" style="width: 150px" @change="loadHandoffs">
                <el-option label="全部原因" value="" />
                <el-option label="信心不足" value="low_confidence" />
                <el-option label="知識庫無依據" value="no_grounding" />
                <el-option label="客人要求真人" value="user_request" />
              </el-select>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="usage-hint">
              客人問了 AI 但答不出來的情況。點「📥 補知識」直接到知識庫補一張對應卡。
            </p>
            <div v-if="loadingHandoffs && !handoffs.length" class="usage-loading"><div class="spinner" /></div>
            <div v-else-if="!handoffs.length" class="usage-empty">本期沒有低信心案例 🎉</div>
            <div v-else class="usage-handoff-list">
              <div v-for="row in handoffs" :key="`${row.userId}-${row.updatedAtMs}`" class="usage-handoff-row">
                <div class="usage-handoff-meta">
                  <span :class="reasonBadgeClass(row.handoffReason)">{{ reasonLabel(row.handoffReason) }}</span>
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
                  <el-button size="small" plain @click="goConversation(row.userId)">💬 開對話</el-button>
                  <el-button size="small" type="primary" plain @click="goAddKnowledge(row.lastQuery)">📥 補知識</el-button>
                  <el-button size="small" plain @click="goPlayground(row.lastQuery)">▶ 重演</el-button>
                  <el-button size="small" type="success" plain :loading="resolvingUserId === row.userId" @click="resolveHandoff(row.userId)">✓ 已處理</el-button>
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
import { HANDOFF_REASON_LABELS, type HandoffReason } from '~~/shared/types/ai-knowledge'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()

interface Summary {
  period: string
  invocations: number
  answered: number
  handoffs: number
  answeredThenHandoffs: number
  answeredThenHandoffRate: number
  inputTokens: number
  outputTokens: number
  embeddingTokens: number
  importInputTokens: number
  importOutputTokens: number
  autoReplyRate: number
  handoffRate: number
  estimatedCostUsd: number
  perConversationUsd: number
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
const reasonFilter = ref<'' | 'low_confidence' | 'no_grounding'>('')

const pricing = { inputPerM: 0.075, outputPerM: 0.30, embedPerM: 0.025 }

// ── Period selector（過去 3 個月） ─────────────────────────
function makePeriodOptions() {
  const opts: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    opts.push({ value: `${y}${m}`, label: `${y}-${m}` })
  }
  return opts
}
const periodOptions = makePeriodOptions()
const period = ref(periodOptions[0]!.value)
const periodLabel = computed(() => periodOptions.find(o => o.value === period.value)?.label ?? period.value)

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
function goAddKnowledge(_query: string) {
  router.push(`/admin/${workspaceId.value}/knowledge`)
}
function goPlayground(query: string) {
  router.push(`/admin/${workspaceId.value}/ai-playground?q=${encodeURIComponent(query)}`)
}

const resolvingUserId = ref<string | null>(null)
async function resolveHandoff(userId: string) {
  resolvingUserId.value = userId
  try {
    await apiFetch('/api/ai/usage/handoffs/resolve', { method: 'POST', body: { userId } })
    handoffs.value = handoffs.value.filter(r => r.userId !== userId)
  }
  catch {
    // 失敗就保留在列表上，下次再按
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
