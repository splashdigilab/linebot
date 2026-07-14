import { parseNotifyResult, verifyAndDecryptNotify } from '~~/server/utils/newebpay'
import { settlePaidOrder } from '~~/server/utils/payment'

/**
 * POST /newebpay/notify — 藍新 MPG 幕後 Notify(server→server,開通的唯一真相來源)。
 *
 * 驗簽(重算 TradeSha)→ 解密 TradeInfo → 依結果結算訂單並開通訂閱(冪等)。
 * 藍新會重送直到收 200,故務必冪等且盡量回 200;僅在「設定缺失 / 驗簽失敗 / 內容
 * 無法解析」時回非 200(這些重送也不會變好,但可留痕供修)。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const keys = { hashKey: String(config.newebpayHashKey || ''), hashIV: String(config.newebpayHashIV || '') }
  if (!keys.hashKey || !keys.hashIV) {
    console.error('[newebpay:notify] 金流金鑰未設定,無法驗證')
    throw createError({ statusCode: 500, statusMessage: 'gateway not configured' })
  }

  const body = await readBody(event)
  const tradeInfo = String(body?.TradeInfo || '')
  const tradeSha = String(body?.TradeSha || '')
  if (!tradeInfo || !tradeSha) {
    throw createError({ statusCode: 400, statusMessage: 'missing TradeInfo/TradeSha' })
  }

  const decrypted = verifyAndDecryptNotify(tradeInfo, tradeSha, keys)
  if (decrypted == null) {
    console.warn('[newebpay:notify] 驗簽失敗,拒絕')
    throw createError({ statusCode: 400, statusMessage: 'invalid signature' })
  }

  const payload = parseNotifyResult(decrypted)
  if (!payload) {
    console.warn('[newebpay:notify] 內容無法解析')
    throw createError({ statusCode: 400, statusMessage: 'invalid payload' })
  }

  const r = payload.Result
  const merchantOrderNo = String(r?.MerchantOrderNo || '').trim()
  if (!merchantOrderNo) {
    console.warn('[newebpay:notify] 缺 MerchantOrderNo,略過')
    return { status: 'ok' } // 無法對應訂單 → 回 200 停止重送
  }

  const paid = payload.Status === 'SUCCESS'
  const amtNum = typeof r?.Amt === 'number' ? r.Amt : Number(r?.Amt)
  const amount = Number.isFinite(amtNum) ? amtNum : undefined

  const settled = await settlePaidOrder({
    merchantOrderNo,
    paid,
    amount,
    tradeNo: r?.TradeNo != null ? String(r.TradeNo) : null,
    paymentType: r?.PaymentType != null ? String(r.PaymentType) : null,
    now: new Date(),
    notifyRaw: {
      Status: payload.Status,
      MerchantOrderNo: merchantOrderNo,
      Amt: amount ?? null,
      TradeNo: r?.TradeNo ?? null,
      PaymentType: r?.PaymentType ?? null,
      PayTime: r?.PayTime ?? null,
    },
  })

  if (settled.outcome === 'unknown') console.warn('[newebpay:notify] 查無訂單', merchantOrderNo)
  else if (settled.amountMismatch) console.error('[newebpay:notify] 金額不符,已標記失敗', merchantOrderNo)
  else console.log('[newebpay:notify]', merchantOrderNo, paid ? 'paid' : 'failed', settled.outcome)

  return { status: 'ok' }
})
