<template>
  <div class="org-page">
    <header class="org-head">
      <div class="org-head-main">
        <NuxtLink to="/admin/workspaces" class="org-back">← 切換帳號</NuxtLink>
        <h1>{{ orgName || '組織管理' }}</h1>
        <p class="org-sub">這個組織底下所有官方帳號的狀態、帳務與管理員</p>
      </div>
      <el-button v-if="!loading" size="small" :loading="refreshing" @click="reloadAll(true)">重新整理</el-button>
    </header>

    <div v-if="loading" class="org-loading">
      <div class="spinner" />
      <span>載入中…</span>
    </div>

    <el-tabs v-else v-model="tab" class="org-tabs">
      <!-- ── 總覽 ──────────────────────────────────────────── -->
      <el-tab-pane label="總覽" name="overview">
        <div class="org-pane">
          <!-- 摘要：先回答「有沒有事要處理」，再讓他往下看細節 -->
          <div class="org-stats">
            <div class="org-stat">
              <span class="org-stat-num">{{ rows.length }}</span>
              <span class="org-stat-label">官方帳號</span>
            </div>
            <div class="org-stat" :class="{ 'is-alert': needsAttention.length > 0 }">
              <span class="org-stat-num">{{ needsAttention.length }}</span>
              <span class="org-stat-label">需要處理</span>
            </div>
            <div class="org-stat">
              <span class="org-stat-num">{{ paidCount }}</span>
              <span class="org-stat-label">付費方案</span>
            </div>
            <div class="org-stat">
              <span class="org-stat-num">{{ totalAnswered.toLocaleString() }}</span>
              <span class="org-stat-label">本期 AI 回覆則數</span>
            </div>
          </div>

          <div v-if="!rows.length" class="org-empty">
            <p>這個組織還沒有任何官方帳號。</p>
            <NuxtLink to="/admin/workspaces" class="text-xs">回帳號選擇頁建立第一個 →</NuxtLink>
          </div>

          <!-- 需要處理的排最前面：管 10 個 OA 的人要的是「哪個出事了」，不是一份名單 -->
          <div v-else class="org-grid">
            <button
              v-for="r in sortedRows"
              :key="r.workspaceId"
              class="org-card"
              :class="{ 'is-alert': isAlert(r) }"
              @click="enter(r.workspaceId)"
            >
              <div class="org-card-head">
                <span class="org-card-name">{{ r.name }}</span>
                <el-tag v-if="r.plan" size="small" effect="plain" :type="planTagType(r.plan.id)">
                  {{ r.plan.name }}
                </el-tag>
              </div>

              <div v-if="r.plan?.answeredQuota != null" class="org-card-quota">
                <el-progress
                  :percentage="state(r).percent"
                  :color="state(r).color"
                  :stroke-width="6"
                  :show-text="false"
                />
                <span class="org-card-quota-text">
                  本期 {{ r.answered.toLocaleString() }} / {{ r.plan.answeredQuota.toLocaleString() }} 則
                </span>
              </div>
              <div v-else class="org-card-quota">
                <span class="org-card-quota-text">客製額度，無固定上限</span>
              </div>

              <div class="org-card-flags">
                <span v-if="!r.lineConnected" class="org-flag org-flag--warn">尚未接上 LINE</span>
                <span v-else-if="state(r).state === 'over'" class="org-flag org-flag--bad">額度已用完，AI 停止回覆</span>
                <span v-else-if="state(r).state === 'near'" class="org-flag org-flag--warn">額度即將用完</span>
                <span v-else-if="r.plan?.status === 'past_due'" class="org-flag org-flag--warn">扣款未成功</span>
                <span v-else class="org-flag org-flag--ok">運作正常</span>
              </div>
            </button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ── 帳務 ──────────────────────────────────────────── -->
      <el-tab-pane label="帳務" name="billing">
        <div class="org-pane">
          <div class="org-stats">
            <div class="org-stat">
              <span class="org-stat-num">NT${{ monthlyTotal.toLocaleString() }}</span>
              <span class="org-stat-label">下一輪自動扣款總額</span>
            </div>
            <div class="org-stat">
              <span class="org-stat-num">{{ autoRenewCount }}</span>
              <span class="org-stat-label">自動續訂中</span>
            </div>
          </div>

          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">💳 各帳號方案</span>
              </div>
            </div>
            <div class="card-section-stack">
              <el-table :data="billingRows" size="small" empty-text="尚無官方帳號">
                <el-table-column label="官方帳號" min-width="140">
                  <template #default="{ row }">{{ row.name }}</template>
                </el-table-column>
                <el-table-column label="方案" min-width="80">
                  <template #default="{ row }">
                    <el-tag v-if="row.plan" size="small" effect="plain" :type="planTagType(row.plan.id)">
                      {{ row.plan.name }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="月費" min-width="90" align="right">
                  <template #default="{ row }">{{ priceLabel(row.plan?.id) }}</template>
                </el-table-column>
                <el-table-column label="續訂狀態" min-width="160">
                  <template #default="{ row }">
                    <span class="text-xs">{{ renewLabel(row) }}</span>
                  </template>
                </el-table-column>
                <el-table-column width="70" align="right">
                  <template #default="{ row }">
                    <el-button size="small" text @click="goBilling(row.workspaceId)">管理</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>

          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">🧾 付款紀錄</span>
                <span class="text-xs text-muted">整個組織，新到舊</span>
              </div>
            </div>
            <div class="card-section-stack">
              <!-- 讀不到就要說讀不到。渲染成一張「尚無付款紀錄」的空表，
                   等於告訴客戶他從來沒付過錢——那比誠實報錯糟糕得多。 -->
              <el-alert v-if="ordersError" type="warning" :closable="false" show-icon :title="ordersError" />
              <el-table v-else :data="orders" size="small" empty-text="尚無付款紀錄">
                <el-table-column label="日期" min-width="130">
                  <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="官方帳號" min-width="120">
                  <template #default="{ row }">{{ row.workspaceName }}</template>
                </el-table-column>
                <el-table-column label="方案" min-width="70">
                  <template #default="{ row }">{{ planName(row.planId) }}</template>
                </el-table-column>
                <el-table-column label="金額" min-width="80" align="right">
                  <template #default="{ row }">NT${{ row.amount.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column label="狀態" min-width="70">
                  <template #default="{ row }">
                    <el-tag :type="orderStatusType(row.status)" size="small">{{ orderStatusLabel(row.status) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column v-if="invoiceEnabled" label="發票號碼" min-width="100">
                  <template #default="{ row }">
                    <span v-if="row.invoiceNumber" class="billing-order-no">{{ row.invoiceNumber }}</span>
                    <span v-else class="text-xs text-muted">—</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>

          <!-- 發票資訊放在帳務分頁：它是帳務的一部分，不是「總覽」的一部分 -->
          <div v-if="invoiceEnabled" class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">📄 發票資訊</span>
                <span class="text-xs text-muted">底下所有官方帳號預設沿用這一份</span>
              </div>
              <el-button
                size="small"
                :loading="savingInvoice"
                :disabled="!invoiceLoaded"
                @click="saveInvoiceProfile"
              >
                儲存
              </el-button>
            </div>
            <!-- 讀不到就**不准存**。表單會是空的，而儲存是整份覆蓋——按下去等於把組織的
                 統編與抬頭清成空白，底下每個 OA 都開始開出沒有統編的發票，
                 而客戶要到會計退件那天才會發現。 -->
            <el-alert
              v-if="!invoiceLoaded"
              type="error"
              :closable="false"
              show-icon
              title="發票資訊讀取失敗，暫時無法編輯"
            >
              <span class="text-xs">為避免覆蓋掉已儲存的統編與抬頭，儲存已停用。請重新整理後再試。</span>
            </el-alert>
            <AdminInvoiceProfileForm v-else v-model="invoiceForm" :fallback-name-hint="orgName" />
          </div>
        </div>
      </el-tab-pane>

      <!-- ── 成員 ──────────────────────────────────────────── -->
      <el-tab-pane label="管理員" name="members">
        <div class="org-pane">
          <div class="message-card ar-section-card">
            <div class="message-card-header">
              <div class="card-header-main">
                <span class="badge badge-green">👥 組織管理員</span>
                <span class="text-xs text-muted">可管理這個組織底下的所有官方帳號</span>
              </div>
            </div>
            <div class="card-section-stack">
              <!-- 目前沒有邀請信：加進來的人不會收到任何通知，這件事必須講清楚，
                   不然邀請者會以為系統幫他通知了，然後兩邊都在等對方。 -->
              <el-alert type="info" :closable="false" show-icon>
                <span class="text-xs">
                  以 Google 信箱認人，對方不需要先註冊。<strong>系統目前不會寄出通知信</strong>——
                  加完之後請自行告訴他可以用這個信箱登入了。
                </span>
              </el-alert>

              <div class="org-member-add">
                <el-input
                  v-model="newMemberEmail"
                  placeholder="輸入 Google 信箱"
                  @keyup.enter="addMember"
                />
                <el-button type="primary" :loading="addingMember" @click="addMember">新增管理員</el-button>
              </div>

              <el-table :data="members" size="small" empty-text="尚無管理員">
                <el-table-column label="Email" min-width="220">
                  <template #default="{ row }">
                    <span class="billing-order-no">{{ row.email }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="" min-width="120">
                  <template #default="{ row }">
                    <el-tag v-if="row.isOwner" size="small" type="success" effect="plain">登記擁有者</el-tag>
                    <el-tag v-else-if="row.isSelf" size="small" effect="plain">你自己</el-tag>
                  </template>
                </el-table-column>
                <el-table-column width="80" align="right">
                  <template #default="{ row }">
                    <el-button
                      v-if="!row.isOwner && !row.isSelf && members.length > 1"
                      size="small"
                      text
                      type="danger"
                      @click="removeMember(row)"
                    >
                      移除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <AdminToastHost />
  </div>
</template>

<script setup lang="ts">
import { derivePlanState, type PlanView } from '~~/shared/billing/plan-state'
import { BILLING_PLANS, type BillingPlanId } from '~~/shared/billing/plans'
import type { PaymentOrderStatus } from '~~/shared/types/payment'
import type { InvoiceForm } from '~~/app/components/admin/AdminInvoiceProfileForm.vue'

definePageMeta({ middleware: 'auth', layout: false })
useHead({ title: '組織管理 — LINE Bot 管理系統' })

const route = useRoute()
const router = useRouter()
const { getBearer } = useWorkspace()
const { showToast } = useAdminToast()

const orgId = computed(() => String(route.params.orgId || ''))
// 分頁狀態同步到 URL（?tab=），重整或分享連結不會掉回總覽
const ORG_TABS = ['overview', 'billing', 'members']
const initialTab = String(route.query.tab || '')
const tab = ref(ORG_TABS.includes(initialTab) ? initialTab : 'overview')
watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t } })
})

