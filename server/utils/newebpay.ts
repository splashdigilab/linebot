/**
 * 藍新金流 MPG（幕前支付）加解密工具。
 *
 * 只放「純函式」加解密／簽章邏輯——金鑰由呼叫端（建單 API / Notify webhook）
 * 從 server-only runtimeConfig 取出後傳入,方便單元測試、也避免金鑰散落。
 * 每個租戶各一組特店金鑰(見計費規劃 Phase 2)。
 *
 * 交易資料以 AES-256-CBC(PKCS7)加密成小寫 hex＝`TradeInfo`;
 * 檢查碼 `TradeSha` = SHA256("HashKey=xxx&<TradeInfo>&HashIV=xxx") 全大寫。
 *
 * ⚠️ 參數版本號／端點／回傳欄位以藍新最新技術文件為準;上線前務必對「測試特店」
 *    跑通一筆真實付款,確認位元組層級相容(本檔測試只驗自身往返與簽章格式)。
 */
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'crypto'

const ALGO = 'aes-256-cbc'

/** 藍新特店金鑰(每租戶各一組)。HashKey 須 32 碼、HashIV 須 16 碼。 */
export interface NewebpayKeys {
  hashKey: string
  hashIV: string
}

function assertKeys(keys: NewebpayKeys): void {
  const hkLen = Buffer.byteLength(String(keys.hashKey || ''))
  const ivLen = Buffer.byteLength(String(keys.hashIV || ''))
  if (hkLen !== 32) throw new Error(`[newebpay] HashKey 長度須為 32 碼(實際 ${hkLen})`)
  if (ivLen !== 16) throw new Error(`[newebpay] HashIV 長度須為 16 碼(實際 ${ivLen})`)
}

/** 參數物件 → 藍新要的 URL-encoded query string(application/x-www-form-urlencoded)。 */
export function encodeTradeParams(params: Record<string, string | number>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) sp.append(k, String(v))
  return sp.toString()
}

/** AES-256-CBC(PKCS7)加密 → 小寫 hex。 */
export function aesEncrypt(plain: string, keys: NewebpayKeys): string {
  assertKeys(keys)
  const cipher = createCipheriv(ALGO, Buffer.from(keys.hashKey), Buffer.from(keys.hashIV))
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex')
}

/**
 * AES-256-CBC 解密 → 原字串。
 * 先以標準 PKCS7 自動去墊嘗試;若藍新回傳的墊法讓自動去墊失敗,退回
 * 「關閉自動去墊 + 去除尾端控制字元」的容錯路徑。
 */
export function aesDecrypt(hex: string, keys: NewebpayKeys): string {
  assertKeys(keys)
  const raw = Buffer.from(String(hex || '').trim(), 'hex')
  try {
    const d = createDecipheriv(ALGO, Buffer.from(keys.hashKey), Buffer.from(keys.hashIV))
    return Buffer.concat([d.update(raw), d.final()]).toString('utf8')
  }
  catch {
    const d = createDecipheriv(ALGO, Buffer.from(keys.hashKey), Buffer.from(keys.hashIV))
    d.setAutoPadding(false)
    const out = Buffer.concat([d.update(raw), d.final()]).toString('utf8')
    // 去除尾端 PKCS7／null 墊位與控制字元,還原乾淨字串
    return out.replace(/[\x00-\x1f]+$/, '')
  }
}

/** 組 TradeInfo:參數 → query → AES 加密(小寫 hex)。 */
export function buildTradeInfo(params: Record<string, string | number>, keys: NewebpayKeys): string {
  return aesEncrypt(encodeTradeParams(params), keys)
}

/** 產生檢查碼 TradeSha(SHA256 大寫 hex)。 */
export function makeTradeSha(tradeInfo: string, keys: NewebpayKeys): string {
  const plain = `HashKey=${keys.hashKey}&${tradeInfo}&HashIV=${keys.hashIV}`
  return createHash('sha256').update(plain, 'utf8').digest('hex').toUpperCase()
}

/** 驗證 TradeSha 是否與 TradeInfo 相符(timing-safe,避免時序側錄)。 */
export function verifyTradeSha(tradeInfo: string, tradeSha: string, keys: NewebpayKeys): boolean {
  const expected = makeTradeSha(tradeInfo, keys)
  const got = String(tradeSha || '').trim().toUpperCase()
  if (got.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'))
  }
  catch {
    return false
  }
}

/**
 * 驗簽 + 解密 Notify 回傳。
 * 驗簽失敗一律回 null(呼叫端據此拒絕、不得開通);成功回解密後的原字串。
 */
