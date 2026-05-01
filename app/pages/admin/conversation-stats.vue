<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="統計"
        title="📊 客服對話統計"
        caption="依日期區間檢視會話量、首接類型、轉真人與結案比例；趨勢表可匯出 CSV。"
      />
      <div class="conv-stats-header-actions admin-header-actions">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="開始日期"
          end-placeholder="結束日期"
          value-format="YYYY-MM-DD"
          size="small"
          @change="loadAll"
        />
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
        <el-button size="small" :loading="loading" @click="loadAll">重整</el-button>
        <el-button size="small" @click="exportCsv">匯出 CSV</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack conv-stats-page">
        <!-- KPI（版型對齊儀表板 index：el-row + el-card + stat-label / stat-value） -->
        <div v-if="kpiLoading" class="tags-loading">
          <div class="spinner" />
          <span>載入中…</span>
        </div>
        <el-row v-else :gutter="16">
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">總新增會話</div>
                <div class="stat-value">{{ kpi.total }}</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-kpi-card--bot">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">機器人首接</div>
                <div class="stat-value">{{ kpi.botHandled }}</div>
                <div class="text-xs text-muted">{{ pct(kpi.botHandled, kpi.total) }}</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-kpi-card--human">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">真人首接</div>
                <div class="stat-value">{{ kpi.humanHandled }}</div>
                <div class="text-xs text-muted">{{ pct(kpi.humanHandled, kpi.total) }}</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-kpi-card--unhandled">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">未首接</div>
                <div class="stat-value">{{ kpi.unhandled }}</div>
                <div class="text-xs text-muted">{{ pct(kpi.unhandled, kpi.total) }}</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-kpi-card--handoff">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">轉真人次數</div>
                <div class="stat-value">{{ kpi.handoffCount }}</div>
                <div class="text-xs text-muted">{{ pctNum(kpi.handoffRate) }}</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-card shadow="hover" class="conv-stats-kpi-card conv-stats-kpi-card--closed">
              <div class="conv-stats-kpi-body">
                <div class="stat-label">已結束</div>
                <div class="stat-value">{{ kpi.closedCount }}</div>
                <div class="text-xs text-muted">
                  總結 {{ pctNum(kpi.closeRateByTotal) }} / 已處理結 {{ pctNum(kpi.closeRateByHandled) }}
                </div>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <!-- 趨勢表（版型對齊 line-settings / tags：message-card + card-section-stack） -->
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📈 趨勢（{{ granularityLabel }}）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div v-if="trendLoading" class="tags-loading">
              <div class="spinner" />
              <span>載入中…</span>
            </div>
            <template v-else>
              <el-table v-if="trend.buckets.length" :data="trend.buckets" size="small" stripe>
                <el-table-column prop="date" label="日期" min-width="110" />
                <el-table-column prop="total" label="總計" width="70" align="right" />
                <el-table-column prop="bot" label="機器人首接" width="100" align="right" />
                <el-table-column prop="human" label="真人首接" width="90" align="right" />
                <el-table-column prop="unhandled" label="未首接" width="80" align="right" />
                <el-table-column prop="handoff" label="轉真人" width="80" align="right" />
                <el-table-column prop="closed" label="已結束" width="80" align="right" />
              </el-table>
              <div v-else class="tags-empty">
                <span>此區間無資料</span>
              </div>
            </template>
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
const { $auth } = useNuxtApp()

const dateRange = ref<[string, string] | null>(null)
const granularity = ref<TrendGranularity>('day')
const loading = ref(false)
const kpiLoading = ref(false)
const trendLoading = ref(false)

const kpi = ref<KpiResult>({
  total: 0, botHandled: 0, humanHandled: 0, unhandled: 0,
  handoffCount: 0, handoffRate: 0, closedCount: 0, handledCount: 0,
  closeRateByTotal: 0, closeRateByHandled: 0,
})
const trend = ref<{ buckets: TrendBucket[] }>({ buckets: [] })

const granularityLabel = computed(() => {
  if (granularity.value === 'week') return '週'
  if (granularity.value === 'month') return '月'
  return '日'
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

async function getBearer(): Promise<string> {
  const u = $auth.currentUser
  if (!u) {
    await navigateTo('/login')
    throw new Error('not logged in')
  }
  return u.getIdToken()
}

async function loadKpi() {
  kpiLoading.value = true
  try {
    const token = await getBearer()
    const data = await $fetch<KpiResult>('/api/conversation-stats/kpi', {
      params: buildQuery(),
      headers: { Authorization: `Bearer ${token}` },
    })
    kpi.value = data
  } catch (e) {
    console.error('[stats] kpi error:', e)
    showToast('載入 KPI 失敗', 'error')
  } finally {
    kpiLoading.value = false
  }
}

async function loadTrend() {
  trendLoading.value = true
  try {
    const token = await getBearer()
    const data = await $fetch<{ buckets: TrendBucket[] }>('/api/conversation-stats/trend', {
      params: { ...buildQuery(), granularity: granularity.value },
      headers: { Authorization: `Bearer ${token}` },
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
  await Promise.all([loadKpi(), loadTrend()])
  loading.value = false
}

function exportCsv() {
  if (!trend.value.buckets.length) return
  const header = '日期,總計,機器人首接,真人首接,未首接,轉真人,已結束'
  const rows = trend.value.buckets.map(b =>
    `${b.date},${b.total},${b.bot},${b.human},${b.unhandled},${b.handoff},${b.closed}`,
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
