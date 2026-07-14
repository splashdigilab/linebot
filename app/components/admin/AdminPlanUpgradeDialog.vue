<template>
  <el-dialog
    :model-value="modelValue"
    title="升級方案"
    width="560px"
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
          <el-button
            v-if="canCheckout(p)"
            type="primary"
            size="small"
            :loading="checkoutLoading === p.id"
            @click="checkout(p)"
          >
            {{ p.id === currentPlanId ? '續訂' : '訂閱' }}
          </el-button>
          <template v-else-if="p.custom">
            <el-button v-if="contactHref" size="small" @click="contactUs">聯繫我們</el-button>
            <span v-else class="text-xs text-muted">請洽窗口</span>
          </template>
        </div>
      </div>
    </div>
    <div class="plan-upgrade-foot">
      <span class="text-xs text-muted">方案以「官方帳號」為單位各自計價，額度不跨帳號共用。付款由藍新金流處理。</span>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { BILLING_PLANS, BILLING_PLAN_ORDER, type BillingPlan } from '~~/shared/billing/plans'

defineProps<{ modelValue: boolean; currentPlanId?: string | null }>()
defineEmits<{ 'update:modelValue': [boolean] }>()

// 內部/測試方案不對客戶顯示（僅 super admin 指派）
const plans = BILLING_PLAN_ORDER.map(id => BILLING_PLANS[id]).filter(p => !p.internal)

const { getBearer, workspaceId } = useWorkspace()
const { showToast } = useAdminToast()

const config = useRuntimeConfig()
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
  if (!workspaceId.value) return
  checkoutLoading.value = p.id
  try {
    const token = await getBearer()
    const res = await $fetch<CreateOrderResponse>('/api/payment/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { planId: p.id, workspaceId: workspaceId.value },
    })
    if (!res.action) throw new Error('金流尚未設定')
    submitToGateway(res.action, res.fields)
    // 送出後瀏覽器即導向藍新付款頁,不需重置 loading
  }
  catch (e: any) {
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
