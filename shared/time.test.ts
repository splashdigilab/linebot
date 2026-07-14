import { describe, expect, it } from 'vitest'
import { nextCalendarMonthPeriod, taipeiDate, taipeiMonthPeriod, taipeiYyyyMm } from './time'

describe('taipeiYyyyMm', () => {
  it('月中:UTC 與台灣同月', () => {
    expect(taipeiYyyyMm(new Date('2026-07-13T00:00:00Z'))).toBe('202607')
  })
  it('月底跨時區:UTC 7/31 18:00 = 台灣 8/1 02:00 → 算 8 月', () => {
    expect(taipeiYyyyMm(new Date('2026-07-31T18:00:00Z'))).toBe('202608')
  })
  it('UTC 7/31 15:00 = 台灣 7/31 23:00 → 仍算 7 月', () => {
    expect(taipeiYyyyMm(new Date('2026-07-31T15:00:00Z'))).toBe('202607')
  })
})

describe('taipeiMonthPeriod', () => {
  it('7 月 → 07-01 ~ 07-31', () => {
    expect(taipeiMonthPeriod(new Date('2026-07-13T00:00:00Z'))).toEqual({ start: '2026-07-01', end: '2026-07-31' })
  })
  it('月底跨時區歸到台灣的下個月', () => {
    expect(taipeiMonthPeriod(new Date('2026-07-31T18:00:00Z'))).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })
  it('二月非閏年 → 28、閏年 → 29', () => {
    expect(taipeiMonthPeriod(new Date('2026-02-10T00:00:00Z')).end).toBe('2026-02-28')
    expect(taipeiMonthPeriod(new Date('2028-02-10T00:00:00Z')).end).toBe('2028-02-29')
  })
})

describe('taipeiDate', () => {
  it('月中同日', () => {
    expect(taipeiDate(new Date('2026-07-13T00:00:00Z'))).toBe('2026-07-13')
  })
  it('UTC 7/31 18:00 = 台灣 8/1 → 進到隔天', () => {
    expect(taipeiDate(new Date('2026-07-31T18:00:00Z'))).toBe('2026-08-01')
  })
})

describe('nextCalendarMonthPeriod', () => {
  it('7 月底 → 下一期 8 月', () => {
    expect(nextCalendarMonthPeriod('2026-07-31')).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })
  it('12 月底 → 跨年到隔年 1 月', () => {
    expect(nextCalendarMonthPeriod('2026-12-31')).toEqual({ start: '2027-01-01', end: '2027-01-31' })
  })
  it('接到閏年 2 月 → 29 天', () => {
    expect(nextCalendarMonthPeriod('2028-01-31')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
})
