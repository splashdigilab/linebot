/**
 * 藍新定期定額「委託」的 server→server 操作（終止／暫停／啟用，NPA-B051）。
 *
 * ⚠️ **委託是會持續扣客戶信用卡的東西。** 只要我方任何一條路徑「不再認得」某張委託
 *    （降級、換方案、開通失敗…）,那張委託在藍新那邊還是活的,還是會每個月扣錢。
 *    所以凡是「這個帳號不該再被扣款」的時刻,都必須呼叫 terminatePeriodMandate,
 *    而不是只在自己的資料庫把旗標關掉。
 *
 * ⚠️ AlterStatus 是**申請制**——要先向藍新申請開通這支 API 才會通。
 */
import { aesDecrypt, buildPeriodPostData, type NewebpayKeys } from './newebpay'

/** 「已經是終止狀態」與「查無委託」→ 目的已達成，視為成功（讓終止可以安全重試）。 */
const ALREADY_GONE_CODES = new Set(['PER10065', 'PER10067'])

export interface PeriodMandateConfig extends NewebpayKeys {
  merchantId: string
  alterUrl: string
}

export interface TerminateResult {
  /** 委託確定不會再扣款（含「本來就已終止」）。 */
  ok: boolean
  /** 本來就已經終止／查無此委託（冪等重試時會走到）。 */
  alreadyGone: boolean
  code?: string
  message?: string
}

/**
 * 終止一張定期定額委託（之後不再自動扣款）。
 *
 * 冪等：委託早就終止（PER10065）或查無此委託（PER10067）也回 ok——重複呼叫是安全的,
 * 這很重要,因為「終止成功但我方寫入失敗」時使用者一定會再按一次。
 */
export async function terminatePeriodMandate(
  merOrderNo: string,
  periodNo: string,
  config: PeriodMandateConfig,
): Promise<TerminateResult> {
  const params: Record<string, string | number> = {
    RespondType: 'JSON',
    Version: '1.0',
    TimeStamp: Math.floor(Date.now() / 1000),
    MerOrderNo: merOrderNo,
    PeriodNo: periodNo,
    AlterType: 'terminate',
  }

  // 用原生 fetch 而非 $fetch：$fetch 對「外部絕對網址」會去套 Nuxt 的 typed-route 推導，
  // 型別檢查會直接堆疊爆炸（TS2321）。
  let raw: string
  try {
    const res = await fetch(config.alterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MerchantID_: config.merchantId,
        PostData_: buildPeriodPostData(params, config),
      }).toString(),
    })
    if (!res.ok) {
      console.error('[newebpay:period] AlterStatus HTTP', res.status, merOrderNo)
      return { ok: false, alreadyGone: false, message: `金流回應 ${res.status}` }
    }
    raw = await res.text()
  }
  catch (e) {
    console.error('[newebpay:period] AlterStatus 連線失敗', merOrderNo, e)
    return { ok: false, alreadyGone: false, message: '無法連線到金流' }
  }

  // 回應欄位是小寫 period（與建立委託的大寫 Period 不同）；可能是 JSON 也可能是裸字串
  let hex = raw.trim()
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    hex = String(obj.period ?? obj.Period ?? '').trim()
  }
  catch { /* 不是 JSON → 當作裸的密文字串 */ }

  try {
    const parsed = JSON.parse(aesDecrypt(hex, config)) as { Status?: string; Message?: string }
    const code = String(parsed?.Status || '')
    if (code === 'SUCCESS') return { ok: true, alreadyGone: false, code }
    if (ALREADY_GONE_CODES.has(code)) {
      return { ok: true, alreadyGone: true, code, message: String(parsed?.Message || '') }
    }
    return { ok: false, alreadyGone: false, code, message: String(parsed?.Message || '') }
  }
  catch (e) {
    console.error('[newebpay:period] AlterStatus 回應無法解析', merOrderNo, e)
    return { ok: false, alreadyGone: false, message: '金流回應無法解析' }
  }
}

/** 從 runtimeConfig 取出定期定額所需設定；未設定完整回 null。 */
export function periodConfigFrom(config: Record<string, unknown>): PeriodMandateConfig | null {
  const c = {
    merchantId: String(config.newebpayMerchantId || '').trim(),
    hashKey: String(config.newebpayHashKey || '').trim(),
    hashIV: String(config.newebpayHashIV || '').trim(),
    alterUrl: String(config.newebpayPeriodAlterUrl || '').trim(),
  }
  return c.merchantId && c.hashKey && c.hashIV && c.alterUrl ? c : null
}
