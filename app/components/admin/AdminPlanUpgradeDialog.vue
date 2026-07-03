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
      </div>
    </div>
    <div class="plan-upgrade-foot">
      <span class="text-xs text-muted">方案以「官方帳號」為單位各自計價，額度不跨帳號共用。</span>
      <el-button v-if="contactHref" type="primary" @click="contactUs">聯繫我們升級</el-button>
      <span v-else class="text-xs text-muted">升級或加購額度，請聯繫您的服務窗口。</span>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { BILLING_PLANS, BILLING_PLAN_ORDER, type BillingPlan } from '~~/shared/billing/plans'

defineProps<{ modelValue: boolean; currentPlanId?: string | null }>()
defineEmits<{ 'update:modelValue': [boolean] }>()

const plans = BILLING_PLAN_ORDER.map(id => BILLING_PLANS[id])

const config = useRuntimeConfig()
const contact = String(config.public.supportContact ?? '').trim()
const contactHref = contact
  ? (contact.startsWith('http') ? contact : `mailto:${contact}`)
  : ''
function contactUs() {
  if (contactHref) window.open(contactHref, '_blank')
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
