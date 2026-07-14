// ═══════════════════════════════════════════════════════════════════
//  營業稅拆算（純函式）
//
//  方案表的 priceMonthly 是**含稅**價——那是實際刷卡的金額,所以也是發票的
//  「發票金額 TotalAmt」。電子發票另外要 Amt（銷售額,未稅）與 TaxAmt（稅額）,
//  由含稅價反推。
//
//  ⚠️ 這裡的拆法（四捨五入銷售額、稅額用減的補平）保證 Amt + TaxAmt === TotalAmt,
//     這是財政部與 ezPay 都會檢核的條件。若先算稅額再相減,會出現差 1 元對不上的情況。
// ═══════════════════════════════════════════════════════════════════

/** 台灣營業稅一般稅率（%）。 */
export const TAX_RATE_PERCENT = 5

export interface TaxBreakdown {
  /** 發票金額（含稅）＝ 實際請款金額 */
  totalAmt: number
  /** 銷售額（未稅） */
  amt: number
  /** 稅額 */
  taxAmt: number
}

/**
 * 由含稅總額拆出銷售額與稅額。
 * 銷售額四捨五入,稅額用「總額 − 銷售額」補平,確保三者永遠相加相等。
 */
export function splitTax(totalAmtIncTax: number): TaxBreakdown {
  const totalAmt = Math.round(totalAmtIncTax)
  const amt = Math.round(totalAmt / (1 + TAX_RATE_PERCENT / 100))
  return { totalAmt, amt, taxAmt: totalAmt - amt }
}
