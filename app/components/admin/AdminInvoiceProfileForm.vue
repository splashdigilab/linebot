<template>
  <div class="card-section-stack">
    <div class="admin-field-group">
      <AdminFieldLabel
        text="統一編號"
        hint="公司報帳請填。填了就開立可列印的三聯式發票，載具與捐贈碼不適用。"
        tight
      />
      <el-input v-model="form.buyerUBN" placeholder="8 碼數字，個人請留空" maxlength="8" />
      <p v-if="ubnError" class="text-xs text-danger">{{ ubnError }}</p>
    </div>

    <div class="admin-field-group">
      <AdminFieldLabel :text="form.buyerUBN ? '公司抬頭（必填）' : '買受人名稱'" tight />
      <el-input v-model="form.buyerName" :placeholder="namePlaceholder" maxlength="60" />
    </div>

    <div class="admin-field-group">
      <AdminFieldLabel text="發票寄送 Email" tight />
      <el-input v-model="form.buyerEmail" placeholder="開立後寄送發票通知" />
      <p v-if="emailError" class="text-xs text-danger">{{ emailError }}</p>
    </div>

    <!-- 有統編 = B2B，載具／捐贈碼一律不適用（帶了 ezPay 也會退件）→ 直接不顯示，
         而不是顯示了再擋，免得使用者填完才被告知不能用 -->
    <template v-if="!form.buyerUBN">
      <div class="admin-field-group">
        <AdminFieldLabel text="手機條碼載具" hint="與捐贈碼只能擇一。都不填則開立紙本發票。" tight />
        <el-input v-model="form.carrierNum" placeholder="/ABC1234" maxlength="8" />
        <p v-if="carrierError" class="text-xs text-danger">{{ carrierError }}</p>
        <p v-else-if="exclusiveError" class="text-xs text-danger">{{ exclusiveError }}</p>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="捐贈碼" tight />
        <el-input v-model="form.loveCode" placeholder="3–7 碼數字" maxlength="7" />
        <p v-if="loveCodeError" class="text-xs text-danger">{{ loveCodeError }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 發票開立資訊的表單。組織層（預設值）與官方帳號層（覆寫）共用同一份，
 * 免得兩邊的驗證規則與欄位互斥邏輯各寫一次、然後慢慢飄走。
 */
export interface InvoiceForm {
  buyerUBN: string
  buyerName: string
  buyerEmail: string
  carrierNum: string
  loveCode: string
}

const form = defineModel<InvoiceForm>({ required: true })

const props = defineProps<{
  /** 沒填抬頭時的替代說明（組織頁用組織名、帳單頁用官方帳號名）。 */
  fallbackNameHint?: string
}>()

const namePlaceholder = computed(() =>
  props.fallbackNameHint ? `留空則使用「${props.fallbackNameHint}」` : '留空則使用帳號名稱',
)

// 前端即時驗證：錯格式在填寫時就提示，而不是付款後被 ezPay 退件才知道
const ubnError = computed(() => {
  const v = form.value.buyerUBN.trim()
  return v && !/^\d{8}$/.test(v) ? '統一編號需為 8 碼數字' : ''
})
const emailError = computed(() => {
  const v = form.value.buyerEmail.trim()
  return v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Email 格式不正確' : ''
})
const carrierError = computed(() => {
  const v = form.value.carrierNum.trim()
  return v && !/^\/[0-9A-Z.+-]{7}$/.test(v) ? '手機條碼格式為「/」加 7 碼（大寫英數與 . + -）' : ''
})
const loveCodeError = computed(() => {
  const v = form.value.loveCode.trim()
  return v && !/^\d{3,7}$/.test(v) ? '捐贈碼需為 3–7 碼數字' : ''
})
const exclusiveError = computed(() =>
  form.value.carrierNum.trim() && form.value.loveCode.trim() ? '手機條碼與捐贈碼只能擇一' : '',
)
</script>