export function verifyAndDecryptNotify(
  tradeInfo: string,
  tradeSha: string,
  keys: NewebpayKeys,
): string | null {
  if (!verifyTradeSha(tradeInfo, tradeSha, keys)) return null
  try {
    return aesDecrypt(tradeInfo, keys)
  }
  catch {
    return null
  }
}

/** 藍新 Notify 解密後的 JSON(RespondType=JSON)。僅列出開通會用到的欄位。 */
export interface NewebpayNotifyPayload {
  Status: string // 'SUCCESS' = 付款成功
  Message?: string
  Result?: {
    MerchantID?: string
    MerchantOrderNo?: string
    TradeNo?: string
    Amt?: number
    PaymentType?: string
    PayTime?: string
    [k: string]: unknown
  }
}

/** 解析 Notify 解密字串為 JSON;解析失敗或缺 Status 回 null。 */
export function parseNotifyResult(decrypted: string): NewebpayNotifyPayload | null {
  try {
    const obj = JSON.parse(decrypted) as NewebpayNotifyPayload
    if (!obj || typeof obj.Status !== 'string') return null
    return obj
  }
  catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════
//  定期定額（信用卡自動扣款委託，NPA-B05 / B051）
//
//  與 MPG 共用同一組特店金鑰與同一套 AES-256-CBC(PKCS7) hex 加密,但外層欄位不同:
//
//    MPG        → { MerchantID, TradeInfo, TradeSha, Version }
//    定期定額    → { MerchantID_, PostData_ }          ← **沒有 TradeSha**
//
//  ⚠️ 這代表 Notify **沒有簽章可驗**。唯一的驗證是「能用我方 HashKey/HashIV 解出
//     合法 JSON」+「Result.MerchantID 與我方特店代號相符」——攻擊者拿不到金鑰就
//     造不出能解密成合法 JSON 的密文。呼叫端**務必**檢查 MerchantID（見
//     assertPeriodMerchant）,否則等於沒驗。
// ═══════════════════════════════════════════════════════════════════

/** 組定期定額的 PostData_（與 TradeInfo 同一套加密，只是外層欄位名不同）。 */
export function buildPeriodPostData(params: Record<string, string | number>, keys: NewebpayKeys): string {
  return aesEncrypt(encodeTradeParams(params), keys)
}

/** 定期定額 Notify —「建立完成」的 Result（PeriodStartType=1/2 時才有授權相關欄位）。 */
export interface PeriodCreateResult {
  MerchantID?: string
  MerchantOrderNo?: string
  PeriodNo?: string
  PeriodType?: string
  PeriodAmt?: string | number
  AuthTimes?: number
  DateArray?: string
  TradeNo?: string
  AuthCode?: string
  RespondCode?: string
  AuthTime?: string
  CardNo?: string
  PaymentMethod?: string
  [k: string]: unknown
}

/** 定期定額 Notify —「每期授權完成」的 Result（NPA-N050）。 */
export interface PeriodAuthResult {
  MerchantID?: string
  MerchantOrderNo?: string
  /** 商店訂單編號_期數（例 NP2026...._2）；每期唯一 → 拿來當帳本的冪等鍵。 */
  OrderNo?: string
  PeriodNo?: string
  TradeNo?: string
  RespondCode?: string
  AuthDate?: string
  AuthAmt?: number | string
  AuthCode?: string
  TotalTimes?: string | number
  AlreadyTimes?: string | number
  NextAuthDate?: string
  [k: string]: unknown
}

export interface PeriodNotifyPayload {
  Status: string
  Message?: string
  Result?: PeriodCreateResult & PeriodAuthResult
}

/**
 * 解析定期定額 Notify（POST 欄位名為 `Period`）。
 * 解不開 / 不是合法 JSON / 缺 Status → null（呼叫端據此拒絕）。
 */
export function decryptPeriodNotify(periodHex: string, keys: NewebpayKeys): PeriodNotifyPayload | null {
  try {
    const obj = JSON.parse(aesDecrypt(periodHex, keys)) as PeriodNotifyPayload
    if (!obj || typeof obj.Status !== 'string') return null
    return obj
  }
  catch {
    return null
  }
}

/**
 * 這筆 Notify 是「每期授權」還是「委託建立」？
 * 每期授權（NPA-N050）獨有 AlreadyTimes；建立完成則帶 DateArray / AuthTimes。
 */
export function isPeriodRecurringNotify(result: PeriodNotifyPayload['Result']): boolean {
  return result?.AlreadyTimes != null
}
