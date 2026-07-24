import { isPayuniPaid, verifyAndDecryptPayuniNotify } from '~~/server/utils/payuni'
import { fulfillPayuniTrade } from '~~/server/utils/payuni-fulfill'

/**
 * POST /payuni/notify — PAYUNi 統一金流 幕後 Notify(server→server,開通的唯一真相來源)。
 *
 * 驗簽(重算 HashInfo)→ 解密 EncryptInfo → 依結果結算訂單並開通訂閱(冪等)。
 * ⚠️ 與藍新不同:付款成功要「外層 Status=SUCCESS 且解密後 TradeStatus='1'」兩層都成立
 *    (見 isPayuniPaid)。外層 Status 只代表 API 回應正常,不代表錢進來了。
 *
 * PAYUNi 會重送直到收 200,故務必冪等且盡量回 200;僅在「設定缺失 / 驗簽失敗 /
 * 內容無法解析」時回非 200(這些重送也不會變好,但可留痕供修)。
 */
export default defineEventHandler(async (event) => {
  // ── [TEMP DEBUG] 擷取真實 PAYUNi Notify 原始內容(第一次確認格式用,驗完務必移除)──
  try {
    const raw = await readRawBody(event).catch(() => undefined)
    const parsed = await readBody(event).catch(() => undefined)
    const fs = await import('node:fs')
    fs.appendFileSync(
      '/private/tmp/claude-501/-Users-kevin-Documents-Github-linebot/8f963c0b-ca5c-45cb-846b-0d0800c03304/scratchpad/payuni-notify-raw.log',
      `\n=== ${new Date().toISOString()} ===\nRAW: ${raw}\nPARSED: ${JSON.stringify(parsed)}\n`,
    )
  }
  catch (e) { console.error('[payuni:notify] debug capture failed', e) }

  const config = useRuntimeConfig(event)
  const keys = { merKey: String(config.payuniHashKey || ''), merIV: String(config.payuniHashIV || '') }
  if (!keys.merKey || !keys.merIV) {
    console.error('[payuni:notify] 金流金鑰未設定,無法驗證')
    throw createError({ statusCode: 500, statusMessage: 'gateway not configured' })
  }

  const body = await readBody(event)
  const encryptInfo = String(body?.EncryptInfo || '')
  const hashInfo = String(body?.HashInfo || '')
  const outerStatus = String(body?.Status || '')
  if (!encryptInfo || !hashInfo) {
    throw createError({ statusCode: 400, statusMessage: 'missing EncryptInfo/HashInfo' })
  }

  const result = verifyAndDecryptPayuniNotify(encryptInfo, hashInfo, keys)
  if (result == null) {
    console.warn('[payuni:notify] 驗簽失敗,拒絕')
    throw createError({ statusCode: 400, statusMessage: 'invalid signature' })
  }

  // Notify:外層 Status=SUCCESS 且 TradeStatus='1' 才算已付款
  const paid = isPayuniPaid(outerStatus, result)
  // 結算 + 開通 + 開發票 + 寄收據（與主動查單對帳共用同一條路徑,全程冪等）
  const r = await fulfillPayuniTrade(paid, result, config as unknown as Record<string, unknown>)

  if (r.outcome === 'no-order') console.warn('[payuni:notify] 缺 MerTradeNo,略過')
  else if (r.outcome === 'unknown') console.warn('[payuni:notify] 查無訂單', r.merchantOrderNo)
  else if (r.amountMismatch) console.error('[payuni:notify] 金額不符,已標記失敗', r.merchantOrderNo)
  else console.log('[payuni:notify]', r.merchantOrderNo, r.paid ? 'paid' : 'failed', r.outcome)

  return { status: 'ok' } // 一律回 200 停止重送（冪等已擋重複）
})