const config = useRuntimeConfig()
const invoiceEnabled = Boolean(config.public.invoiceEnabled)

const loading = ref(true)
const refreshing = ref(false)
const orgName = ref('')

async function orgFetch<T>(path: string, opts: Record<string, unknown> = {}): Promise<T> {
  const token = await getBearer()
  return await $fetch(`/api/admin/org/${orgId.value}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}` },
  }) as T
}

function planTagType(id: string): 'info' | 'success' | 'warning' {
  const p = BILLING_PLANS[id as BillingPlanId]
  if (!p) return 'info'
  if (p.internal) return 'warning'
  return p.id === 'free' ? 'info' : 'success'
}
function planName(id: string) { return BILLING_PLANS[id as BillingPlanId]?.name ?? id }
function priceLabel(id?: BillingPlanId) {
  const p = id ? BILLING_PLANS[id] : null
  if (!p || p.priceMonthly == null) return '—'
  return p.priceMonthly === 0 ? '免費' : `NT$${p.priceMonthly.toLocaleString()}`
}

// ── 總覽 ──────────────────────────────────────────────────
interface OverviewRow {
  workspaceId: string
  name: string
  plan: PlanView | null
  answered: number
  lineConnected: boolean
}
const rows = ref<OverviewRow[]>([])

function state(r: OverviewRow) {
  return derivePlanState(r.plan, r.answered)
}

