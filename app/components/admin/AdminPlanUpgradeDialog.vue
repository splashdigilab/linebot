<template>
  <el-dialog
    :model-value="modelValue"
    title="選擇方案"
    width="min(560px, 92vw)"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="plan-upgrade-list">
      <div
        v-for="p in plans"
        :key="p.id"
        class="plan-upgrade-row"
        :class="{ 'is-current': p.id === currentPlanId }"
      >
        <div class="pu-info">
          <div class="pu-name">
            {{ p.name }}
            <el-tag v-if="p.id === currentPlanId" size="small" type="success" effect="plain">目前方案</el-tag>
          </div>
          <div class="pu-specs">
            {{ quotaLabel(p) }}<template v-if="perkLabel(p)"> · {{ perkLabel(p) }}</template>
          </div>
        </div>
        <div class="pu-price">{{ priceLabel(p) }}</div>
        <div class="pu-action">
          <el-tooltip
            v-if="canCheckout(p)"
            :disabled="paymentEnabled"
            content="線上付款尚未開通，請聯繫我們"
            placement="top"
          >
            <!-- disabled 的按鈕不會觸發 tooltip，需外層 span 承接 hover -->
            <span>
              <el-button
                :type="planAction(p) === '降級' ? 'info' : 'primary'"
                :plain="planAction(p) === '降級'"
                size="small"
                :disabled="!paymentEnabled"
                :loading="checkoutLoading === p.id"
                @click="checkout(p)"
              >
                {{ planAction(p) }}
              </el-button>
            </span>
          </el-tooltip>
          <template v-else-if="p.custom">
            <el-button v-if="contactHref" size="small" @click="contactUs">聯繫我們</el-button>
            <span v-else class="text-xs text-muted">請洽窗口</span>
          </template>
          <!-- 免費層：不需結帳，但也不要留空白格（會像壞掉） -->
          <span v-else class="text-xs text-muted">{{ p.id === currentPlanId ? '使用中' : '免費' }}</span>
        </div>
      </div>
    </div>
    <div class="plan-upgrade-foot">
      <span class="text-xs text-muted">方案以「官方帳號」為單位各自計價，額度不跨帳號共用。付款由藍新金流處理。</span>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElLoading, ElMessageBox } from 'element-plus'
import { BILLING_PLANS, BILLING_PLAN_ORDER, type BillingPlan, type BillingPlanId } from '~~/shared/billing/plans'

const props = defineProps<{ modelValue: boolean; currentPlanId?: string | null }>()
defineEmits<{ 'update:modelValue': [boolean] }>()

// 內部/測試方案不對客戶顯示（僅 super admin 指派）
const plans = BILLING_PLAN_ORDER.map(id => BILLING_PLANS[id]).filter(p => !p.internal)

/** 相對目前方案的動作：續訂 / 升級 / 降級——避免客戶把降級誤看成升級而誤扣款。 */
function planAction(p: BillingPlan): '續訂' | '升級' | '降級' {
  if (p.id === props.currentPlanId) return '續訂'
  const cur = BILLING_PLAN_ORDER.indexOf((props.currentPlanId ?? 'free') as BillingPlanId)
  return BILLING_PLAN_ORDER.indexOf(p.id) > cur ? '升級' : '降級'
}

const { getBearer, workspaceId } = useWorkspace()
const { showToast } = useAdminToast()

const config = useRuntimeConfig()
/** 藍新金鑰都設好才允許結帳；否則按下去只會拿到 500「金流尚未設定」。 */
const paymentEnabled = Boolean(config.public.paymentEnabled)
const contact = String(config.public.supportContact ?? '').trim()
const contactHref = contact
  ? (contact.startsWith('http') ? contact : `mailto:${contact}`)
  : ''
function contactUs() {
  if (contactHref) window.open(contactHref, '_blank')
}

/** 可線上結帳:付費且非客製方案(免費層不需結帳、企業走聯繫)。 */
function canCheckout(p: BillingPlan): boolean {
  return !p.custom && p.priceMonthly != null && p.priceMonthly > 0
}

const checkoutLoading = ref('')

interface CreateOrderResponse { action: string; method: string; fields: Record<string, string> }

async function checkout(p: BillingPlan) {
  if (!workspaceId.value || !paymentEnabled) return

  // 結帳前先確認：講清楚要付多少、買哪個方案。避免一個誤點（尤其降級）就被直接
  // 帶去外部金流扣款。
  const action = planAction(p)
  const price = (p.priceMonthly ?? 0).toLocaleString()
  try {
    await ElMessageBox.confirm(
      `將以 NT$${price} ${action}「${p.name}」方案（每月一期），接著前往藍新金流的安全付款頁面完成付款。`,
      `確認${action}方案`,
      {
        confirmButtonText: '前往付款',
        cancelButtonText: '取消',
        type: action === '降級' ? 'warning' : 'info',
      },
    )
  }
  catch {
    return // 使用者取消
  }

  checkoutLoading.value = p.id
  // 導向外部金流中間會有一段空白，給明確過場提示，不要讓畫面像當掉
  const overlay = ElLoading.service({ lock: true, text: '正在前往藍新安全付款頁面…' })
  try {
    const token = await getBearer()
    const res = await $fetch<CreateOrderResponse>('/api/payment/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { planId: p.id, workspaceId: workspaceId.value },
    })
    if (!res.action) throw new Error('金流尚未設定')
    submitToGateway(res.action, res.fields)
    // 送出後瀏覽器即導向藍新付款頁；overlay 保持到頁面離開為止
  }
  catch (e: any) {
    overlay.close()
    showToast(e?.data?.statusMessage || e?.data?.message || e?.message || '建立訂單失敗', 'error')
    checkoutLoading.value = ''
  }
}

/** 動態建 hidden form 自動 POST 到藍新 MPG 付款頁。 */
function submitToGateway(action: string, fields: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = k
    input.value = String(v)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

function quotaLabel(p: BillingPlan): string {
  if (p.answeredQuota == null) return '客製額度'
  return `${p.answeredQuota.toLocaleString()} 則/月`
}
function priceLabel(p: BillingPlan): string {
  if (p.priceMonthly == null) return '面談報價'
  if (p.priceMonthly === 0) return '免費'
  return `NT$${p.priceMonthly.toLocaleString()}/月`
}
function perkLabel(p: BillingPlan): string {
  const parts: string[] = []
  parts.push(p.seats == null ? '不限席次' : `${p.seats} 席`)
  if (p.scripting) parts.push('腳本自動化')
  if (p.api) parts.push('API')
  return parts.join('・')
}
</script>
