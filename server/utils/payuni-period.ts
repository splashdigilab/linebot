/**
 * PAYUNi 續期收款「狀態修改」server→server 操作（暫停/啟用/**終止**委託）。
 *
 * ⚠️ **委託是會持續扣客戶信用卡的東西。** 只要我方任何一條路徑「不再認得」某張委託
 *    （降級、換方案、開通失敗…）,那張委託在 PAYUNi 那邊還是活的,還會繼續扣錢。所以凡是
 *    「這個帳號不該再被扣款」的時刻,都必須呼叫 terminatePayuniPeriod,而不是只關自己的旗標。
 *
 * 端點 /api/period/mdfStatus；ReviseTradeStatus=end 終止整筆委託。與建單同一套 GCM 加密。
 */
import { PAYUNI_PERIOD_MDF_ENDPOINTS, buildUppForm, resolvePayuniEnv, verifyAndDecryptPayuniNotify, type PayuniKeys } from './payuni'

export interface PayuniPeriodConfig {
  merchantId: string
  keys: PayuniKeys
  env: 'test' | 'prod'
}

/** 「已終止 / 查無此委託」→ 目的已達成,視為成功（讓終止/取消可以安全重試）。 */
const ALREADY_GONE_CODES = new Set(['PMDF02013', 'PMDF02018'])

export interface PayuniTerminateResult {
  /** 委託確定不會再扣款（含「本來就已終止」）。 */
  ok: boolean
  /** 本來就已終止／查無此委託（冪等重試時會走到）。 */
  alreadyGone: boolean
  code?: string
  message?: string
}

/**
 * 終止一張續期委託（之後不再自動扣款）。
 * 冪等：委託早就終止（PMDF02013）或查無此委託（PMDF02018）也回 ok——「終止成功但我方寫入失敗」
 * 時使用者再按一次取消就會修好,不會卡在假失敗而卡片繼續被扣。
 */
export async function terminatePayuniPeriod(
  periodTradeNo: string,
  config: PayuniPeriodConfig,
): Promise<PayuniTerminateResult> {
  const url = PAYUNI_PERIOD_MDF_ENDPOINTS[config.env]
  const fields = buildUppForm(
    { MerID: config.merchantId, ReviseTradeStatus: 'end', PeriodTradeNo: periodTradeNo },
    config.keys,
  )
  // 用原生 fetch（$fetch 對外部絕對網址會套 Nuxt typed-route 推導導致型別爆炸）
  let raw: string
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'user-agent': 'payuni' },
      body: new URLSearchParams({
        MerID: fields.MerID,
        Version: fields.Version,
        EncryptInfo: fields.EncryptInfo,
        HashInfo: fields.HashInfo,
      }).toString(),
    })
    if (!res.ok) {
      console.error('[payuni:period] mdfStatus HTTP', res.status, periodTradeNo)
      return { ok: false, alreadyGone: false, message: `金流回應 ${res.status}` }
    }
    raw = await res.text()
  }
  catch (e) {
    console.error('[payuni:period] mdfStatus 連線失敗', periodTradeNo, e)
    return { ok: false, alreadyGone: false, message: '無法連線到金流' }
  }

  let resp: Record<string, string>
  try { resp = JSON.parse(raw) }
  catch { console.error('[payuni:period] mdfStatus 回應非 JSON', periodTradeNo); return { ok: false, alreadyGone: false, message: '金流回應無法解析' } }

  const outerStatus = String(resp?.Status || '').toUpperCase()
  // 委託本來就已終止／查無此委託 → 目的已達成,回 ok（冪等重試安全）
  if (ALREADY_GONE_CODES.has(outerStatus)) return { ok: true, alreadyGone: true, code: outerStatus }
  if (outerStatus !== 'SUCCESS') {
    return { ok: false, alreadyGone: false, code: outerStatus, message: '狀態修改失敗' }
  }
  const enc = String(resp?.EncryptInfo || '')
  const hash = String(resp?.HashInfo || '')
  const result = enc && hash ? verifyAndDecryptPayuniNotify(enc, hash, config.keys) : null
  if (String(result?.Status ?? '').toUpperCase() === 'SUCCESS') return { ok: true, alreadyGone: false, code: 'SUCCESS' }
  return { ok: false, alreadyGone: false, code: String(result?.Status ?? ''), message: String(result?.Message ?? '狀態修改未成功') }
}

/** 從 runtimeConfig 取出續期狀態修改所需設定；未設定完整回 null。 */
export function payuniPeriodConfigFrom(config: Record<string, unknown>): PayuniPeriodConfig | null {
  const merchantId = String(config.payuniMerchantId || '').trim()
  const keys: PayuniKeys = { merKey: String(config.payuniHashKey || '').trim(), merIV: String(config.payuniHashIV || '').trim() }
  if (!merchantId || !keys.merKey || !keys.merIV) return null
  return { merchantId, keys, env: resolvePayuniEnv(config.payuniEnv) }
}