/** 需要處理 = 額度撞頂 / 快撞頂 / LINE 還沒接 / 扣款未成功。 */
function isAlert(r: OverviewRow): boolean {
  if (!r.lineConnected) return true
  if (r.plan?.status === 'past_due') return true
  const s = state(r).state
  return s === 'over' || s === 'near'
}

const needsAttention = computed(() => rows.value.filter(isAlert))
const paidCount = computed(() => rows.value.filter(r => r.plan && r.plan.id !== 'free').length)
const totalAnswered = computed(() => rows.value.reduce((sum, r) => sum + r.answered, 0))

/** 嚴重度排序：AI 已經停止回覆 > 還沒接上線 > 快撞頂 > 正常。 */
function severity(r: OverviewRow): number {
  const s = state(r).state
  if (s === 'over') return 3
  if (!r.lineConnected) return 2
  if (s === 'near' || r.plan?.status === 'past_due') return 1
  return 0
}
const sortedRows = computed(() =>
  [...rows.value].sort((a, b) => severity(b) - severity(a) || a.name.localeCompare(b.name)),
)

function enter(workspaceId: string) {
  router.push(`/admin/${workspaceId}/conversation-stats`)
}

// ── 帳務 ──────────────────────────────────────────────────
interface BillingRow {
  workspaceId: string
  name: string
  plan: PlanView | null
  nextChargeDate: string | null
}
interface OrderRow {
  merchantOrderNo: string
  workspaceName: string
  planId: string
  amount: number
  status: PaymentOrderStatus
  createdAt: number | null
  invoiceNumber: string | null
}
const billingRows = ref<BillingRow[]>([])
const orders = ref<OrderRow[]>([])
const monthlyTotal = ref(0)
/** 付款紀錄讀不到時的訊息。有值 → 顯示錯誤，**不要**渲染成一張「尚無付款紀錄」的空表。 */
const ordersError = ref<string | null>(null)

