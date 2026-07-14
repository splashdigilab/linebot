import { runPaymentReconcile } from '~~/server/utils/payment'

/**
 * POST /api/payment/reconcile — 到期對帳（由排程觸發）。
 * ① 過期付費訂閱 → 降 free(不設 canceled)② 卡住的 pending 訂單 → expired。
 *
 * Amplify 不跑 scheduledTasks,故用外部排程（EventBridge）每日帶 X-Cron-Secret
 * 打此端點,與 /api/broadcast/trigger-scheduled 同一保護模式。
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
