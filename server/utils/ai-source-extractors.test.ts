import { describe, expect, it } from 'vitest'
import { isProbablyScannedPdf, resolveInternalUrl } from './ai-source-extractors'

function extracted(rawLength: number, pages: number) {
  return { text: 'x'.repeat(Math.min(rawLength, 100)), rawLength, meta: { pages } }
}

describe('resolveInternalUrl', () => {
  const base = 'https://shop.example.com/'
  it('相對路徑解析成絕對網址', () => {
    expect(resolveInternalUrl('/projects/abc', base)).toBe('https://shop.example.com/projects/abc')
  })
  it('同網域絕對網址保留', () => {
    expect(resolveInternalUrl('https://shop.example.com/p/1', base)).toBe('https://shop.example.com/p/1')
  })
  it('跨網域 → null（避免帶外部社群連結雜訊）', () => {
    expect(resolveInternalUrl('https://facebook.com/x', base)).toBeNull()
  })
  it('非 http(s)（js / mailto / tel）→ null', () => {
    expect(resolveInternalUrl('javascript:void(0)', base)).toBeNull()
    expect(resolveInternalUrl('mailto:a@b.com', base)).toBeNull()
    expect(resolveInternalUrl('tel:0800', base)).toBeNull()
  })
  it('純錨點解析回本頁網址（同網域 http，保留）', () => {
    expect(resolveInternalUrl('#section', base)).toBe('https://shop.example.com/#section')
  })
})

describe('isProbablyScannedPdf', () => {
  it('完全沒文字層 → 掃描檔', () => {
    expect(isProbablyScannedPdf(extracted(0, 5))).toBe(true)
  })

  it('只剩浮水印 / 頁首零星文字 → 掃描檔', () => {
    // 10 頁只有 80 字(平均 8 字/頁)
    expect(isProbablyScannedPdf(extracted(80, 10))).toBe(true)
    // 20 頁 300 字(平均 15 字/頁)
    expect(isProbablyScannedPdf(extracted(300, 20))).toBe(true)
  })

  it('正常文字 PDF → 不是掃描檔', () => {
    // 1 頁 600 字
    expect(isProbablyScannedPdf(extracted(600, 1))).toBe(false)
    // 30 頁 4 萬字
    expect(isProbablyScannedPdf(extracted(40_000, 30))).toBe(false)
  })

  it('短但密度夠的單頁文件 → 不是掃描檔', () => {
    expect(isProbablyScannedPdf(extracted(150, 1))).toBe(false)
  })

  it('拿不到頁數時退回總字數判斷', () => {
    expect(isProbablyScannedPdf(extracted(10, 0))).toBe(true)
    expect(isProbablyScannedPdf(extracted(500, 0))).toBe(false)
  })
})
