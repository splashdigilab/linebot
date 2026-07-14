import { describe, expect, it } from 'vitest'
import {
  buildInvoicePostData,
  buildIssueInvoiceParams,
  isValidCarrierNum,
  isValidLoveCode,
  isValidUBN,
  makeInvoiceCheckCode,
  verifyInvoiceCheckCode,
} from './ezpay-invoice'
import { aesDecrypt } from './newebpay'

const KEYS = {
  merchantId: '3622183',
  hashKey: 'abcdefghijklmnopqrstuvwxyzabcdef', // 32
  hashIV: '1234567891234567', // 16
  apiUrl: 'https://cinv.ezpay.com.tw',
}

describe('buildInvoicePostData — 補位到 32 bytes（與金流的 16 不同）', () => {
  it('密文長度必為 32 bytes 的倍數（ezPay 的 addpadding($s, 32)）', () => {
    for (const s of ['a', 'a'.repeat(31), 'a'.repeat(32), 'a'.repeat(33)]) {
      const hex = buildInvoicePostData({ X: s }, KEYS)
      expect(hex.length % 64).toBe(0) // 32 bytes = 64 hex 字元
    }
  })

  it('長度剛好整除時仍補滿一整塊（PKCS7 規定，少補會被 ezPay 判參數錯誤）', () => {
    // 'X=' + 30 個字 = 32 bytes 整 → 必須再補 32 bytes = 密文 64 bytes
    const hex = buildInvoicePostData({ X: 'a'.repeat(30) }, KEYS)
    expect(Buffer.from(hex, 'hex').length).toBe(64)
  })

  it('可用同一組金鑰解回原本的 query（往返一致）', () => {
    const hex = buildInvoicePostData({ RespondType: 'JSON', TotalAmt: 499 }, KEYS)
    const plain = aesDecrypt(hex, KEYS) // 去墊後應還原
    expect(plain).toContain('RespondType=JSON')
    expect(plain).toContain('TotalAmt=499')
  })

  it('金鑰長度不對 → 直接拋錯（不要送出去才被 ezPay 退）', () => {
    expect(() => buildInvoicePostData({ a: 1 }, { ...KEYS, hashKey: 'short' })).toThrow(/HashKey/)
    expect(() => buildInvoicePostData({ a: 1 }, { ...KEYS, hashIV: 'short' })).toThrow(/HashIV/)
  })
})

describe('CheckCode（附件二）', () => {
  it('與官方文件的範例值一致', () => {
    // 文件 71 頁的範例：欄位 A~Z 排序、前後夾 HashIV / HashKey、SHA256 大寫
    const code = makeInvoiceCheckCode({
      MerchantID: '3622183',
      MerchantOrderNo: '201409170000001',
      InvoiceTransNo: '14061313541640927',
      TotalAmt: '500',
      RandomNum: '0142',
    }, KEYS)
    expect(code).toBe('303AB800650B724733B5D91CBCE075D9EA09E4CDE9CD33461D45F07D5EC7EECB')
  })

  it('驗證通過 / 被竄改則失敗', () => {
    const f = {
      MerchantID: '3622183',
      MerchantOrderNo: '201409170000001',
      InvoiceTransNo: '14061313541640927',
      TotalAmt: '500',
      RandomNum: '0142',
    }
    expect(verifyInvoiceCheckCode(f, makeInvoiceCheckCode(f, KEYS), KEYS)).toBe(true)
    expect(verifyInvoiceCheckCode({ ...f, TotalAmt: '999' }, makeInvoiceCheckCode(f, KEYS), KEYS)).toBe(false)
    expect(verifyInvoiceCheckCode(f, 'GARBAGE', KEYS)).toBe(false)
  })
})

describe('buildIssueInvoiceParams — 稅額與載具規則', () => {
  const base = { merchantOrderNo: 'NP1', totalAmt: 499, itemName: '入門方案', fallbackBuyerName: 'MyFeel' }

  it('B2C 無載具無捐贈 → 開紙本（ezPay 硬性要求 PrintFlag=Y）', () => {
    const p = buildIssueInvoiceParams({ ...base, profile: {} })
    expect(p.Category).toBe('B2C')
    expect(p.PrintFlag).toBe('Y')
    expect(p.BuyerName).toBe('MyFeel') // 沒填抬頭 → 用帳號名稱
    expect(p.TotalAmt).toBe(499)
    expect(p.Amt).toBe(475)
    expect(p.TaxAmt).toBe(24)
    expect(Number(p.Amt) + Number(p.TaxAmt)).toBe(Number(p.TotalAmt))
    // B2C 單價含稅
    expect(p.ItemPrice).toBe(499)
  })

  it('B2C 手機條碼載具 → CarrierType=0、不索取紙本', () => {
    const p = buildIssueInvoiceParams({ ...base, profile: { carrierNum: '/ABC1234' } })
    expect(p.CarrierType).toBe('0')
    expect(p.CarrierNum).toBe('/ABC1234')
    expect(p.PrintFlag).toBe('N')
    expect(p.LoveCode).toBeUndefined()
  })

  it('B2C 捐贈碼 → 帶 LoveCode、不帶載具（兩者互斥）', () => {
    const p = buildIssueInvoiceParams({ ...base, profile: { loveCode: '25885' } })
    expect(p.LoveCode).toBe('25885')
    expect(p.CarrierType).toBeUndefined()
    expect(p.PrintFlag).toBe('N')
  })

  it('有統編 → B2B、必開紙本、單價改未稅（ezPay 規定）', () => {
    const p = buildIssueInvoiceParams({
      ...base,
      profile: { buyerUBN: '12345678', buyerName: '好感覺股份有限公司', carrierNum: '/ABC1234' },
    })
    expect(p.Category).toBe('B2B')
    expect(p.BuyerUBN).toBe('12345678')
    expect(p.PrintFlag).toBe('Y')
    expect(p.ItemPrice).toBe(475) // 未稅
    // B2B 不吃載具，就算填了也不能送
    expect(p.CarrierType).toBeUndefined()
  })
})

describe('格式驗證（在存檔時擋掉，不要等付款後才被 ezPay 退件）', () => {
  it('手機條碼載具：/ + 7 碼大寫英數', () => {
    expect(isValidCarrierNum('/ABC1234')).toBe(true)
    expect(isValidCarrierNum('/AB+12.9')).toBe(true) // + - . 也是合法字元
    expect(isValidCarrierNum('/abc1234')).toBe(true) // 小寫會被正規化成大寫
    expect(isValidCarrierNum('ABC1234')).toBe(false) // 少斜線
    expect(isValidCarrierNum('/ABC123')).toBe(false) // 斜線後只有 6 碼
    expect(isValidCarrierNum('/ABC12345')).toBe(false) // 太長
  })
  it('捐贈碼：3–7 碼數字', () => {
    expect(isValidLoveCode('25885')).toBe(true)
    expect(isValidLoveCode('12')).toBe(false)
    expect(isValidLoveCode('12345678')).toBe(false)
  })
  it('統編：8 碼數字', () => {
    expect(isValidUBN('12345678')).toBe(true)
    expect(isValidUBN('1234567')).toBe(false)
    expect(isValidUBN('1234567A')).toBe(false)
  })
})
