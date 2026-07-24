/**
 * 每日/定期計費對帳的單一入口——手動端點（/api/payment/reconcile）與「有流量時順便跑」的
 * middleware tick 都呼叫這支,確保兩條路做的事完全一致。
 *
 * 順序有意義：① 先對每筆 pending 主動查 PAYUNi（漏接 Notify 的補救,已付就補開通）
 *            ② 再把「過期訂閱滾期/降級」「真的沒付且逾時的 pending 標逾期」落地
 *            ③ 補開之前失敗的發票 ④ 續扣前提醒 + 額度通知（未設 SES 時內部略過,零成本）
 */
import { runPaymentReconcile } from './payment'
import { reconcilePayuniPending } from './payuni-reconcile'
import { periodConfigFrom } from './newebpay-period'
import { invoiceKeysFromConfig, reissueFailedInvoices } from './invoice'
import { sendDueBillingEmails } from './billing-emails'

export async function runBillingReconcile(config: Record<string, unknown>, now: Date = new Date()) {
  const payuni = await reconcilePayuniPending(config, now)
  const result = await runPaymentReconcile(now, undefined, periodConfigFrom(config))
  const invoices = await reissueFailedInvoices(invoiceKeysFromConfig(config))
  const emails = await sendDueBillingEmails(now)
  return { ...result, payuni, invoices, emails }
}
