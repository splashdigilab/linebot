<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="設定"
        title="訂閱與付款"
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

            <!-- 續訂狀態：自動扣款這件事必須一眼看得到，而且**隨時退得掉**。
                 取消按鈕的顯示條件是 canCancel（= 還有生效中的委託），不是 autoRenew——
                 扣款失敗或已被降級時，委託在藍新那邊還活著、還在刷卡，那正是最需要停掉它的時刻，
                 絕不能讓警告訊息把取消入口蓋掉。 -->
            <el-alert
              v-if="planView.status === 'past_due'"
              type="warning"
              :closable="false"
              show-icon
              title="這期的自動扣款尚未成功"
            >
              <span class="text-xs">服務仍在正常運作。請確認信用卡是否過期或額度不足；幾天內仍未扣款成功，方案會降回免費層。</span>
            </el-alert>

            <div v-if="planView.cancelAtPeriodEnd" class="billing-renew-row">
              <span class="text-xs text-muted">
                已取消自動續訂，服務可用到 <strong>{{ planView.currentPeriodEnd }}</strong>，之後降回免費層。
              </span>
            </div>
            <div v-else-if="canCancel" class="billing-renew-row">
              <span class="text-xs text-muted">
                <template v-if="planView.autoRenew">
                  每月自動續訂中 · 下次扣款 <strong>{{ nextChargeDate }}</strong>
                </template>
                <template v-else>自動扣款委託仍在生效中，若不想再被扣款請取消。</template>
              </span>
              <el-button size="small" text :loading="canceling" @click="cancelSubscription">取消訂閱</el-button>
            </div>
          </div>
          <AdminPlanUpgradeDialog v-model="upgradeOpen" :current-plan-id="planView.id" />
        </div>
        <div v-else-if="loading" class="message-card ar-section-card billing-plan-loading">
          <div class="spinner" />
          <span class="text-sm text-muted">載入方案資訊…</span>
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
              <el-table-column v-if="invoiceEnabled" label="發票號碼" min-width="110">
                <template #default="{ row }">
                  <span v-if="row.invoiceNumber" class="billing-order-no">{{ row.invoiceNumber }}</span>
                  <span v-else class="text-xs text-muted">{{ invoiceStatusLabel(row.invoiceStatus) }}</span>
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

        <!--
          發票資訊。統編／抬頭是**組織層級**的設定（一家公司開 3 個 OA 不該填 3 次），
          所以這裡預設顯示「沿用組織設定」的唯讀摘要，只有真的需要不同抬頭時才展開覆寫。
          直接給一張空表單，會讓人以為「沒填 = 不會開發票」而在每個 OA 各填一次。
        -->
        <div v-if="invoiceEnabled" class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📄 發票資訊</span>
              <span class="text-xs text-muted">每次付款成功後自動開立</span>
            </div>
            <el-button v-if="invoiceOverriding" size="small" :loading="savingInvoice" :disabled="!invoiceValid" @click="saveInvoiceProfile">
              儲存
            </el-button>
          </div>

          <div class="card-section-stack">
            <template v-if="!invoiceOverriding">
              <div class="billing-invoice-inherited">
                <div>
                  <p class="text-sm">{{ effectiveInvoiceLabel }}</p>
                  <p class="text-xs text-muted">
                    沿用組織的發票設定。
                    <NuxtLink v-if="invoiceOrgId" :to="`/admin/org/${invoiceOrgId}`" class="billing-invoice-link">
                      去組織設定修改 →
                    </NuxtLink>
                  </p>
                </div>
                <el-button size="small" text @click="startOverride">改用專屬設定</el-button>
              </div>
            </template>

            <template v-else>
              <el-alert type="info" :closable="false" show-icon>
                <span class="text-xs">
                  這個官方帳號將使用**專屬的**發票資訊，不再沿用組織設定。
                  全部欄位清空並儲存即可改回沿用。
                </span>
              </el-alert>
              <AdminInvoiceProfileForm v-model="invoiceForm" :fallback-name-hint="workspaceName" @update:valid="invoiceValid = $event" />
            </template>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { BILLING_PLANS } from '~~/shared/billing/plans'
import type { PaymentOrderStatus } from '~~/shared/types/payment'
import type { InvoiceForm } from '~~/app/components/admin/AdminInvoiceProfileForm.vue'

definePageMeta({ middleware: ['auth', 'workspace-settings'], layout: 'default' })
useHead({ title: '訂閱與付款 — LINE Bot 管理系統' })

const route = useRoute()
const { apiFetch } = useWorkspace()
const { showToast } = useAdminToast()
const { plan: planView, state: planState, load: loadPlanSummary } = usePlanSummary()

const config = useRuntimeConfig()
const invoiceEnabled = Boolean(config.public.invoiceEnabled)

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
  invoiceNumber?: string | null
  invoiceStatus?: 'issued' | 'failed' | 'skipped' | null
}
const orders = ref<OrderRow[]>([])

