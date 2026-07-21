import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  buildUppForm,
  decrypt,
  encodeEncryptInfo,
  encrypt,
  makeHashInfo,
  verifyAndDecryptPayuniNotify,
  verifyHashInfo,
} from './payuni'

// 測試用假金鑰(長度須合規:Hash Key 32 碼、IV Key 16 碼)。非真實特店金鑰。
const KEYS = {
  merKey: 'abcdefghijklmnopqrstuvwxyz123456', // 32
  merIV: '1234567890abcdef', // 16
}

describe('金鑰長度驗證', () => {
  it('Hash Key 非 32 碼會丟錯', () => {
    expect(() => encrypt({ x: 1 }, { merKey: 'too-short', merIV: KEYS.merIV })).toThrow()
  })
  it('IV Key 非 16 碼會丟錯', () => {
    expect(() => encrypt({ x: 1 }, { merKey: KEYS.merKey, merIV: 'short' })).toThrow()
  })
})

describe('AES-256-GCM 往返', () => {
  it('加密後可解回原參數,且 EncryptInfo 為小寫 hex', () => {
    const params = { MerID: 'ABC123', MerTradeNo: 'NP2026', TradeAmt: 499, ProdDesc: '輕量方案' }
    const enc = encrypt(params, KEYS)
    expect(enc).toMatch(/^[0-9a-f]+$/)
    expect(decrypt(enc, KEYS)).toEqual({
      MerID: 'ABC123',
      MerTradeNo: 'NP2026',
      TradeAmt: '499', // 解回都是字串(query string 本質)
      ProdDesc: '輕量方案',
    })
  })

  it('EncryptInfo 內層是 base64(密文):::base64(tag) 的 hex(對齊 PHP SDK 格式)', () => {
    const enc = encrypt({ Timestamp: 1700000000 }, KEYS)
    const combined = Buffer.from(enc, 'hex').toString('utf8')
    expect(combined).toContain(':::')
    const [ctB64, tagB64] = combined.split(':::') as [string, string]
    // 兩段都是合法 base64
    expect(Buffer.from(ctB64, 'base64').toString('base64')).toBe(ctB64)
    expect(Buffer.from(tagB64, 'base64')).toHaveLength(16) // GCM tag 16 bytes
  })

  it('中文與空值都能往返', () => {
    const params = { ProdDesc: '成長方案 ×1', Note: '', MerID: '測試店' }
    expect(decrypt(encrypt(params, KEYS), KEYS)).toEqual(params)
  })

  it('金鑰不符 → 解密丟錯(GCM tag 驗證失敗)', () => {
    const enc = encrypt({ MerID: 'ABC' }, KEYS)
    expect(() => decrypt(enc, { merKey: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', merIV: KEYS.merIV })).toThrow()
  })
})

describe('HashInfo 簽章', () => {
  it('等於 SHA256(merKey + EncryptInfo + merIV) 全大寫', () => {
    const enc = encrypt({ MerID: 'ABC' }, KEYS)
    const expected = createHash('sha256').update(KEYS.merKey + enc + KEYS.merIV).digest('hex').toUpperCase()
    expect(makeHashInfo(enc, KEYS)).toBe(expected)
    expect(makeHashInfo(enc, KEYS)).toMatch(/^[0-9A-F]{64}$/)
  })

  it('驗簽:相符回 true、竄改回 false', () => {
    const enc = encrypt({ MerID: 'ABC' }, KEYS)
    const hash = makeHashInfo(enc, KEYS)
    expect(verifyHashInfo(enc, hash, KEYS)).toBe(true)
    expect(verifyHashInfo(enc, hash.replace(/.$/, '0'), KEYS)).toBe(false)
    expect(verifyHashInfo(`${enc}00`, hash, KEYS)).toBe(false)
  })
})

describe('buildUppForm', () => {
  it('產出四個 POST 欄位,HashInfo 對得上 EncryptInfo', () => {
    const form = buildUppForm(
      { MerID: 'ABC', MerTradeNo: 'NP1', TradeAmt: 499, Timestamp: 1700000000 },
      KEYS,
    )
    expect(form.MerID).toBe('ABC')
    expect(form.Version).toBe('1.0')
    expect(verifyHashInfo(form.EncryptInfo, form.HashInfo, KEYS)).toBe(true)
    // 內層可解回原參數
    expect(decrypt(form.EncryptInfo, KEYS)).toMatchObject({ MerID: 'ABC', TradeAmt: '499' })
  })
})

describe('verifyAndDecryptPayuniNotify(模擬 PAYUNi 回傳)', () => {
  it('驗簽 + 解密成功回交易明細', () => {
    const result = { Status: 'SUCCESS', MerID: 'ABC', MerTradeNo: 'NP1', TradeNo: 'UNI123', TradeAmt: '499' }
    const enc = encrypt(result, KEYS)
    const hash = makeHashInfo(enc, KEYS)
    expect(verifyAndDecryptPayuniNotify(enc, hash, KEYS)).toMatchObject(result)
  })

  it('簽章不符一律回 null(不得開通)', () => {
    const enc = encrypt({ Status: 'SUCCESS' }, KEYS)
    expect(verifyAndDecryptPayuniNotify(enc, 'DEADBEEF', KEYS)).toBeNull()
  })
})

describe('encodeEncryptInfo', () => {
  it('串成 x-www-form-urlencoded query', () => {
    expect(encodeEncryptInfo({ a: 1, b: 'x y' })).toBe('a=1&b=x+y')
  })
})
