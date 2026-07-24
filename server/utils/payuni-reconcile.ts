/**
 * 主動查單對帳（漏接 Notify 的補救）。
 *
 * 對每筆 pending 訂單打 PAYUNi 交易查詢（trade/query），已付款就走與 Notify 完全相同的
 * 開通路徑（fulfillPayuniTrade）。用途:客戶付了錢、但 Notify 沒送達／我方當機／有 bug 時,
 * 訂單不會卡在 pending 被 runPaymentReconcile 誤判逾期 → 避免「收了錢卻沒開通」。
 *
 * 金流未設定、單筆查詢失敗都安全跳過（try/catch），不影響其餘對帳。
 *
 * ⚠️ trade/query 的 HTTP 送法（本檔用 x-www-form-urlencoded）尚未對真實 PAYUNi 驗證;
 *    上線前請對測試特店跑一次確認回傳可解（純函式 buildTradeQuery/簽章已有單元測試）。
 */
import { getDb } from './firebase'
import { getPendingOrders } from './payment'
import { PAYUNI_QUERY_ENDPOINTS, buildTradeQuery, isTradePaid, resolvePayuniEnv, verifyAndDecryptPayuniNotify, type PayuniKeys } from './payuni'
import { fulfillPayuniTrade } from './payuni-fulfill'
import type { PaymentOrderDoc } from '~~/shared/types/payment'

/** 一次對帳最多查幾筆 pending（上限,避免 backlog 一次打爆 PAYUNi） */
const MAX_PENDING_PER_RUN = 200
/** 同時併發幾筆查詢（別對閘道一次開太多連線） */
const QUERY_CONCURRENCY = 5

export async function reconcilePayuniPending(
  config: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ checked: number; recovered: number }> {
  const merchantId = String(config.payuniMerchantId || '').trim()
  const keys: PayuniKeys = { merKey: String(config.payuniHashKey || ''), merIV: String(config.payuniHashIV || '') }
  if (!merchantId || !keys.merKey || !keys.merIV) return { checked: 0, recovered: 0 } // 金流未設定 → 略過
  const url = PAYUNI_QUERY_ENDPOINTS[resolvePayuniEnv(config.payuniEnv)]
  const ts = Math.floor(now.getTime() / 1000)

  const pending = await getPendingOrders(getDb(), MAX_PENDING_PER_RUN)

  /** 查一筆:已付款就補開通,回傳是否有真的補到。全程 try/catch,失敗回 false 不影響其他筆。 */
  const queryOne = async (order: PaymentOrderDoc): Promise<boolean> => {
    try {
      const fields = buildTradeQuery(merchantId, order.merchantOrderNo, keys, ts)
      // 明確用 text 讀回再自己 JSON.parse——不倚賴 PAYUNi 有沒有給 JSON content-type
      // （否則 $fetch 會回字串、EncryptInfo 變 undefined,整個補救靜默失效）。
      const raw = await $fetch<string>(url, {
        method: 'POST',
        body: new URLSearchParams({
          MerID: fields.MerID,
          Version: fields.Version,
          EncryptInfo: fields.EncryptInfo,
          HashInfo: fields.HashInfo,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        responseType: 'text',
      })
      let resp: Record<string, string>
      try { resp = JSON.parse(raw) }
      catch { console.warn('[payuni:reconcile] 回應非 JSON,略過', order.merchantOrderNo); return false }

      const enc = String(resp?.EncryptInfo || '')
      const hash = String(resp?.HashInfo || '')
      if (!enc || !hash) return false
      const result = verifyAndDecryptPayuniNotify(enc, hash, keys)
      // **只在 PAYUNi 確認已付款時補開通**;未付／查無訂單 → 留著讓它照時間到期,
      // 絕不能把還在等付款的 pending 丟給 settle(paid=false) 誤標成 failed。
      if (!result || !isTradePaid(result)) return false
      const r = await fulfillPayuniTrade(true, result, config)
      return r.outcome === 'settled'
    }
    catch (e) {
      console.warn('[payuni:reconcile] 查單失敗', order.merchantOrderNo, (e as Error)?.message)
      return false
    }
  }

  let recovered = 0
  for (let i = 0; i < pending.length; i += QUERY_CONCURRENCY) {
    const chunk = pending.slice(i, i + QUERY_CONCURRENCY)
    const results = await Promise.all(chunk.map(queryOne))
    recovered += results.filter(Boolean).length
  }
  return { checked: pending.length, recovered }
}
