import type { Timestamp } from 'firebase-admin/firestore'

/** 與 Cron 每分鐘觸發對齊：排程時間至少需晚於現在此秒數 */
export const BROADCAST_SCHEDULE_MIN_LEAD_MS = 60_000

export type BroadcastScheduleParseResult =
  | { ok: true; date: Date }
  | { ok: false; reason: 'empty' | 'invalid' | 'past' }

export function broadcastScheduleAtToDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const ts = value as Timestamp
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate()
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseBroadcastScheduleAtInput(value: unknown): BroadcastScheduleParseResult {
  if (value === null || value === undefined || value === '') {
    return { ok: false, reason: 'empty' }
  }
  const d = broadcastScheduleAtToDate(value)
  if (!d) return { ok: false, reason: 'invalid' }
  if (d.getTime() <= Date.now() + BROADCAST_SCHEDULE_MIN_LEAD_MS) {
    return { ok: false, reason: 'past' }
  }
  return { ok: true, date: d }
}

export function broadcastScheduleErrorMessage(reason: 'empty' | 'invalid' | 'past'): string {
  if (reason === 'empty') return '請選擇排程時間'
  if (reason === 'invalid') return '排程時間格式不正確'
  return '排程時間須至少一分鐘後'
}

export function assertFutureBroadcastScheduleAt(value: unknown): Date {
  const parsed = parseBroadcastScheduleAtInput(value)
  if (!parsed.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: broadcastScheduleErrorMessage(parsed.reason),
    })
  }
  return parsed.date
}
