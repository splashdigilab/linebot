<template>
  <div class="card-section-stack">
    <div class="admin-field-group">
      <AdminFieldLabel
        text="統一編號"
        hint="公司報帳請填。填了就開立可列印的三聯式發票，載具與捐贈碼不適用。"
        tight
      />
      <el-input v-model="form.buyerUBN" placeholder="8 碼數字，個人請留空" maxlength="8" />
    </div>

    <div class="admin-field-group">
      <AdminFieldLabel :text="form.buyerUBN ? '公司抬頭（必填）' : '買受人名稱'" tight />
      <el-input v-model="form.buyerName" :placeholder="namePlaceholder" maxlength="60" />
    </div>

    <div class="admin-field-group">
      <AdminFieldLabel text="發票寄送 Email" tight />
      <el-input v-model="form.buyerEmail" placeholder="開立後寄送發票通知" />
    </div>

    <!-- 有統編 = B2B，載具／捐贈碼一律不適用（帶了 ezPay 也會退件）→ 直接不顯示，
         而不是顯示了再擋，免得使用者填完才被告知不能用 -->
    <template v-if="!form.buyerUBN">
      <div class="admin-field-group">
        <AdminFieldLabel text="手機條碼載具" hint="與捐贈碼只能擇一。都不填則開立紙本發票。" tight />
        <el-input v-model="form.carrierNum" placeholder="/ABC1234" maxlength="8" />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="捐贈碼" tight />
        <el-input v-model="form.loveCode" placeholder="3–7 碼數字" maxlength="7" />
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
</script>