const autoRenewCount = computed(() => billingRows.value.filter(r => r.plan?.autoRenew).length)

/** 續訂狀態要一句話說完，不要讓人自己去拼「autoRenew + cancelAtPeriodEnd + status」。 */
function renewLabel(r: BillingRow): string {
  const p = r.plan
  if (!p || p.id === 'free') return '—'
  if (p.status === 'past_due') return '⚠️ 扣款未成功'
  if (p.cancelAtPeriodEnd) return `已取消，用到 ${p.currentPeriodEnd}`
  if (p.autoRenew) return `自動續訂・${r.nextChargeDate} 扣款`
  return `單次付款，${p.currentPeriodEnd} 到期`
}

function goBilling(workspaceId: string) {
  router.push(`/admin/${workspaceId}/settings/billing`)
}

const ORDER_STATUS_LABEL: Record<PaymentOrderStatus, string> = {
  pending: '待付款', paid: '已付款', failed: '失敗', expired: '已逾期',
}
function orderStatusLabel(s: PaymentOrderStatus) { return ORDER_STATUS_LABEL[s] ?? s }
function orderStatusType(s: PaymentOrderStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (s === 'paid') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'pending') return 'warning'
  return 'info'
}
function fmtTime(ms: number | null) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 發票資訊（組織層的預設值）─────────────────────────────────
const invoiceForm = reactive<InvoiceForm>({
  buyerUBN: '', buyerName: '', buyerEmail: '', carrierNum: '', loveCode: '',
})
const savingInvoice = ref(false)
/** 讀取成功才允許儲存——見下方 saveInvoiceProfile 的說明。 */
const invoiceLoaded = ref(false)

async function saveInvoiceProfile() {
  // 儲存是**整份覆蓋**。若 GET 失敗過（表單是空的而不是「真的沒填」），存下去等於把組織
  // 已儲存的統編與抬頭清成 null，而底下每個 OA 都沿用這一份 → 全部開始開出沒有統編的發票。
  // 這種錯誤是靜默的，客戶要到會計退件那天才會發現。所以沒讀成功就一律不准存。
  if (!invoiceLoaded.value) {
    showToast('發票資訊尚未讀取成功，為避免覆蓋既有資料，請重新整理後再試', 'error')
    return
  }

  savingInvoice.value = true
  try {
    await orgFetch('/invoice-profile', { method: 'POST', body: { ...invoiceForm } })
    showToast('發票資訊已儲存，底下所有官方帳號都會沿用', 'success')
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    savingInvoice.value = false
  }
}

