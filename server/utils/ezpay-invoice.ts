/**
 * ezPay 電子發票（藍新集團的發票加值平台）加解密與開立工具。
 *
 * ⚠️ **這是一組獨立於金流的商店帳號**：ezPay 電子發票有自己的 MerchantID / HashKey /
 *    HashIV,跟藍新金流（MPG / 定期定額）那組**不同**,要另外申請。未設定時整個開立
 *    流程會靜默跳過（見 isInvoiceConfigured）,不影響收款。
 *
 * ⚠️ **加密方式與金流不同,這是最容易踩的雷**：
 *      金流 MPG      → AES-256-CBC + 標準 PKCS7（區塊 16 bytes,Node 預設）
 *      ezPay 電子發票 → AES-256-CBC + **手動補到 32 bytes 的 PKCS7**,再關掉自動補位
 *    （官方 PHP 範例是 `addpadding($str, 32)` + `OPENSSL_ZERO_PADDING`）。
 *    直接沿用金流那組 aesEncrypt 會被 ezPay 判為參數錯誤。
 *
 * 回傳的 CheckCode 可驗證回應確實來自 ezPay（見 verifyInvoiceCheckCode）。
 */
import { createCipheriv, createHash, timingSafeEqual } from 'crypto'
import { splitTax, TAX_RATE_PERCENT } from '~~/shared/billing/tax'
import type { InvoiceProfile } from '~~/shared/types/organization'

const ALGO = 'aes-256-cbc'

/** ezPay 電子發票平台的商店金鑰（與金流那組不同，需另外申請）。 */
export interface EzpayInvoiceKeys {
  merchantId: string
  hashKey: string
  hashIV: string
  /** 測試 https://cinv.ezpay.com.tw／正式 https://inv.ezpay.com.tw */
  apiUrl: string
}

/** 三把金鑰與網址都設好才算開通；未開通 → 不開發票（但不擋收款）。 */
export function isInvoiceConfigured(keys: Partial<EzpayInvoiceKeys> | null | undefined): keys is EzpayInvoiceKeys {
  return Boolean(keys?.merchantId && keys?.hashKey && keys?.hashIV && keys?.apiUrl)
}

/**
 * ezPay 的補位：PKCS7 但區塊是 **32 bytes**（官方範例 addpadding($s, 32)）。
 * 長度剛好整除時仍補滿一整塊 32 bytes——這是 PKCS7 的規定,少補會被判參數錯誤。
 */
function padTo32(plain: string): Buffer {
  const buf = Buffer.from(plain, 'utf8')
  const pad = 32 - (buf.length % 32)
  return Buffer.concat([buf, Buffer.alloc(pad, pad)])
}

/** 參數物件 → URL-encoded query string（與 PHP http_build_query 對齊）。 */
function encodeParams(params: Record<string, string | number>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v == null) continue // 空值不送,避免 ezPay 把空字串當有效值檢核
    sp.append(k, String(v))
  }
  return sp.toString()
}

/** 組 PostData_：參數 → query → AES-256-CBC（32 bytes 補位、關自動補位）→ 小寫 hex。 */
export function buildInvoicePostData(params: Record<string, string | number>, keys: EzpayInvoiceKeys): string {
  const hkLen = Buffer.byteLength(keys.hashKey)
  const ivLen = Buffer.byteLength(keys.hashIV)
  if (hkLen !== 32) throw new Error(`[ezpay] HashKey 長度須為 32 碼(實際 ${hkLen})`)
  if (ivLen !== 16) throw new Error(`[ezpay] HashIV 長度須為 16 碼(實際 ${ivLen})`)

  const cipher = createCipheriv(ALGO, Buffer.from(keys.hashKey), Buffer.from(keys.hashIV))
  cipher.setAutoPadding(false) // 已手動補到 32 bytes
  const body = padTo32(encodeParams(params))
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('hex')
}

/**
 * 驗證 ezPay 回應的 CheckCode（附件二）。
 *
 * 五個欄位依 A~Z 排序串成 query,前後夾 HashIV / HashKey,SHA256 轉大寫。
 * 驗證通過才代表這份回應真的來自 ezPay(而不是被中間人竄改的發票號碼)。
 */
export function makeInvoiceCheckCode(
  fields: { MerchantID: string; MerchantOrderNo: string; InvoiceTransNo: string; TotalAmt: string | number; RandomNum: string },
  keys: Pick<EzpayInvoiceKeys, 'hashKey' | 'hashIV'>,
): string {
  // A~Z 排序：InvoiceTransNo, MerchantID, MerchantOrderNo, RandomNum, TotalAmt
  const sorted = encodeParams({
    InvoiceTransNo: fields.InvoiceTransNo,
    MerchantID: fields.MerchantID,
    MerchantOrderNo: fields.MerchantOrderNo,
    RandomNum: fields.RandomNum,
    TotalAmt: fields.TotalAmt,
  })
  const plain = `HashIV=${keys.hashIV}&${sorted}&HashKey=${keys.hashKey}`
  return createHash('sha256').update(plain, 'utf8').digest('hex').toUpperCase()
}

