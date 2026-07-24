/**
 * 依 PAYUNi 交易結果結算訂單並（成功時）開通、開發票、寄收據。
 *
 * Notify webhook 與「主動查單對帳」共用這一支——確保「漏接 Notify 後補查」走的是與
 * Notify 完全相同的開通/開票/通知路徑,不會有兩套會漂移的邏輯。全程冪等
 * （settlePaidOrder 以訂單現況擋重複;發票開立內部也擋重開）。
 */
import { payuniPaymentType, type PayuniTradeResult } from './payuni'
import { settlePaidOrder } from './payment'
import { invoiceKeysFromConfig, issueInvoiceForOrder } from './invoice'
import { sendReceiptNotification } from './billing-emails'

export interface PayuniFulfillResult {
  merchantOrderNo: string
  paid: boolean
  /** 'no-order' = 回傳缺 MerTradeNo,無法對應訂單 */
  outcome: 'settled' | 'already' | 'unknown' | 'no-order'
  amountMismatch?: boolean
}

/**
 * @param paid  這筆是否已付款。**由呼叫端決定**（Notify 用 isPayuniPaid、查單對帳用 isTradePaid）——
 *              因為 Notify 與查單的外層狀態碼不同,paid 的判法也不同。
 */
export async function fulfillPayuniTrade(
  paid: boolean,
  result: PayuniTradeResult,
  config: Record<string, unknown>,
): Promise<PayuniFulfillResult> {
  const merchantOrderNo = String(result.MerTradeNo || '').trim()
  if (!merchantOrderNo) return { merchantOrderNo: '', paid: false, outcome: 'no-order' }

  const amtNum = Number(result.TradeAmt)
  const amount = Number.isFinite(amtNum) ? amtNum : undefined

  const settled = await settlePaidOrder({
    merchantOrderNo,
    paid,
    amount,
    tradeNo: result.TradeNo != null ? String(result.TradeNo) : null,
    paymentType: payuniPaymentType(result.PaymentType),
    // 失敗時把 PAYUNi 的錯誤訊息帶進去(卡片被拒/餘額不足…),供帳單頁顯示
    failReason: paid ? null : (result.Message ? String(result.Message) : null),
    now: new Date(),
    notifyRaw: {
      TradeStatus: result.TradeStatus ?? null,
      MerTradeNo: merchantOrderNo,
      TradeAmt: amount ?? null,
      TradeNo: result.TradeNo ?? null,
      PaymentType: result.PaymentType ?? null,
      PayTime: result.PayTime ?? null,
    },
  })

  // 開立電子發票 + 收據信。**吞掉所有失敗**——錢已經收了,開票/寄信失敗不能讓上游
  // 回非 200（PAYUNi 會重送 → 重複結算）。失敗會記在 invoices / 訂單上供補開。
  if (paid && settled.outcome === 'settled' && !settled.amountMismatch && settled.workspaceId) {
    await issueInvoiceForOrder({
      merchantOrderNo,
      workspaceId: settled.workspaceId,
      planId: settled.planId!,
      totalAmt: settled.amount!,
    }, invoiceKeysFromConfig(config))
    await sendReceiptNotification(merchantOrderNo)
  }

  return { merchantOrderNo, paid, outcome: settled.outcome, amountMismatch: settled.amountMismatch }
}