// ── 組織管理員 ────────────────────────────────────────────
interface MemberRow {
  docId: string
  email: string
  isOwner: boolean
  isSelf: boolean
}
const members = ref<MemberRow[]>([])
const newMemberEmail = ref('')
const addingMember = ref(false)

async function addMember() {
  const email = newMemberEmail.value.trim()
  if (!email) return

  // 組織管理員 = 組織底下所有官方帳號的 admin。這不是一個輕的動作，要問清楚。
  try {
    await ElMessageBox.confirm(
      `「${email}」將成為組織管理員，可以管理這個組織底下的所有官方帳號，包含計費與付款。`,
      '新增組織管理員',
      { confirmButtonText: '確認新增', cancelButtonText: '取消', type: 'warning' },
    )
  }
  catch { return }

  addingMember.value = true
  try {
    await orgFetch('/members', { method: 'POST', body: { email } })
    showToast(`已新增。請自行通知對方可以用這個信箱登入了（系統不會寄信）`, 'success')
    newMemberEmail.value = ''
    await loadMembers()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '新增失敗', 'error')
  }
  finally {
    addingMember.value = false
  }
}

async function removeMember(row: MemberRow) {
  try {
    await ElMessageBox.confirm(
      `移除後「${row.email}」將失去這個組織底下所有官方帳號的管理權限。`,
      '移除組織管理員',
      { confirmButtonText: '確認移除', cancelButtonText: '取消', type: 'warning' },
    )
  }
  catch { return }

  try {
    await orgFetch(`/members/${row.docId}`, { method: 'DELETE' })
    showToast('已移除', 'success')
    await loadMembers()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '移除失敗', 'error')
  }
}

// ── 載入 ──────────────────────────────────────────────────
async function loadOverview() {
  const res = await orgFetch<{ org: { name: string }; workspaces: OverviewRow[] }>('/overview')
  orgName.value = res.org.name
  rows.value = res.workspaces
}

async function loadBilling() {
  try {
    const res = await orgFetch<{
      workspaces: BillingRow[]
      monthlyTotal: number
      orders: OrderRow[]
      ordersError: string | null
    }>('/billing')
    billingRows.value = res.workspaces
    monthlyTotal.value = res.monthlyTotal
    orders.value = res.orders
    ordersError.value = res.ordersError
  }
  catch (e: any) {
    // 帳務讀不到不該讓整頁掛掉，但也不能假裝一切正常
    ordersError.value = e?.data?.statusMessage || '帳務資料暫時讀不到，請稍後再試'
  }
}

async function loadMembers() {
  try {
    const res = await orgFetch<{ members: MemberRow[] }>('/members')
    members.value = res.members
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '管理員名單讀取失敗', 'error')
  }
}

async function loadInvoiceProfile() {
  if (!invoiceEnabled) return
  try {
    const { profile } = await orgFetch<{ profile: Record<string, string | null> }>('/invoice-profile')
    invoiceForm.buyerUBN = profile.buyerUBN ?? ''
    invoiceForm.buyerName = profile.buyerName ?? ''
    invoiceForm.buyerEmail = profile.buyerEmail ?? ''
    invoiceForm.carrierNum = profile.carrierNum ?? ''
    invoiceForm.loveCode = profile.loveCode ?? ''
    invoiceLoaded.value = true // ← 讀成功才准存（見 saveInvoiceProfile）
  }
  catch {
    invoiceLoaded.value = false
  }
}

async function reloadAll(isRefresh = false) {
  if (isRefresh) refreshing.value = true
  try {
    // 總覽是主資料（也負責驗權限）；其餘並行拉，任一失敗不影響其他分頁
    await loadOverview()
    await Promise.all([loadBilling(), loadMembers(), loadInvoiceProfile()])
  }
  catch (e: any) {
    // 不是這個組織的管理員 → 沒必要停在一個空頁面上，送他回帳號選擇頁
    if (e?.status === 403 || e?.statusCode === 403) {
      showToast('你不是此組織的管理員', 'error')
      await navigateTo('/admin/workspaces')
      return
    }
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  }
  finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(() => reloadAll())
</script>
