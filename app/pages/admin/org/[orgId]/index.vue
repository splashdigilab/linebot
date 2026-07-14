<template>
  <div class="org-page">
    <header class="org-head">
      <div class="org-head-main">
        <NuxtLink to="/admin/workspaces" class="org-back">← 切換帳號</NuxtLink>
        <h1>{{ orgName || '組織管理' }}</h1>
        <p class="org-sub">這個組織底下所有官方帳號的狀態</p>
      </div>
      <el-button v-if="!loading" size="small" :loading="refreshing" @click="load(true)">重新整理</el-button>
    </header>

    <div v-if="loading" class="org-loading">
      <div class="spinner" />
      <span>載入中…</span>
    </div>

    <template v-else>
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

      <!--
        發票資訊放在組織層：統編與抬頭幾乎一定是組織層級的東西——
        一家公司開 3 個官方帳號，不會想填 3 次統編。個別 OA 要開不同抬頭時才去帳單頁覆寫。
      -->
      <div v-if="invoiceEnabled" class="message-card ar-section-card org-invoice">
        <div class="message-card-header">
          <div class="card-header-main">
            <span class="badge badge-green">📄 發票資訊</span>
            <span class="text-xs text-muted">底下所有官方帳號預設沿用這一份</span>
          </div>
          <el-button size="small" :loading="savingInvoice" @click="saveInvoiceProfile">儲存</el-button>
        </div>
        <AdminInvoiceProfileForm v-model="invoiceForm" :fallback-name-hint="orgName" />
      </div>
    </template>

    <AdminToastHost />
  </div>
</template>

<script setup lang="ts">
import { derivePlanState, type PlanView } from '~~/shared/billing/plan-state'
import { BILLING_PLANS, type BillingPlanId } from '~~/shared/billing/plans'
import type { InvoiceForm } from '~~/app/components/admin/AdminInvoiceProfileForm.vue'

definePageMeta({ middleware: 'auth', layout: false })
useHead({ title: '組織管理 — LINE Bot 管理系統' })

const route = useRoute()
const router = useRouter()
const { getBearer } = useWorkspace()
const { showToast } = useAdminToast()

const orgId = computed(() => String(route.params.orgId || ''))

interface OverviewRow {
  workspaceId: string
  name: string
  plan: PlanView | null
  answered: number
  lineConnected: boolean
}

const loading = ref(true)
const refreshing = ref(false)
const orgName = ref('')
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

function planTagType(id: string): 'info' | 'success' | 'warning' {
  const p = BILLING_PLANS[id as BillingPlanId]
  if (!p) return 'info'
  if (p.internal) return 'warning'
  return p.id === 'free' ? 'info' : 'success'
}

function enter(workspaceId: string) {
  router.push(`/admin/${workspaceId}/conversation-stats`)
}

// ── 發票資訊（組織層的預設值）─────────────────────────────────
const config = useRuntimeConfig()
const invoiceEnabled = Boolean(config.public.invoiceEnabled)

const invoiceForm = reactive<InvoiceForm>({
  buyerUBN: '', buyerName: '', buyerEmail: '', carrierNum: '', loveCode: '',
})
const savingInvoice = ref(false)

async function orgFetch<T>(path: string, opts: Record<string, unknown> = {}): Promise<T> {
  const token = await getBearer()
  return await $fetch(`/api/admin/org/${orgId.value}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}` },
  }) as T
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
  }
  catch { /* 讀不到就留空表單，不擋整頁 */ }
}

async function saveInvoiceProfile() {
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

async function load(isRefresh = false) {
  if (isRefresh) refreshing.value = true
  try {
    const res = await orgFetch<{ org: { name: string }; workspaces: OverviewRow[] }>('/overview')
    orgName.value = res.org.name
    rows.value = res.workspaces
    await loadInvoiceProfile()
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

onMounted(() => load())
</script>
