/** 與 Cron 每分鐘觸發對齊（前後端共用） */
export const BROADCAST_SCHEDULE_MIN_LEAD_MS = 60_000

/** 後台 date-picker 的本地時間字串 → UTC ISO（送 API 用） */
export function localDateTimeInputToUtcIso(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** 表單驗證：排程是否為有效未來時間 */
export function validateFutureScheduleLocalInput(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return '請選擇排程時間'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '排程時間格式不正確'
  if (d.getTime() <= Date.now() + BROADCAST_SCHEDULE_MIN_LEAD_MS) {
    return '排程時間須至少一分鐘後'
  }
  return null
}
