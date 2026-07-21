/**
 * PAYUNi 統一金流 加解密／簽章工具（整合式支付頁 UPP＝幕前支付）。
 *
 * 與 newebpay.ts 平行：只放「純函式」加解密／簽章邏輯——金鑰由呼叫端（建單 API /
 * Notify webhook）從 server-only runtimeConfig 取出後傳入,方便單元測試、也避免金鑰散落。
 * 每個租戶各一組特店金鑰。
 *
 * ── 協定（照 PAYUNi 官方 PHP SDK src/PayuniApi.php 逐位元對齊）──────────────
 *   加密演算法：AES-256-**GCM**（藍新是 CBC,兩者不相容）
 *   明文       ：encryptInfo 參數以 application/x-www-form-urlencoded 串成 query
 *   EncryptInfo：hex( base64(密文) + ":::" + base64(GCM authTag) )
 *                ↑ PHP openssl_encrypt(options=0) 會先 base64 密文,tag 另外 base64,
 *                  中間用字面 ":::" 串接,最後整段 bin2hex。
 *   HashInfo   ：SHA256( merKey + EncryptInfo + merIV ) 全大寫 hex
 *   外層 POST  ：{ MerID, Version, EncryptInfo, HashInfo }（回傳同樣這幾個欄位）
 *
 * ⚠️ 端點／版本號／回傳欄位以 PAYUNi 最新技術文件為準;上線前務必對「測試特店」
 *    (sandbox-api.payuni.com.tw) 跑通一筆真實付款,確認位元組層級相容
 *    (本檔測試只驗自身往返與簽章格式)。
 */
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'crypto'

const ALGO = 'aes-256-gcm'

/** PAYUNi UPP 端點（測試特店掛 sandbox- 前綴）。 */
export const PAYUNI_ENDPOINTS = {
  test: 'https://sandbox-api.payuni.com.tw/api/upp',
  prod: 'https://api.payuni.com.tw/api/upp',
} as const

/** PAYUNi 特店金鑰(每租戶各一組)。Hash Key 須 32 碼、IV Key 須 16 碼。 */
export interface PayuniKeys {
  /** 商店 Hash Key（AES-256 金鑰，32 bytes） */
  merKey: string
  /** 商店 IV Key（GCM nonce，16 bytes） */
  merIV: string
}

function assertKeys(keys: PayuniKeys): void {
  const keyLen = Buffer.byteLength(String(keys.merKey || ''))
  const ivLen = Buffer.byteLength(String(keys.merIV || ''))
  if (keyLen !== 32) throw new Error(`[payuni] Hash Key 長度須為 32 碼(實際 ${keyLen})`)
  if (ivLen !== 16) throw new Error(`[payuni] IV Key 長度須為 16 碼(實際 ${ivLen})`)
}

/** 參數物件 → PAYUNi 要的 URL-encoded query string（對齊 PHP http_build_query）。 */
export function encodeEncryptInfo(params: Record<string, string | number>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) sp.append(k, String(v))
  return sp.toString()
}

/**
 * AES-256-GCM 加密 → EncryptInfo。
 * 完全複刻 PHP：bin2hex( base64(ciphertext) . ':::' . base64(tag) )。
 */
