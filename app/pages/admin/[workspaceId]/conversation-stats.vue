<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="統計"
        title="客服對話統計"
        caption="依日期區間檢視會話量、首接類型分佈、轉真人與結案；趨勢可看圖表並匯出 CSV。"
      />
      <div class="conv-stats-header-actions admin-header-actions" data-tour="cs-filter">
        <div class="conv-stats-filter-group">
          <el-radio-group v-model="rangePreset" size="small" @change="onPresetChange">
            <el-radio-button value="7">近 7 天</el-radio-button>
            <el-radio-button value="30">近 30 天</el-radio-button>
            <el-radio-button value="90">近 90 天</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="開始日期"
            end-placeholder="結束日期"
            value-format="YYYY-MM-DD"
            size="small"
            @change="onRangeChange"
          />
        </div>
        <div class="conv-stats-filter-group">
          <el-button size="small" :loading="loading" @click="loadAll">重整</el-button>
          <el-button size="small" type="primary" plain :disabled="!trend.buckets.length" @click="exportCsv">匯出 CSV</el-button>
        </div>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack conv-stats-page">
        <div v-if="kpiLoading" class="tags-loading">
          <div class="spinner" />
          <span>載入中…</span>
        </div>

        <template v-else>
          <!-- Hero（總會話）＋ 結果指標（轉真人 / 已結束）─────────────── -->
          <el-row :gutter="16" data-tour="cs-kpi">
            <el-col :xs="24" :md="12">
              <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-hero">
                <div class="conv-stats-kpi-body">
                  <div class="stat-label">總新增會話</div>
                  <div class="conv-stats-hero-row">
                    <span class="stat-value conv-stats-hero-value">{{ kpi.total }}</span>
                    <el-tooltip v-if="deltaLabel" content="與前一個等長區間相比的會話量增減" placement="top">
                      <span class="conv-stats-delta" :class="deltaClass">{{ deltaLabel }}</span>
                    </el-tooltip>
                  </div>
                  <div class="text-xs text-muted">
                    {{ rangeLabel }}<template v-if="prevTotal !== null">・較上期 {{ prevTotal }}</template>
                  </div>
                </div>
              </el-card>
            </el-col>
            <el-col :xs="12" :md="6">
              <el-card
                shadow="hover"
                class="conv-stats-kpi-card conv-stats-kpi-card--handoff is-clickable"
                @click="drillTo('pending_human')"
              >
                <div class="conv-stats-kpi-body">
                  <el-tooltip content="曾經轉給真人的會話數；同一場轉多次只算一次。點擊查看待真人的對話。" placement="top">
                    <div class="stat-label">轉真人場數 <span class="conv-stats-info">ⓘ</span></div>
                  </el-tooltip>
                  <div class="stat-value">{{ kpi.handoffCount }}</div>
                  <div class="text-xs text-muted">佔 {{ pctNum(kpi.handoffRate) }}</div>
                </div>
              </el-card>
            </el-col>
            <el-col :xs="12" :md="6">
              <el-card
                shadow="hover"
                class="conv-stats-kpi-card conv-stats-kpi-card--closed is-clickable"
                @click="drillTo('closed')"
              >
                <div class="conv-stats-kpi-body">
                  <el-tooltip content="已結束的會話。「佔已處理」= 在有被接手的會話裡已結案的比例（排除未首接）。點擊查看已結束的對話。" placement="top">
                    <div class="stat-label">已結束 <span class="conv-stats-info">ⓘ</span></div>
                  </el-tooltip>
                  <div class="stat-value">{{ kpi.closedCount }}</div>
                  <div class="text-xs text-muted">
                    佔總 {{ pctNum(kpi.closeRateByTotal) }}・佔已處理 {{ pctNum(kpi.closeRateByHandled) }}
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>

          <!-- 首接類型堆疊長條 ───────────────────────────────────── -->
          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="section-title">首接類型</span>
                <span class="text-xs text-muted">這 {{ kpi.total }} 場對話，第一個接手的是誰？（點類別可查看對話）</span>
              </div>
            </div>
            <div class="card-section-stack">
              <div v-if="kpi.total > 0" class="conv-seg-bar">
                <el-tooltip
                  v-for="seg in visibleSegs"
                  :key="seg.key"
                  :content="`${seg.label} ${seg.value}（${pct(seg.value, kpi.total)}）`"
                  placement="top"
                >
                  <div
                    class="conv-seg"
                    :class="[seg.cls, { 'is-clickable': !!seg.tab }]"
                    :style="{ width: (seg.value / kpi.total * 100) + '%' }"
                    @click="seg.tab && drillTo(seg.tab)"
                  />
                </el-tooltip>
              </div>
              <div v-else class="conv-seg-bar conv-seg-bar--empty" />

              <div class="conv-seg-legend">
                <el-tooltip v-for="seg in firstContactSegs" :key="seg.key" :content="seg.help" placement="top">
                  <button
                    type="button"
                    class="conv-seg-legend-item"
                    :class="{ 'is-clickable': !!seg.tab }"
                    @click="seg.tab && drillTo(seg.tab)"
                  >
                    <span class="conv-seg-dot" :class="seg.cls" />
                    <span class="conv-seg-legend-label">{{ seg.label }}</span>
                    <span class="conv-seg-legend-num">{{ seg.value }}</span>
                    <span class="conv-seg-legend-pct">{{ pct(seg.value, kpi.total) }}</span>
                    <span v-if="seg.escalated" class="conv-seg-legend-esc">升級真人 {{ seg.escalated }}</span>
                  </button>
                </el-tooltip>
              </div>
            </div>
          </div>
        </template>

        <!-- 趨勢：折線圖 ＋ 可展開明細表 ───────────────────────── -->
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="section-title">趨勢</span>
              <span class="text-xs text-muted">每期總新增會話</span>
            </div>
            <el-select
              v-model="granularity"
              class="conv-stats-granularity"
              size="small"
              @change="loadTrend"
            >
              <el-option label="日" value="day" />
              <el-option label="週" value="week" />
              <el-option label="月" value="month" />
            </el-select>
          </div>
          <div class="card-section-stack">
            <div v-if="trendLoading" class="tags-loading">
              <div class="spinner" />
              <span>載入中…</span>
            </div>
            <template v-else-if="trendChart">
              <div class="conv-trend-chart">
                <svg
                  :viewBox="`0 0 ${trendChart.w} ${trendChart.h}`"
                  class="conv-trend-svg"
                  role="img"
                  aria-label="每期總新增會話趨勢"
                >
                  <polygon :points="trendChart.area" class="conv-trend-area" />
                  <polyline :points="trendChart.line" class="conv-trend-line" vector-effect="non-scaling-stroke" />
                  <circle
                    v-for="(p, i) in trendChart.pts"
                    :key="i"
                    :cx="p.x"
                    :cy="p.y"
                    r="2.4"
                    class="conv-trend-dot"
                  >
                    <title>{{ p.date }}：{{ p.v }} 場</title>
                  </circle>
                </svg>
                <div class="conv-trend-axis text-xs text-muted">
                  <span>{{ trendChart.first }}</span>
                  <span>峰值 {{ trendChart.peak.v }}（{{ trendChart.peak.date }}）</span>
                  <span>{{ trendChart.last }}</span>
                </div>
              </div>

              <div class="conv-trend-detail">
                <button
                  type="button"
                  class="conv-detail-toggle"
                  :class="{ 'is-open': showDetail }"
                  @click="showDetail = !showDetail"
                >
                  <span class="conv-detail-chevron" aria-hidden="true" />
                  {{ showDetail ? '收合每期明細' : `展開每期明細（${trend.buckets.length} 列）` }}
                </button>
                <el-table v-if="showDetail" :data="trend.buckets" size="small" stripe class="conv-detail-table">
                  <el-table-column prop="date" label="日期" min-width="110" />
                  <el-table-column prop="total" label="總計" width="70" align="right" />
                  <el-table-column prop="bot" label="機器人首接" width="100" align="right" />
                  <el-table-column prop="ai" label="AI 首接" width="80" align="right" />
                  <el-table-column prop="human" label="真人首接" width="90" align="right" />
                  <el-table-column prop="unhandled" label="未首接" width="80" align="right" />
                  <el-table-column prop="handoff" label="轉真人" width="80" align="right" />
                  <el-table-column prop="closed" label="已結束" width="80" align="right" />
                </el-table>
              </div>
            </template>
            <div v-else class="tags-empty conv-stats-empty">
              <span>此區間無資料</span>
              <el-button size="small" @click="widenRange">放寬到近 90 天</el-button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import type { KpiResult, TrendGranularity, TrendBucket } from '~~/shared/types/conversation-stats'
