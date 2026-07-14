<template>
  <div v-if="show" class="quota-banner" :class="`quota-banner--${state.state}`" role="status">
    <span class="quota-banner__icon">{{ state.state === 'over' ? '🛑' : '⚠️' }}</span>

    <div class="quota-banner__body">
      <p class="quota-banner__title">{{ title }}</p>
      <!-- 重點是「用完會怎樣」，不是剩幾則。「剩 40 則」對客戶沒有意義，
           「用完後 AI 就不再自動回覆、客人全部轉給真人」才會讓人想升級。 -->
      <p class="quota-banner__desc">{{ desc }}</p>
    </div>

    <div class="quota-banner__actions">
      <el-button type="primary" size="small" @click="upgradeOpen = true">升級方案</el-button>
      <!-- 已經停止回覆時不給關閉：那是服務中斷，不是提醒 -->
      <el-button v-if="state.state === 'near'" size="small" text @click="dismiss">稍後再說</el-button>
    </div>

    <AdminPlanUpgradeDialog v-model="upgradeOpen" :current-plan-id="plan?.id ?? null" />
  </div>
</template>

<script setup lang="ts">
/**
 * 額度快用完 / 已用完的升級提示。
 *
 * 「免費額度用到 80%」是整個產品裡**轉換率最高的時機**——客人正在用、正覺得有用、
 * 正要不夠用。在那之前推銷是賣空氣，在那之後才推就已經斷線了。
 *
 * 顯示規則：
 *   · 只給**按得下升級鈕的人**看（admin 以上）。客服 / 觀察者看到也沒辦法處理，純噪音。
 *   · `near`（≥80%）→ 警告，可關閉（關閉只對「這個帳號的這一期」有效，下一期會再出現）。
 *   · `over`（100%）→ **不可關閉**。那不是提醒，那是 AI 已經停止回覆的服務中斷。
 *   · 客製 / 內部方案（無額度上限）→ 永遠不顯示。
 *   · 帳單頁本身不顯示（升級按鈕就在那頁上，再掛一條橫幅只是噪音）。
 */
const route = useRoute()
const { workspaceId, canManageSettings } = useWorkspace()
const { plan, state, load } = usePlanSummary()

const upgradeOpen = ref(false)
const dismissed = ref(false)

/** 關閉只針對「這個官方帳號的這一期」——下一期額度重置後要重新提醒。 */
const dismissKey = computed(() =>
  `quota-dismiss:${workspaceId.value}:${plan.value?.currentPeriodStart ?? ''}`,
)

const onBillingPage = computed(() => route.path.includes('/settings/billing'))

const show = computed(() => {
  if (!canManageSettings.value || onBillingPage.value) return false
  if (!plan.value || plan.value.answeredQuota == null) return false // 客製 / 內部方案：無上限
  if (state.value.state === 'over') return true // 服務已中斷 → 一律顯示，不理會關閉
  return state.value.state === 'near' && !dismissed.value
})

const title = computed(() => {
  if (state.value.state === 'over') return 'AI 已停止自動回覆'
  return `本期額度只剩 ${state.value.remaining?.toLocaleString() ?? 0} 則`
})

// ⚠️ 文案要準確：額度用完時**規則與腳本照常運作**，只有「原本由 AI 接手回答」的訊息
//    才會改成轉真人（見 server/utils/ai-answer.ts 的 quota 護欄）。寫成「所有訊息都轉真人」
//    會誇大，而客戶一用就會發現不是那樣——嚇唬人換來的升級，換來的是不信任。
const desc = computed(() => {
  const used = state.value.used.toLocaleString()
  const limit = state.value.limit?.toLocaleString() ?? ''
  if (state.value.state === 'over') {
    return `本期 ${limit} 則已用完。自動回覆與腳本仍正常運作，但需要 AI 回答的問題現在都會轉給真人客服。升級後立即恢復。`
  }
  return `本期已用 ${used} / ${limit} 則。用完後需要 AI 回答的問題會改為轉給真人客服（自動回覆與腳本不受影響）。`
})

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(dismissKey.value, '1')
  }
  catch { /* 無痕模式等情況：關不掉就下次再顯示，不是什麼大事 */ }
}

onMounted(async () => {
  // 沒有計費權限的人不必打這支（plan-summary 需要 admin，打了只會拿到 403）
  if (!canManageSettings.value) return
  await load()
  try {
    dismissed.value = localStorage.getItem(dismissKey.value) === '1'
  }
  catch { /* ignore */ }
})
</script>