// ── 自動續訂 ──────────────────────────────────────────────
/** 下次扣款日 = 本期到期日的隔天（藍新在錨定日當天扣款）。 */
const nextChargeDate = computed(() => {
  const end = planView.value?.currentPeriodEnd
  if (!end) return '—'
  const [y, m, d] = end.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`
})

/**
 * 能不能取消 = 藍新那邊還有生效中的委託。**不是**看 autoRenew——
 * 扣款失敗被降回免費層時 autoRenew 已經是 false，但卡還在被扣，那時最需要這個按鈕。
 */
const canCancel = computed(() => planView.value?.hasMandate === true)

const canceling = ref(false)
async function cancelSubscription() {
  try {
    await ElMessageBox.confirm(
      `取消後不再自動扣款，「${planView.value?.name}」方案可以用到 ${planView.value?.currentPeriodEnd}，之後降回免費層（每月 200 則）。`,
      '取消自動續訂',
      { confirmButtonText: '確認取消訂閱', cancelButtonText: '再想想', type: 'warning' },
    )
  }
  catch { return }

  canceling.value = true
  try {
    const r = await apiFetch<{ activeUntil: string | null }>('/api/payment/cancel-subscription', { method: 'POST' })
    showToast(`已取消自動續訂，服務可用到 ${r.activeUntil ?? '本期結束'}`, 'success')
    await loadPlanSummary()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '取消失敗，請聯繫客服', 'error')
  }
  finally {
    canceling.value = false
  }
}

// ── 發票資訊（預設沿用組織設定，需要時才覆寫）──────────────────
const invoiceForm = reactive<InvoiceForm>({
  buyerUBN: '', buyerName: '', buyerEmail: '', carrierNum: '', loveCode: '',
})
const savingInvoice = ref(false)
const invoiceValid = ref(true)
/** true = 這個 OA 有自己的專屬設定（不沿用組織）。 */
const invoiceOverriding = ref(false)
const invoiceOrgId = ref<string | null>(null)
const effectiveInvoice = ref<Record<string, string | null>>({})

const workspaceName = computed(() => planView.value?.name ?? '')

/** 一句話說清楚「現在會開出什麼樣的發票」——比列出五個欄位好懂。 */
const effectiveInvoiceLabel = computed(() => {
  const p = effectiveInvoice.value
  if (p.buyerUBN) return `公司發票（統編 ${p.buyerUBN}・${p.buyerName || '未填抬頭'}）`
  if (p.carrierNum) return `個人發票・存入手機條碼載具 ${p.carrierNum}`
  if (p.loveCode) return `個人發票・捐贈（愛心碼 ${p.loveCode}）`
  return '個人發票・紙本'
})

const INVOICE_STATUS_LABEL: Record<string, string> = { failed: '開立失敗', skipped: '未開立', issued: '—' }
function invoiceStatusLabel(s?: string | null) { return s ? (INVOICE_STATUS_LABEL[s] ?? '—') : '—' }

/** 從「沿用組織」切到「專屬設定」：把組織的值當起點帶進表單，不要給他一張空的。 */
function startOverride() {
  const p = effectiveInvoice.value
  invoiceForm.buyerUBN = p.buyerUBN ?? ''
  invoiceForm.buyerName = p.buyerName ?? ''
  invoiceForm.buyerEmail = p.buyerEmail ?? ''
  invoiceForm.carrierNum = p.carrierNum ?? ''
  invoiceForm.loveCode = p.loveCode ?? ''
  invoiceOverriding.value = true
}

async function saveInvoiceProfile() {
  savingInvoice.value = true
  try {
    const r = await apiFetch<{ inherited: boolean }>('/api/payment/invoice-profile', {
      method: 'POST',
      body: { ...invoiceForm },
    })
    showToast(r.inherited ? '已改回沿用組織設定' : '發票資訊已儲存', 'success')
    await loadInvoiceProfile()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    savingInvoice.value = false
  }
}

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

async function loadInvoiceProfile() {
  if (!invoiceEnabled) return
  try {
    const res = await apiFetch<{
      orgId: string | null
      override: Record<string, string | null>
      effective: Record<string, string | null>
      inherited: boolean
    }>('/api/payment/invoice-profile')

    invoiceOrgId.value = res.orgId
    effectiveInvoice.value = res.effective
    invoiceOverriding.value = !res.inherited

    const p = res.inherited ? res.effective : res.override
    invoiceForm.buyerUBN = p.buyerUBN ?? ''
    invoiceForm.buyerName = p.buyerName ?? ''
    invoiceForm.buyerEmail = p.buyerEmail ?? ''
    invoiceForm.carrierNum = p.carrierNum ?? ''
    invoiceForm.loveCode = p.loveCode ?? ''
  }
  catch { /* 讀不到就留空表單，不擋整頁 */ }
}

async function reloadAll() {
  loading.value = true
  try { await Promise.all([loadPlanSummary(), loadOrders(), loadInvoiceProfile()]) }
  finally { loading.value = false }
}

onMounted(async () => {
  await reloadAll()
  pollReturnedOrder()
})
onUnmounted(stopPoll)
</script>
