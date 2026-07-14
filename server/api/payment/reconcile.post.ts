import { runPaymentReconcile } from '~~/server/utils/payment'

/**
 * POST /api/payment/reconcile — 每日續期對帳（由排程觸發）。
 * ① 過期訂閱 → 滾到當期（付費沒續費則降回免費）② 卡住的 pending 訂單 → expired。
 *
 * Amplify 不跑 scheduledTasks,故用外部排程（EventBridge）每日帶 X-Cron-Secret
 * 打此端點,與 /api/broadcast/trigger-scheduled 同一保護模式。
 *
 * ⚠️ 這支排程只是把週期落地成資料。額度重置與到期降級的正確性不依賴它——
 *    每次讀訂閱都會就地推算當期（見 shared/billing/period.ts）。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const cronSecret = String(config.cronSecret || '').trim()
  const headerSecret = String(getHeader(event, 'x-cron-secret') || '').trim()
  if (!cronSecret || headerSecret !== cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const result = await runPaymentReconcile()
  return { ok: true, ...result }
})