import { useAdminToast } from '~~/app/composables/useAdminToast'

definePageMeta({ middleware: 'auth', layout: 'default' })

useHead({
  title: '對話統計 — LINE Bot 管理系統',
})

const { showToast } = useAdminToast()
const { apiFetch } = useWorkspace()
const route = useRoute()

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 近 N 天（含今天）。預設近 30 天：讓 KPI 與趨勢吃同一段區間，避免「KPI 有數字、趨勢無資料」，
// 也讓使用者一進頁面就知道現在看的是哪段時間（不再是兩個空白日期欄）。
function presetToRange(days: number): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - (days - 1))
  return [fmtDate(start), fmtDate(end)]
}

const dateRange = ref<[string, string] | null>(presetToRange(30))
// 快捷區間高亮：'7' | '30' | '90'；使用者自訂日期時設為 '' 表示不對應任何快捷鈕。
const rangePreset = ref('30')
const granularity = ref<TrendGranularity>('day')
const loading = ref(false)
const kpiLoading = ref(false)
const trendLoading = ref(false)

const kpi = ref<KpiResult>({
  total: 0, botHandled: 0, aiHandled: 0, humanHandled: 0, unhandled: 0,
  botEscalated: 0, aiEscalated: 0,
  handoffCount: 0, handoffRate: 0, closedCount: 0, handledCount: 0,
  closeRateByTotal: 0, closeRateByHandled: 0,
})
const prevTotal = ref<number | null>(null)
const trend = ref<{ buckets: TrendBucket[] }>({ buckets: [] })
const showDetail = ref(false)

