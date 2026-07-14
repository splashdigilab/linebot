import { runPaymentReconcile } from '~~/server/utils/payment'
import { periodConfigFrom } from '~~/server/utils/newebpay-period'
import { invoiceKeysFromConfig, reissueFailedInvoices } from '~~/server/utils/invoice'

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

  const cfg = config as unknown as Record<string, unknown>
  // 降級時要能終止藍新委託（不然客戶服務被降級、卡卻繼續被扣）
  const result = await runPaymentReconcile(new Date(), undefined, periodConfigFrom(cfg))
  // 順便補開之前失敗的發票（ezPay 短暫故障不該讓那批發票永久遺失）
  const invoices = await reissueFailedInvoices(invoiceKeysFromConfig(cfg))
  return { ok: true, ...result, invoices }
})
