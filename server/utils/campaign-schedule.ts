import { FieldValue } from 'firebase-admin/firestore'

export type NormalizedCampaignSchedule = { startsAt: string | null; endsAt: string | null }

/** 解析活動檔期；皆空則回傳 null。結束須晚於或等於開始。 */
export function normalizeCampaignScheduleInput(body: unknown): NormalizedCampaignSchedule | string {
  const b = body as Record<string, unknown>
  const s = String(b?.startsAt ?? '').trim()
  const e = String(b?.endsAt ?? '').trim()
  if (!s && !e) return { startsAt: null, endsAt: null }
  const ds = s ? new Date(s) : null
  const de = e ? new Date(e) : null
  if (s && (!ds || Number.isNaN(ds.getTime()))) return '開始時間格式不正確'
  if (e && (!de || Number.isNaN(de.getTime()))) return '結束時間格式不正確'
  if (ds && de && ds > de) return '結束時間須晚於或等於開始時間'
  return { startsAt: s || null, endsAt: e || null }
}

/** 寫入 Firestore：空值則刪除欄位 */
export function schedulePatchForUpdate(n: NormalizedCampaignSchedule): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  out.startsAt = n.startsAt ? n.startsAt : FieldValue.delete()
  out.endsAt = n.endsAt ? n.endsAt : FieldValue.delete()
  return out
}