export function encrypt(params: Record<string, string | number>, keys: PayuniKeys): string {
  assertKeys(keys)
  const cipher = createCipheriv(ALGO, Buffer.from(keys.merKey), Buffer.from(keys.merIV))
  const ct = Buffer.concat([cipher.update(encodeEncryptInfo(params), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const combined = `${ct.toString('base64')}:::${tag.toString('base64')}`
  return Buffer.from(combined, 'utf8').toString('hex')
}

/**
 * 解密 EncryptInfo → 參數物件。解不開（金鑰錯／tag 驗證失敗／格式壞）會 throw,
 * 呼叫端請包 try/catch 並於失敗時拒絕開通。
 */
export function decrypt(encryptStr: string, keys: PayuniKeys): Record<string, string> {
  assertKeys(keys)
  const combined = Buffer.from(String(encryptStr || '').trim(), 'hex').toString('utf8')
  const sep = combined.indexOf(':::')
  if (sep < 0) throw new Error('[payuni] EncryptInfo 格式錯誤(缺少 ::: 分隔)')
  const ct = Buffer.from(combined.slice(0, sep), 'base64')
  const tag = Buffer.from(combined.slice(sep + 3), 'base64')
  const decipher = createDecipheriv(ALGO, Buffer.from(keys.merKey), Buffer.from(keys.merIV))
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  return Object.fromEntries(new URLSearchParams(plain))
}

/** 產生檢查碼 HashInfo：SHA256(merKey + EncryptInfo + merIV) 全大寫 hex。 */
export function makeHashInfo(encryptStr: string, keys: PayuniKeys): string {
  return createHash('sha256').update(`${keys.merKey}${encryptStr}${keys.merIV}`, 'utf8').digest('hex').toUpperCase()
}

/** 驗證 HashInfo 是否與 EncryptInfo 相符(timing-safe,避免時序側錄)。 */
export function verifyHashInfo(encryptStr: string, hashInfo: string, keys: PayuniKeys): boolean {
  const expected = makeHashInfo(encryptStr, keys)
  const got = String(hashInfo || '').trim().toUpperCase()
  if (got.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'))
  }
  catch {
    return false
  }
}

/** 整合式支付頁（UPP）自動送出表單所需的四個 POST 欄位。 */
export interface PayuniUppForm {
  MerID: string
  Version: string
  EncryptInfo: string
  HashInfo: string
}

/**
 * 組整合式支付頁（UPP）的表單欄位。
 * encryptInfo 至少要有 MerID／MerTradeNo／TradeAmt／Timestamp（PAYUNi 必填）;
 * 通常再帶 ReturnURL／NotifyURL／ProdDesc。回傳的四欄位直接塞進 auto-submit form。
 */
export function buildUppForm(
  encryptInfo: Record<string, string | number>,
  keys: PayuniKeys,
  version = '1.0',
): PayuniUppForm {
  const EncryptInfo = encrypt(encryptInfo, keys)
  return {
    MerID: String(encryptInfo.MerID ?? ''),
    Version: version,
    EncryptInfo,
    HashInfo: makeHashInfo(EncryptInfo, keys),
  }
}

/** PAYUNi Notify／Return 解密後的交易結果（僅列開通會用到的欄位；其餘保留）。 */
export interface PayuniTradeResult {
  /** SUCCESS = 付款成功 */
  Status?: string
  MerID?: string
  /** 我方送出的商店訂單編號（帳本冪等鍵） */
  MerTradeNo?: string
  /** PAYUNi 端交易序號 */
  TradeNo?: string
  /** 交易金額 */
  TradeAmt?: string
  /** 付款方式（如 CREDIT） */
  PaymentType?: string
  /** 授權時間 */
  PayTime?: string
  [k: string]: string | undefined
}

/**
 * 驗簽 + 解密 PAYUNi 的 Notify／Return 回傳。
 * PAYUNi 回傳外層是 { MerID, Status, EncryptInfo, HashInfo }：
 *   1. 先用 HashInfo 驗 EncryptInfo（金鑰對不上就驗不過）
 *   2. 再解密 EncryptInfo 取出交易明細
 * 任一步失敗一律回 null（呼叫端據此拒絕、不得開通）。
 */
export function verifyAndDecryptNotify(
  encryptInfo: string,
  hashInfo: string,
  keys: PayuniKeys,
): PayuniTradeResult | null {
  if (!verifyHashInfo(encryptInfo, hashInfo, keys)) return null
  try {
    return decrypt(encryptInfo, keys) as PayuniTradeResult
  }
  catch {
    return null
  }
}
