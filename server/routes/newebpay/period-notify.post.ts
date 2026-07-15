import { decryptPeriodNotify, isPeriodRecurringNotify } from '~~/server/utils/newebpay'
import { periodConfigFrom, terminatePeriodMandate } from '~~/server/utils/newebpay-period'
import { settlePaidOrder, settleRecurringAuth } from '~~/server/utils/payment'
import { invoiceKeysFromConfig, issueInvoiceForOrder } from '~~/server/utils/invoice'

/**
 * POST /newebpay/period-notify — 藍新定期定額的幕後通知（開通與續期的唯一真相來源）。
 *
 * 同一個端點會收到兩種通知：
 *   ① **委託建立完成**：客戶第一次刷卡（PeriodStartType=2 → 當下就扣一期全額）
 *   ② **每期授權完成**（NPA-N050）：之後每個月藍新自動扣款後回拋
 * 用 AlreadyTimes 是否存在來分辨（見 isPeriodRecurringNotify）。
 *
 * ⚠️ **定期定額沒有 TradeSha,沒有簽章可驗。** 唯一的身分驗證是：
 *      (a) 能用我方 HashKey/HashIV 解出合法 JSON —— 攻擊者沒金鑰就造不出來
 *      (b) Result.MerchantID 與我方特店代號相符
 *    兩者缺一不可,少了 (b) 等於誰都能拿別家特店的通知來灌我們的帳。
 *
 * 藍新會重送直到收 200,故務必冪等且盡量回 200。開發票失敗**絕不能**讓這裡回非 200
 * （會導致重複結算）——所以開票包在 issueInvoiceForOrder 裡自己吞例外。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const merchantId = String(config.newebpayMerchantId || '').trim()
  const keys = { hashKey: String(config.newebpayHashKey || ''), hashIV: String(config.newebpayHashIV || '') }
  if (!keys.hashKey || !keys.hashIV || !merchantId) {
    console.error('[newebpay:period] 金流金鑰未設定,無法驗證')
    throw createError({ statusCode: 500, statusMessage: 'gateway not configured' })
  }

  const body = await readBody(event)
  const periodHex = String(body?.Period || body?.period || '')
  if (!periodHex) throw createError({ statusCode: 400, statusMessage: 'missing Period' })

  const payload = decryptPeriodNotify(periodHex, keys)
  if (!payload) {
    console.warn('[newebpay:period] 解密／解析失敗,拒絕')
    throw createError({ statusCode: 400, statusMessage: 'invalid payload' })
  }

  const r = payload.Result
  // 沒有簽章可驗 → 特店代號比對是唯一的身分驗證，不能省
  if (String(r?.MerchantID || '') !== merchantId) {
    console.warn('[newebpay:period] 特店代號不符,拒絕', r?.MerchantID)
    throw createError({ statusCode: 400, statusMessage: 'merchant mismatch' })
  }

  const merchantOrderNo = String(r?.MerchantOrderNo || '').trim()
  if (!merchantOrderNo) {
    console.warn('[newebpay:period] 缺 MerchantOrderNo,略過')
    return { status: 'ok' } // 無法對應訂單 → 回 200 停止重送
  }

  const paid = payload.Status === 'SUCCESS'
  const periodNo = r?.PeriodNo != null ? String(r.PeriodNo) : null
  const now = new Date()
  const invoiceKeys = invoiceKeysFromConfig(config as unknown as Record<string, unknown>)

  // ── ② 每期授權（第 2 期以後）──────────────────────────────
  if (isPeriodRecurringNotify(r)) {
    const times = Number(r?.AlreadyTimes)
    const amt = Number(r?.AuthAmt)
    const settled = await settleRecurringAuth({
      merchantOrderNo,
      // OrderNo = `原單號_期數`，每期唯一 → 帳本的冪等鍵。藍新沒給就自行組出。
      ledgerOrderNo: String(r?.OrderNo || `${merchantOrderNo}_${Number.isFinite(times) ? times : Date.now()}`),
      paid,
      periodNo,
      tradeNo: r?.TradeNo != null ? String(r.TradeNo) : null,
      amount: Number.isFinite(amt) ? amt : undefined,
      periodTimes: Number.isFinite(times) ? times : null,
      now,
      notifyRaw: {
        Status: payload.Status,
        MerchantOrderNo: merchantOrderNo,
        OrderNo: r?.OrderNo ?? null,
        AuthAmt: r?.AuthAmt ?? null,
        AuthDate: r?.AuthDate ?? null,
        AlreadyTimes: r?.AlreadyTimes ?? null,
        NextAuthDate: r?.NextAuthDate ?? null,
        PeriodNo: periodNo,
        RespondCode: r?.RespondCode ?? null,
      },
    })

    console.log('[newebpay:period] 續期', merchantOrderNo, `第 ${times} 期`, settled.outcome)

    if (settled.outcome === 'renewed' && settled.workspaceId && settled.ledgerOrderNo) {
      await issueInvoiceForOrder({
        merchantOrderNo: settled.ledgerOrderNo,
        workspaceId: settled.workspaceId,
        planId: settled.planId!,
        totalAmt: settled.amount!,
      }, invoiceKeys)
    }
    return { status: 'ok' }
  }

  // ── ① 委託建立完成（首期）────────────────────────────────
  // PeriodStartType=2 → 當下就扣了一期全額；金額欄位是 PeriodAmt
  const periodAmt = Number(r?.PeriodAmt)
  const settled = await settlePaidOrder({
    merchantOrderNo,
    paid,
    amount: Number.isFinite(periodAmt) ? periodAmt : undefined,
    periodNo,
    tradeNo: r?.TradeNo != null ? String(r.TradeNo) : null,
    paymentType: 'CREDIT',
    now,
    notifyRaw: {
      Status: payload.Status,
      MerchantOrderNo: merchantOrderNo,
      PeriodNo: periodNo,
      PeriodAmt: r?.PeriodAmt ?? null,
      AuthTimes: r?.AuthTimes ?? null,
      DateArray: r?.DateArray ?? null,
      TradeNo: r?.TradeNo ?? null,
      AuthTime: r?.AuthTime ?? null,
      RespondCode: r?.RespondCode ?? null,
    },
  })

  if (settled.outcome === 'unknown') console.warn('[newebpay:period] 查無訂單', merchantOrderNo)
  else if (settled.amountMismatch) console.error('[newebpay:period] 金額不符,已標記失敗', merchantOrderNo)
  else console.log('[newebpay:period] 委託建立', merchantOrderNo, paid ? 'paid' : 'failed', settled.outcome)

  const activated = paid && settled.outcome === 'settled' && !settled.amountMismatch && settled.workspaceId

  // ⚠️ 藍新已經扣款成功（PeriodStartType=2 是當場扣一期全額），我方卻沒開通
  //    （金額不符、訂單被對帳掃成 expired、查無此單…）→ **那張委託還活著,會每個月
  //    繼續扣客戶的卡,而且我方沒存下 periodNo,誰都停不掉它。**
  //    必須主動終止,這是唯一能止血的地方。
  if (paid && !activated && periodNo) {
    const periodCfg = periodConfigFrom(config as unknown as Record<string, unknown>)
    if (periodCfg) {
      const t = await terminatePeriodMandate(merchantOrderNo, periodNo, periodCfg)
      console.error(
        '[newebpay:period] 已扣款但未開通 → 終止委託止血',
        merchantOrderNo, periodNo, t.ok ? 'terminated' : `FAILED(${t.code}) 需人工介入退款`,
      )
    }
    else {
      console.error('[newebpay:period] 已扣款但未開通,且無法終止委託（設定缺失）', merchantOrderNo, periodNo)
    }
  }

  // ⚠️ 換方案：新委託開通成功了 → **現在**才終止舊委託。
  //    在這裡（而非建單時）終止,是為了讓「放棄付款」的客戶保住原本的訂閱：沒付款就
  //    不會走到這裡,舊委託原封不動。terminatePeriodMandate 冪等,重送 Notify 再跑也安全。
  //    也在 outcome='already'（redelivery）時嘗試——涵蓋「首次開通成功、但終止失敗」的補救,
  //    因為那時舊委託單號已被新訂閱覆蓋、reconcile 也救不了,只剩重送這條路。
  const settledOk = settled.outcome === 'settled' || settled.outcome === 'already'
  const oldPeriodNo = settled.supersedesPeriodNo
  const oldPeriodOrderNo = settled.supersedesPeriodOrderNo
  if (paid && settledOk && !settled.amountMismatch && oldPeriodNo && oldPeriodOrderNo) {
    const periodCfg = periodConfigFrom(config as unknown as Record<string, unknown>)
    if (periodCfg) {
      const t = await terminatePeriodMandate(oldPeriodOrderNo, oldPeriodNo, periodCfg)
      if (t.ok) {
        console.log('[newebpay:period] 換方案：已終止舊委託', oldPeriodNo, t.alreadyGone ? '(本來就已終止)' : '')
      }
      else {
        // 舊委託停不掉 = 客戶這個月會被新舊兩張委託都扣。無法在通知流程內解決,
        // 記成 error 讓維運介入手動終止 / 退款。
        console.error('[newebpay:period] 換方案：終止舊委託失敗,恐重複扣款,需人工介入',
          settled.workspaceId, oldPeriodNo, t.code, t.message)
      }
    }
    else {
      console.error('[newebpay:period] 換方案：無法終止舊委託（設定缺失）', oldPeriodNo)
    }
  }

  if (activated) {
    await issueInvoiceForOrder({
      merchantOrderNo,
      workspaceId: settled.workspaceId!,
      planId: settled.planId!,
      totalAmt: settled.amount!,
    }, invoiceKeys)
  }

  return { status: 'ok' }
})
