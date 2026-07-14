import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  aesDecrypt,
  aesEncrypt,
  buildTradeInfo,
  encodeTradeParams,
  makeTradeSha,
  parseNotifyResult,
  verifyAndDecryptNotify,
  verifyTradeSha,
} from './newebpay'

// 測試用假金鑰(長度須合規:HashKey 32 碼、HashIV 16 碼)。非真實特店金鑰。
const KEYS = {
  hashKey: 'abcdefghijklmnopqrstuvwxyz123456', // 32
  hashIV: '1234567890abcdef', // 16
}

describe('金鑰長度驗證', () => {
  it('HashKey 非 32 碼會丟錯', () => {
    expect(() => aesEncrypt('x', { hashKey: 'too-short', hashIV: KEYS.hashIV })).toThrow()
  })
  it('HashIV 非 16 碼會丟錯', () => {
    expect(() => aesEncrypt('x', { hashKey: KEYS.hashKey, hashIV: 'short' })).toThrow()
  })
})

describe('AES-256-CBC 往返', () => {
  it('加密後可解回原字串,且為小寫 hex', () => {
    const plain = 'MerchantID=ABC123&Amt=499&ItemDesc=輕量方案'
    const hex = aesEncrypt(plain, KEYS)
    expect(hex).toMatch(/^[0-9a-f]+$/)
    expect(aesDecrypt(hex, KEYS)).toBe(plain)
  })

  it('空字串也能往返', () => {
    expect(aesDecrypt(aesEncrypt('', KEYS), KEYS)).toBe('')
  })

  it('中文與長 JSON 內容往返一致', () => {
    const plain = JSON.stringify({ Status: 'SUCCESS', Message: '授權成功', 商品: '成長方案 ×1' })
    expect(aesDecrypt(aesEncrypt(plain, KEYS), KEYS)).toBe(plain)
  })
})

describe('buildTradeInfo', () => {
  it('參數 → query → 加密,解回即為 URL-encoded query', () => {
    const params = { MerchantID: 'ABC', RespondType: 'JSON', Amt: 799, MerchantOrderNo: 'OA_202607_001' }
    const info = buildTradeInfo(params, KEYS)
    expect(aesDecrypt(info, KEYS)).toBe(encodeTradeParams(params))
  })
})

describe('makeTradeSha', () => {
  const info = buildTradeInfo({ Amt: 499 }, KEYS)

  it('為 64 碼大寫 hex', () => {
    expect(makeTradeSha(info, KEYS)).toMatch(/^[0-9A-F]{64}$/)
  })

  it('符合 SHA256("HashKey=..&<TradeInfo>&HashIV=..") 全大寫的規格', () => {
    // 測試獨立表達規格公式,鎖住格式(分隔符、順序、大小寫)
    const expected = createHash('sha256')
      .update(`HashKey=${KEYS.hashKey}&${info}&HashIV=${KEYS.hashIV}`)
      .digest('hex')
      .toUpperCase()
    expect(makeTradeSha(info, KEYS)).toBe(expected)
  })

  it('TradeInfo 不同時 TradeSha 也不同', () => {
    const other = buildTradeInfo({ Amt: 500 }, KEYS)
    expect(makeTradeSha(other, KEYS)).not.toBe(makeTradeSha(info, KEYS))
  })
})

describe('verifyTradeSha', () => {
  const info = buildTradeInfo({ Amt: 1990, MerchantOrderNo: 'X1' }, KEYS)
  const sha = makeTradeSha(info, KEYS)

  it('相符回 true(大小寫不敏感)', () => {
    expect(verifyTradeSha(info, sha, KEYS)).toBe(true)
    expect(verifyTradeSha(info, sha.toLowerCase(), KEYS)).toBe(true)
  })

  it('TradeInfo 被竄改回 false', () => {
    const tampered = buildTradeInfo({ Amt: 1, MerchantOrderNo: 'X1' }, KEYS)
    expect(verifyTradeSha(tampered, sha, KEYS)).toBe(false)
  })

  it('TradeSha 被竄改或為空回 false', () => {
    expect(verifyTradeSha(info, 'DEADBEEF', KEYS)).toBe(false)
    expect(verifyTradeSha(info, '', KEYS)).toBe(false)
  })
})

describe('verifyAndDecryptNotify', () => {
  const payload = JSON.stringify({
    Status: 'SUCCESS',
    Message: '授權成功',
    Result: { MerchantOrderNo: 'OA_202607_001', Amt: 499, TradeNo: '24071312345678', PaymentType: 'CREDIT' },
  })
  const info = aesEncrypt(payload, KEYS)
  const sha = makeTradeSha(info, KEYS)

  it('驗簽成功回解密字串', () => {
    expect(verifyAndDecryptNotify(info, sha, KEYS)).toBe(payload)
  })

  it('驗簽失敗回 null(不得開通)', () => {
    expect(verifyAndDecryptNotify(info, 'WRONGSHA', KEYS)).toBeNull()
  })
})

describe('parseNotifyResult', () => {
  it('解析成功回物件', () => {
    const p = parseNotifyResult(JSON.stringify({ Status: 'SUCCESS', Result: { Amt: 499 } }))
    expect(p?.Status).toBe('SUCCESS')
    expect(p?.Result?.Amt).toBe(499)
  })

  it('非 JSON 回 null', () => {
    expect(parseNotifyResult('not-json')).toBeNull()
  })

  it('缺 Status 回 null', () => {
    expect(parseNotifyResult(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})