const rangeLabel = computed(() => {
  if (dateRange.value?.[0] && dateRange.value?.[1]) return `${dateRange.value[0]} ~ ${dateRange.value[1]}`
  return '近 30 天'
})

// ── 首接類型分段（堆疊長條 + 圖例共用一份資料）────────────────
const firstContactSegs = computed(() => {
  const k = kpi.value
  return [
    { key: 'bot', label: '機器人', value: k.botHandled, escalated: k.botEscalated, cls: 'seg-bot', tab: 'bot_handling', help: '第一個回覆客人的是機器人罐頭回覆或流程。' },
    { key: 'ai', label: 'AI', value: k.aiHandled, escalated: k.aiEscalated, cls: 'seg-ai', tab: '', help: '第一個回覆客人的是 AI 客服（知識庫問答）。' },
    { key: 'human', label: '真人', value: k.humanHandled, escalated: 0, cls: 'seg-human', tab: 'human_handling', help: '一開始就由真人客服接手。' },
    { key: 'unhandled', label: '未首接', value: k.unhandled, escalated: 0, cls: 'seg-unhandled', tab: 'open', help: '整場對話從頭到尾沒有機器人、AI 或真人接手回覆（例如只收到系統通知，或加了好友卻沒互動）。' },
  ]
})
const visibleSegs = computed(() => firstContactSegs.value.filter(s => s.value > 0))

// ── 較上期：抹一段等長的上一區間，只比總會話 ──────────────────
function prevRange(): [string, string] | null {
  if (!dateRange.value?.[0] || !dateRange.value?.[1]) return null
  const start = new Date(dateRange.value[0])
  const end = new Date(dateRange.value[1])
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1))
  return [fmtDate(prevStart), fmtDate(prevEnd)]
}
const deltaPct = computed(() => {
  if (prevTotal.value === null || prevTotal.value === 0) return null
  return (kpi.value.total - prevTotal.value) / prevTotal.value
})
const deltaLabel = computed(() => {
  const v = deltaPct.value
  if (v === null) return ''
  const arrow = v > 0 ? '↑' : v < 0 ? '↓' : ''
  return `${arrow} ${Math.abs(v * 100).toFixed(0)}%`
})
const deltaClass = computed(() => {
  const v = deltaPct.value
  if (v === null || v === 0) return 'is-flat'
  return v > 0 ? 'is-up' : 'is-down'
})

