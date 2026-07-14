import { describe, expect, it } from 'vitest'
import { splitTax } from './tax'
import { BILLING_PLANS } from './plans'

describe('splitTax — 由含稅價反推銷售額與稅額', () => {
  it('銷售額 + 稅額必須等於發票金額（ezPay 與財政部都會檢核）', () => {
    for (const total of [499, 799, 1990, 4990, 1, 3, 100, 12345]) {
      const { totalAmt, amt, taxAmt } = splitTax(total)
      expect(amt + taxAmt).toBe(totalAmt)
      expect(totalAmt).toBe(total)
    }
  })

  it('每個可線上結帳的方案價都能拆平（不會出現差 1 元對不上）', () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      if (plan.priceMonthly == null || plan.priceMonthly <= 0) continue
      const { totalAmt, amt, taxAmt } = splitTax(plan.priceMonthly)
      expect(amt + taxAmt).toBe(totalAmt)
    }
  })

  it('499 → 銷售額 475 + 稅額 24', () => {
    expect(splitTax(499)).toEqual({ totalAmt: 499, amt: 475, taxAmt: 24 })
  })

  it('799 → 銷售額 761 + 稅額 38', () => {
    expect(splitTax(799)).toEqual({ totalAmt: 799, amt: 761, taxAmt: 38 })
  })
})
