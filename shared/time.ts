/**
 * 台灣時區（Asia/Taipei）時間工具 —— 用量月結與方案付款週期的「單一把尺」。
 *
 * 台灣固定 UTC+8、無日光節約,故「位移 8 小時後讀 UTC 欄位」即得台灣民用日期時間,
 * 不需時區資料庫。額度月結桶(aiUsage/{ws}_{yyyyMM})與方案付款週期共用這裡的函式,
 * 確保「額度歸零」與「本期起訖」邊界一致(見 billing Phase 2:付款週期對齊日曆月)。
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 台灣時區下的 yyyyMM(用量記帳 / 方案週期的月份鍵)。 */
export function taipeiYyyyMm(date: Date = new Date()): string {
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 台灣時區下的日曆月起訖(YYYY-MM-DD):start = 當月 1 號、end = 當月最後一天。 */
export function taipeiMonthPeriod(date: Date = new Date()): { start: string; end: string } {
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth()
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return {
    start: fmt(new Date(Date.UTC(y, m, 1))),
    end: fmt(new Date(Date.UTC(y, m + 1, 0))),
  }
}

/** 台灣時區下的今天日期字串 YYYY-MM-DD(到期對帳比對本期到期日用)。 */
export function taipeiDate(date: Date = new Date()): string {
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * 「某到期日之後的下一個日曆月」起訖(YYYY-MM-DD)。續訂/提前付款時把新一期接在
 * 現有到期日之後(期間堆疊),而非重設回當月。純日曆運算(不涉時區)。
 */
export function nextCalendarMonthPeriod(afterEndDate: string): { start: string; end: string } {
  const [y, m, d] = afterEndDate.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1)) // 到期日 +1 天所在的月份
  const ny = next.getUTCFullYear()
  const nm = next.getUTCMonth() // 0-based
  const p2 = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return { start: `${ny}-${p2(nm + 1)}-01`, end: `${ny}-${p2(nm + 1)}-${p2(lastDay)}` }
}
