<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="💳 訂閱與付款"
        caption="查看目前方案與付款紀錄,或升級／續訂方案(付款由藍新金流處理)。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button :loading="loading" @click="reloadAll">重新載入</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="ls-page-body admin-panel-stack">
        <el-alert
          v-if="returnedOrder"
          :title="returnedOrder.title"
          :type="returnedOrder.type"
          show-icon
          :closable="false"
        >
          <div class="billing-return-body">
            <span>{{ returnedOrder.desc }}</span>
            <span v-if="polling" class="text-xs text-muted">付款確認中，會自動更新…</span>
            <el-button v-else-if="returnedOrder.pending" size="small" :loading="loading" @click="reloadAll">
              重新整理
            </el-button>
          </div>
        </el-alert>

        <div v-if="planView" class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🎟️ 目前方案</span>
              <span class="text-xs text-muted">{{ planView.name }}</span>
            </div>
            <el-button size="small" type="primary" @click="upgradeOpen = true">升級 / 續訂</el-button>
          </div>
          <div class="card-section-stack">
            <template v-if="planState.limit != null">
              <el-progress
                :percentage="planState.percent"
                :color="planState.color"
                :stroke-width="16"
                :text-inside="true"
                :format="() => `${planState.percentRaw}%`"
              />
              <p class="text-xs text-muted">
                本期已用 <strong>{{ planState.used.toLocaleString() }}</strong> / {{ planState.limit.toLocaleString() }} 則
                <template v-if="planView.currentPeriodStart && planView.currentPeriodEnd">
                  · 本期 {{ planView.currentPeriodStart }} ~ {{ planView.currentPeriodEnd }}
                </template>
              </p>
            </template>
            <p v-else class="text-xs text-muted">客製額度,無固定則數上限。</p>
          </div>
          <AdminPlanUpgradeDialog v-model="upgradeOpen" :current-plan-id="planView.id" />
        </div>
        <div v-else class="message-card ar-section-card">
          <div class="card-section-stack">
            <p class="text-sm">此帳號尚未開通付費方案。</p>
            <div><el-button type="primary" @click="upgradeOpen = true">查看方案</el-button></div>
          </div>
          <AdminPlanUpgradeDialog v-model="upgradeOpen" :current-plan-id="null" />
        </div>

        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🧾 付款紀錄</span>
            </div>
          </div>
          <div class="card-section-stack">
            <el-table :data="orders" size="small" empty-text="尚無付款紀錄">
              <el-table-column label="日期" min-width="140">
                <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="方案" min-width="80">
                <template #default="{ row }">{{ planName(row.planId) }}</template>
              </el-table-column>
              <el-table-column label="金額" min-width="90" align="right">
                <template #default="{ row }">NT${{ row.amount.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="付款方式" min-width="90">
                <template #default="{ row }">{{ payTypeLabel(row.paymentType) }}</template>
              </el-table-column>
              <el-table-column label="狀態" min-width="80">
                <template #default="{ row }">
                  <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="訂單編號" min-width="170">
                <template #default="{ row }">
                  <span class="billing-order-no">{{ row.merchantOrderNo }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { BILLING_PLANS } from '~~/shared/billing/plans'
import type { PaymentOrderStatus } from '~~/shared/types/payment'

definePageMeta({ middleware: ['auth', 'workspace-settings'], layout: 'default' })
useHead({ title: '訂閱與付款 — LINE Bot 管理系統' })

const route = useRoute()
const { apiFetch } = useWorkspace()
const { plan: planView, state: planState, load: loadPlanSummary } = usePlanSummary()

const upgradeOpen = ref(false)
const loading = ref(false)

interface OrderRow {
  merchantOrderNo: string
  planId: string
  amount: number
  status: PaymentOrderStatus
  paymentType: string | null
  createdAt: number | null
  paidAt: number | null
}
const orders = ref<OrderRow[]>([])

const STATUS_LABEL: Record<PaymentOrderStatus, string> = { pending: '待付款', paid: '已付款', failed: '失敗', expired: '已逾期' }
function statusLabel(s: PaymentOrderStatus) { return STATUS_LABEL[s] ?? s }
function statusType(s: PaymentOrderStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (s === 'paid') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'pending') return 'warning'
  return 'info'
}
function planName(id: string) { return BILLING_PLANS[id as keyof typeof BILLING_PLANS]?.name ?? id }

// 藍新付款方式代碼 → 看得懂的中文（對帳/客服問起來時用得到）
const PAY_TYPE_LABEL: Record<string, string> = {
  CREDIT: '信用卡',
  VACC: 'ATM 轉帳',
  WEBATM: 'WebATM',
  CVS: '超商代碼',
  BARCODE: '超商條碼',
}
function payTypeLabel(t: string | null) { return t ? (PAY_TYPE_LABEL[t] ?? t) : '—' }
function fmtTime(ms: number | null) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 藍新導回帶的 ?order=;顯示付款結果(真正開通以 server→server 的 notify 為準,可能稍慢於導回)
const returnedOrder = computed(() => {
  const no = String(route.query.order || '').trim()
  if (!no) return null
  const o = orders.value.find(r => r.merchantOrderNo === no)
  if (!o) return { title: '付款處理中', type: 'info' as const, desc: '若剛完成付款，款項確認後方案會自動更新。', pending: true }
  if (o.status === 'paid') return { title: '付款完成，方案已開通 🎉', type: 'success' as const, desc: `訂單 ${no}`, pending: false }
  if (o.status === 'failed') return { title: '這筆付款未成功', type: 'error' as const, desc: '未扣款或已取消，可重新選擇方案結帳。', pending: false }
  if (o.status === 'expired') return { title: '這筆訂單已逾期', type: 'info' as const, desc: '可重新選擇方案結帳。', pending: false }
  return { title: '付款處理中', type: 'warning' as const, desc: '款項確認後方案會自動更新。', pending: true }
})

// 導回時 Notify 常常還沒送達 → 短暫輪詢直到訂單結案（最多 ~32s），使用者不必自己按重新載入。
const polling = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollTries = 0

function stopPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  polling.value = false
}

function pollReturnedOrder() {
  if (!returnedOrder.value?.pending || pollTries >= 8) {
    stopPoll()
    return
  }
  polling.value = true
  pollTries += 1
  pollTimer = setTimeout(async () => {
    await reloadAll()
    pollReturnedOrder()
  }, 4000)
}

async function loadOrders() {
  try { orders.value = await apiFetch<OrderRow[]>('/api/payment/orders') }
  catch { orders.value = [] }
}

async function reloadAll() {
  loading.value = true
  try { await Promise.all([loadPlanSummary(), loadOrders()]) }
  finally { loading.value = false }
}

onMounted(async () => {
  await reloadAll()
  pollReturnedOrder()
})
onUnmounted(stopPoll)
</script>