export function verifyInvoiceCheckCode(
  fields: Parameters<typeof makeInvoiceCheckCode>[0],
  checkCode: string,
  keys: Pick<EzpayInvoiceKeys, 'hashKey' | 'hashIV'>,
): boolean {
  const expected = makeInvoiceCheckCode(fields, keys)
  const got = String(checkCode || '').trim().toUpperCase()
  if (got.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'))
  }
  catch {
    return false
  }
}

// ── 開立發票 ────────────────────────────────────────────────────────

export interface IssueInvoiceInput {
  merchantOrderNo: string
  /** 含稅總額 = 實際請款金額 */
  totalAmt: number
  itemName: string
  profile: InvoiceProfile
  /** B2C 未填抬頭時的預設買受人名稱（用帳號名稱）。 */
  fallbackBuyerName: string
}

export interface IssueInvoiceResult {
  ok: boolean
  status: string
  message: string
  invoiceNumber?: string
  invoiceTransNo?: string
  randomNum?: string
  createTime?: string
  /** CheckCode 驗證是否通過（false = 回應可疑，仍記錄但標記） */
  checkCodeValid?: boolean
}

/**
 * 組開立發票的 PostData_ 參數。
 *
 * 稅務：方案價是**含稅**價（見 shared/billing/tax.ts）,所以 TotalAmt 就是刷卡金額,
 * 銷售額與稅額由它反推,三者保證相加相等（ezPay 與財政部都會檢核）。
 *
 * B2B（有統編）一律 PrintFlag=Y——公司要報帳,不能只給載具。
 * B2C 三選一：載具 / 捐贈 / 紙本;都沒填就開紙本（PrintFlag=Y 是 ezPay 的硬性要求）。
 */
export function buildIssueInvoiceParams(input: IssueInvoiceInput): Record<string, string | number> {
  const { totalAmt, amt, taxAmt } = splitTax(input.totalAmt)
  const p = input.profile
  const ubn = String(p.buyerUBN || '').trim()
  const isB2B = /^\d{8}$/.test(ubn)

  const params: Record<string, string | number> = {
    RespondType: 'JSON',
    Version: '1.5',
    TimeStamp: Math.floor(Date.now() / 1000),
    MerchantOrderNo: input.merchantOrderNo,
    Status: '1', // 即時開立
    Category: isB2B ? 'B2B' : 'B2C',
    BuyerName: String(p.buyerName || '').trim() || input.fallbackBuyerName,
    TaxType: '1', // 應稅
    TaxRate: TAX_RATE_PERCENT,
    Amt: amt,
    TaxAmt: taxAmt,
    TotalAmt: totalAmt,
    ItemName: input.itemName,
    ItemCount: 1,
    ItemUnit: '式',
    // B2B 的單價/小計為未稅、B2C 為含稅（ezPay 規定）
    ItemPrice: isB2B ? amt : totalAmt,
    ItemAmt: isB2B ? amt : totalAmt,
  }

  const email = String(p.buyerEmail || '').trim()
  if (email) params.BuyerEmail = email

  if (isB2B) {
    params.BuyerUBN = ubn
    params.PrintFlag = 'Y' // 公司報帳一定要能列印
    return params
  }

  // ── B2C：載具 / 捐贈 / 紙本，三者互斥 ──
  const carrier = String(p.carrierNum || '').trim().toUpperCase()
  const love = String(p.loveCode || '').trim()
  if (carrier) {
    params.CarrierType = '0' // 手機條碼載具
    params.CarrierNum = carrier
    params.PrintFlag = 'N'
  }
  else if (love) {
    params.LoveCode = love
    params.PrintFlag = 'N'
  }
  else {
    params.PrintFlag = 'Y' // 沒載具沒捐贈 → ezPay 強制須索取紙本
  }
  return params
}

/** 手機條碼載具格式：/ + 7 碼（大寫英數與 + - .）。 */
export function isValidCarrierNum(v: string): boolean {
  return /^\/[0-9A-Z+\-.]{7}$/.test(String(v || '').trim().toUpperCase())
}

/** 捐贈碼：3–7 碼純數字。 */
export function isValidLoveCode(v: string): boolean {
  return /^\d{3,7}$/.test(String(v || '').trim())
}

/** 統一編號：8 碼純數字。 */
export function isValidUBN(v: string): boolean {
  return /^\d{8}$/.test(String(v || '').trim())
}

