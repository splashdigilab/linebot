import { isPeriodPaid, verifyAndDecryptPayuniNotify } from '~~/server/utils/payuni'
import { payuniPeriodConfigFrom, terminatePayuniPeriod } from '~~/server/utils/payuni-period'
import { settlePaidOrder, settleRecurringAuth } from '~~/server/utils/payment'
import { invoiceKeysFromConfig, issueInvoiceForOrder } from '~~/server/utils/invoice'
import { sendChargeFailedNotification, sendReceiptNotification } from '~~/server/utils/billing-emails'

/**
 * POST /payuni/period-notify — PAYUNi 續期收款「每期授權完成通知」（開通與續期的真相來源）。
 *
 * 同一端點收兩種：① **首期**（ThisPeriod=1，FType=build 當日委託建立即首扣）② **續期**（ThisPeriod>1）。
 * ⚠️ 續期通知**沒有 TradeStatus**——付款成功看解密後 `Status===SUCCESS`（isPeriodPaid），不是 UPP 的 TradeStatus。
 * 每期唯一冪等鍵 = `PeriodOrderNo`（`原單號_期數`）。續期委託 ID = `PeriodTradeNo`（取消/換卡用）。
 *
 * PAYUNi 會重送直到收 200 → 冪等且盡量回 200。開發票/寄信失敗吞掉,絕不讓這裡回非 200（會重複結算）。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const merchantId = String(config.payuniMerchantId || '').trim()
  const keys = { merKey: String(config.payuniHashKey || ''), merIV: String(config.payuniHashIV || '') }
  if (!keys.merKey || !keys.merIV || !merchantId) {
    console.error('[payuni:period] 金流金鑰未設定,無法驗證')
    throw createError({ statusCode: 500, statusMessage: 'gateway not configured' })
  }

  const body = await readBody(event)
  const encryptInfo = String(body?.EncryptInfo || '')
  const hashInfo = String(body?.HashInfo || '')
  if (!encryptInfo || !hashInfo) {
    throw createError({ statusCode: 400, statusMessage: 'missing EncryptInfo/HashInfo' })
  }

  const result = verifyAndDecryptPayuniNotify(encryptInfo, hashInfo, keys)
  if (result == null) {
    console.warn('[payuni:period] 驗簽失敗,拒絕')
    throw createError({ statusCode: 400, statusMessage: 'invalid signature' })
  }

  // 特店代號比對（縱深防禦；驗簽已擋外人）。欄位名是 MerchantId。
  const notifyMer = String(result.MerchantId || result.MerID || '')
  if (notifyMer && notifyMer !== merchantId) {
    console.warn('[payuni:period] 特店代號不符,略過', notifyMer)
    return { status: 'ok' }
  }

  const merchantOrderNo = String(result.MerTradeNo || '').trim()
  if (!merchantOrderNo) {
    console.warn('[payuni:period] 缺 MerTradeNo,略過')
    return { status: 'ok' }
  }

  const paid = isPeriodPaid(result)
  const periodTradeNo = result.PeriodTradeNo != null ? String(result.PeriodTradeNo) : null
  const thisPeriod = Number(result.ThisPeriod)
  const now = new Date()
  const invoiceKeys = invoiceKeysFromConfig(config as unknown as Record<string, unknown>)

  // ── ② 續期（第 2 期以後）───────────────────────────────────
  if (Number.isFinite(thisPeriod) && thisPeriod > 1) {
    const amt = Number(result.AuthAmt)
    const settled = await settleRecurringAuth({
      merchantOrderNo,
      // 每期唯一：PeriodOrderNo=`原單號_期數`；沒給就自行組
      ledgerOrderNo: String(result.PeriodOrderNo || `${merchantOrderNo}_${thisPeriod}`),
      paid,
      periodNo: periodTradeNo,
      tradeNo: result.TradeNo != null ? String(result.TradeNo) : null,
      amount: Number.isFinite(amt) ? amt : undefined,
      periodTimes: thisPeriod,
      now,
      notifyRaw: {
        Status: result.Status ?? null,
        PeriodTradeNo: periodTradeNo,
        PeriodOrderNo: result.PeriodOrderNo ?? null,
        ThisPeriod: result.ThisPeriod ?? null,
        TotalTimes: result.TotalTimes ?? null,
        AuthAmt: result.AuthAmt ?? null,
        NextAuthDate: result.NextAuthDate ?? null,
      },
    })
    console.log('[payuni:period] 續期', merchantOrderNo, `第 ${thisPeriod} 期`, settled.outcome)

    if (settled.outcome === 'renewed' && settled.workspaceId && settled.ledgerOrderNo) {
      await issueInvoiceForOrder({ merchantOrderNo: settled.ledgerOrderNo, workspaceId: settled.workspaceId, planId: settled.planId!, totalAmt: settled.amount! }, invoiceKeys)
      await sendReceiptNotification(settled.ledgerOrderNo)
    }
    else if (settled.outcome === 'past_due' && settled.workspaceId && settled.planId) {
      await sendChargeFailedNotification({ workspaceId: settled.workspaceId, planId: settled.planId })
    }
    return { status: 'ok' }
  }

  // ── ① 首期（委託建立 + 第 1 期）─────────────────────────────
  const authAmt = Number(result.AuthAmt ?? result.PeriodAmt)
  const settled = await settlePaidOrder({
    merchantOrderNo,
    paid,
    amount: Number.isFinite(authAmt) ? authAmt : undefined,
    periodNo: periodTradeNo, // 有委託 ID → 訂閱開啟自動續訂
    tradeNo: result.TradeNo != null ? String(result.TradeNo) : null,
    paymentType: 'CREDIT',
    now,
    notifyRaw: {
      Status: result.Status ?? null,
      PeriodTradeNo: periodTradeNo,
      PeriodOrderNo: result.PeriodOrderNo ?? null,
      ThisPeriod: result.ThisPeriod ?? null,
      AuthAmt: result.AuthAmt ?? null,
    },
  })

  const activated = paid && settled.outcome === 'settled' && !settled.amountMismatch && settled.workspaceId
  if (settled.outcome === 'unknown') console.warn('[payuni:period] 查無訂單', merchantOrderNo)
  else if (settled.amountMismatch) console.error('[payuni:period] 金額不符,已標記失敗', merchantOrderNo)
  else console.log('[payuni:period] 委託建立', merchantOrderNo, paid ? 'paid' : 'failed', settled.outcome, 'periodTradeNo=', periodTradeNo)

  const periodCfg = payuniPeriodConfigFrom(config as unknown as Record<string, unknown>)

  // ⚠️ 已扣款但未開通（金額不符/查無單/被掃成 expired…）→ 那張委託還活著會每月繼續扣,
  //    而且我方沒存下 periodTradeNo 誰都停不掉 → 必須主動終止止血。
  if (paid && !activated && periodTradeNo && periodCfg) {
    const t = await terminatePayuniPeriod(periodTradeNo, periodCfg)
    console.error('[payuni:period] 已扣款但未開通 → 終止委託止血', merchantOrderNo, periodTradeNo, t.ok ? 'terminated' : `FAILED 需人工退款`)
  }

  // 換方案：新委託開通成功 → **現在**才終止舊委託（放棄付款的客戶保住原訂閱）。
  const settledOk = settled.outcome === 'settled' || settled.outcome === 'already'
  const oldPeriodNo = settled.supersedesPeriodNo
  if (paid && settledOk && !settled.amountMismatch && oldPeriodNo && periodCfg) {
    const t = await terminatePayuniPeriod(oldPeriodNo, periodCfg)
    if (t.ok) console.log('[payuni:period] 換方案：已終止舊委託', oldPeriodNo)
    else console.error('[payuni:period] 換方案：終止舊委託失敗,恐重複扣款,需人工介入', oldPeriodNo, t.message)
  }

  if (activated) {
    await issueInvoiceForOrder({ merchantOrderNo, workspaceId: settled.workspaceId!, planId: settled.planId!, totalAmt: settled.amount! }, invoiceKeys)
    await sendReceiptNotification(merchantOrderNo)
  }

  return { status: 'ok' }
})
