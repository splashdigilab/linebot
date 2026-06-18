import { describe, expect, it } from 'vitest'
import { parseGoogleSheetUrl, rowToCard } from './google-sheets'

describe('parseGoogleSheetUrl', () => {
  it('解析完整網址含 gid', () => {
    const r = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-_dEf/edit#gid=123')
    expect(r).toEqual({ spreadsheetId: '1AbC-_dEf', gid: '123' })
  })

  it('完整網址沒有 gid → gid null', () => {
    const r = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-_dEf/edit')
    expect(r).toEqual({ spreadsheetId: '1AbC-_dEf', gid: null })
  })

  it('純 spreadsheet id', () => {
    const id = 'a'.repeat(30)
    expect(parseGoogleSheetUrl(id)).toEqual({ spreadsheetId: id, gid: null })
  })

  it('無效輸入回 null', () => {
    expect(parseGoogleSheetUrl('')).toBeNull()
    expect(parseGoogleSheetUrl('https://example.com/foo')).toBeNull()
    expect(parseGoogleSheetUrl('short')).toBeNull()
  })
})

describe('rowToCard', () => {
  const headers = ['商品', '價格', '庫存', '備註']

  it('多欄表：標題=第一欄，內容=其餘欄表頭:值', () => {
    const card = rowToCard(headers, ['除濕機', '3990', '5', '附發票'])
    expect(card).toEqual({
      title: '除濕機',
      content: '價格：3990\n庫存：5\n備註：附發票',
      tags: [],
    })
  })

  it('多欄表：空值欄略過', () => {
    const card = rowToCard(headers, ['除濕機', '3990', '', ''])
    expect(card?.content).toBe('價格：3990')
  })

  it('兩欄表（FAQ）：內容=第二欄整段', () => {
    const card = rowToCard(['問題', '答案'], ['運費多少', '滿千免運，未滿 80 元'])
    expect(card).toEqual({ title: '運費多少', content: '滿千免運，未滿 80 元', tags: [] })
  })

  it('第一欄空白 → 跳過該列（回 null）', () => {
    expect(rowToCard(headers, ['', '3990', '5', ''])).toBeNull()
  })

  it('單欄 / 無其他內容 → 用標題自身當內容', () => {
    expect(rowToCard(['商品'], ['除濕機'])?.content).toBe('除濕機')
  })
})