/**
 * 驗證並正規化使用者填的發票資訊。組織層與 OA 層共用同一份規則。
 *
 * 在**存檔時**就擋掉格式錯誤,而不是等 ezPay 退件——發票是在「付款成功之後」才開的,
 * 那時客戶早就離開頁面了,退件他不會知道,只會過幾天發現沒收到發票。
 *
 * 格式不合直接丟 createError（呼叫端是 API handler）。
 */
export function normalizeInvoiceProfile(body: Record<string, unknown> | null | undefined): InvoiceProfile {
  const ubn = String(body?.buyerUBN || '').trim()
  const buyerName = String(body?.buyerName || '').trim()
  const buyerEmail = String(body?.buyerEmail || '').trim()
  const carrierNum = String(body?.carrierNum || '').trim().toUpperCase()
  const loveCode = String(body?.loveCode || '').trim()

  if (ubn && !isValidUBN(ubn)) {
    throw createError({ statusCode: 400, statusMessage: '統一編號需為 8 碼數字' })
  }
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw createError({ statusCode: 400, statusMessage: 'Email 格式不正確' })
  }

  const profile: InvoiceProfile = {
    buyerUBN: ubn || null,
    buyerName: buyerName || null,
    buyerEmail: buyerEmail || null,
    carrierNum: null,
    loveCode: null,
  }

  if (ubn) {
    // B2B：公司報帳一律開可列印的發票，載具／捐贈碼不適用（帶了 ezPay 也會退）
    if (!buyerName) {
      throw createError({ statusCode: 400, statusMessage: '有統一編號時必須填公司抬頭' })
    }
    return profile
  }

  if (carrierNum && loveCode) {
    throw createError({ statusCode: 400, statusMessage: '載具與捐贈碼只能擇一' })
  }
  if (carrierNum && !isValidCarrierNum(carrierNum)) {
    throw createError({ statusCode: 400, statusMessage: '手機條碼載具格式錯誤（斜線 + 7 碼大寫英數）' })
  }
  if (loveCode && !isValidLoveCode(loveCode)) {
    throw createError({ statusCode: 400, statusMessage: '捐贈碼需為 3–7 碼數字' })
  }
  profile.carrierNum = carrierNum || null
  profile.loveCode = loveCode || null
  return profile
}

/**
 * 呼叫 ezPay 開立發票（server→server）。
 * 網路錯誤 / 平台回錯一律回 ok:false,由呼叫端記錄——**開票失敗絕不能回頭影響收款**。
 */
export async function issueInvoice(
  input: IssueInvoiceInput,
  keys: EzpayInvoiceKeys,
): Promise<IssueInvoiceResult> {
  const params = buildIssueInvoiceParams(input)
  const postData = buildInvoicePostData(params, keys)

  const body = new URLSearchParams({ MerchantID_: keys.merchantId, PostData_: postData })
  const res = await fetch(`${keys.apiUrl.replace(/\/$/, '')}/Api/invoice_issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    return { ok: false, status: `HTTP_${res.status}`, message: `ezPay 回應 ${res.status}` }
  }

  const raw = await res.json() as { Status?: string; Message?: string; Result?: string | Record<string, unknown> }
  const status = String(raw?.Status || '')
  const message = String(raw?.Message || '')
  if (status !== 'SUCCESS') return { ok: false, status: status || 'UNKNOWN', message }

  // Result 是 JSON 字串（RespondType=JSON 時 ezPay 回的是字串化的物件）
  let result: Record<string, unknown> = {}
  try {
    result = typeof raw.Result === 'string' ? JSON.parse(raw.Result) : (raw.Result ?? {})
  }
  catch {
    return { ok: false, status: 'BAD_RESULT', message: '無法解析 ezPay 回應內容' }
  }

  const invoiceTransNo = String(result.InvoiceTransNo ?? '')
  const randomNum = String(result.RandomNum ?? '')
  const totalAmt = String(result.TotalAmt ?? '')
  const checkCodeValid = verifyInvoiceCheckCode(
    {
      MerchantID: String(result.MerchantID ?? ''),
      MerchantOrderNo: String(result.MerchantOrderNo ?? ''),
      InvoiceTransNo: invoiceTransNo,
      TotalAmt: totalAmt,
      RandomNum: randomNum,
    },
    String(result.CheckCode ?? ''),
    keys,
  )

  return {
    ok: true,
    status,
    message,
    invoiceNumber: result.InvoiceNumber != null ? String(result.InvoiceNumber) : undefined,
    invoiceTransNo,
    randomNum,
    createTime: result.CreateTime != null ? String(result.CreateTime) : undefined,
    checkCodeValid,
  }
}