// ── 趨勢折線圖（純 SVG，無外部圖表庫）─────────────────────────
const CHART_W = 960
const CHART_H = 200
const PAD_X = 6
const PAD_TOP = 16
const PAD_BOTTOM = 8
const trendChart = computed(() => {
  const bs = trend.value.buckets
  const n = bs.length
  if (!n) return null
  const maxV = Math.max(1, ...bs.map(b => b.total))
  const innerW = CHART_W - PAD_X * 2
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM
  const xAt = (i: number) => (n === 1 ? CHART_W / 2 : PAD_X + (i / (n - 1)) * innerW)
  const yAt = (v: number) => PAD_TOP + innerH - (v / maxV) * innerH
  const pts = bs.map((b, i) => ({ x: +xAt(i).toFixed(1), y: +yAt(b.total).toFixed(1), v: b.total, date: b.date }))
  const line = pts.map(p => `${p.x},${p.y}`).join(' ')
  const baseY = PAD_TOP + innerH
  const firstPt = pts[0]!
  const lastPt = pts[n - 1]!
  const area = `${firstPt.x},${baseY} ${line} ${lastPt.x},${baseY}`
  let peak = firstPt
  for (const p of pts) { if (p.v > peak.v) peak = p }
  return { line, area, pts, maxV, peak, first: firstPt.date, last: lastPt.date, w: CHART_W, h: CHART_H }
})

function buildQuery() {
  const params: Record<string, string> = {}
  if (dateRange.value?.[0]) params.startDate = dateRange.value[0]
  if (dateRange.value?.[1]) params.endDate = dateRange.value[1]
  return params
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

function pctNum(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

// 下鑽：跳到「對話」頁並帶上最接近的狀態分頁。
// 註：統計是「日期區間 + 首接類型」的分析數字，對話頁分頁是「目前的狀態」清單，
// 兩者口徑不同，數字不會完全相等——這裡只是導覽到相關會話。
function drillTo(tab: string) {
  const wid = String(route.params.workspaceId || '')
  if (!wid || !tab) return
  navigateTo({ path: `/admin/${wid}/conversations`, query: { tab } })
}

function onPresetChange(val: string | number | boolean | undefined) {
  dateRange.value = presetToRange(Number(val))
  loadAll()
}

function onRangeChange() {
  rangePreset.value = '' // 自訂日期 → 取消快捷高亮
  loadAll()
}

function widenRange() {
  rangePreset.value = '90'
  dateRange.value = presetToRange(90)
  loadAll()
}

async function loadKpi() {
  kpiLoading.value = true
  try {
    const data = await apiFetch<KpiResult>('/api/conversation-stats/kpi', {
      params: buildQuery(),
    })
    kpi.value = data
  } catch (e) {
    console.error('[stats] kpi error:', e)
    showToast('載入 KPI 失敗', 'error')
  } finally {
    kpiLoading.value = false
  }
}

async function loadPrevKpi() {
  const r = prevRange()
  if (!r) { prevTotal.value = null; return }
  try {
    const data = await apiFetch<KpiResult>('/api/conversation-stats/kpi', {
      params: { startDate: r[0], endDate: r[1] },
    })
    prevTotal.value = data.total
  } catch (e) {
    console.error('[stats] prev kpi error:', e)
    prevTotal.value = null
  }
}

async function loadTrend() {
  trendLoading.value = true
  try {
    const data = await apiFetch<{ buckets: TrendBucket[] }>('/api/conversation-stats/trend', {
      params: { ...buildQuery(), granularity: granularity.value },
    })
    trend.value = data
  } catch (e) {
    console.error('[stats] trend error:', e)
    showToast('載入趨勢失敗', 'error')
  } finally {
    trendLoading.value = false
  }
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadKpi(), loadPrevKpi(), loadTrend()])
  loading.value = false
}

function exportCsv() {
  if (!trend.value.buckets.length) return
  const header = '日期,總計,機器人首接,AI首接,真人首接,未首接,轉真人,已結束'
  const rows = trend.value.buckets.map(b =>
    `${b.date},${b.total},${b.bot},${b.ai},${b.human},${b.unhandled},${b.handoff},${b.closed}`,
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `conversation-stats-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadAll)
</script>
