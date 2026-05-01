import { getDb } from '~~/server/utils/firebase'
import type { TrendBucket, TrendGranularity } from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

function bucketKey(date: Date, granularity: TrendGranularity): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (granularity === 'day') return `${y}-${m}-${d}`
  if (granularity === 'month') return `${y}-${m}`
  // week: ISO week start (Monday)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(date)
  monday.setDate(diff)
  const wm = String(monday.getMonth() + 1).padStart(2, '0')
  const wd = String(monday.getDate()).padStart(2, '0')
  return `${monday.getFullYear()}-${wm}-${wd}`
}

export default defineEventHandler(async (event): Promise<{ buckets: TrendBucket[] }> => {
  await requireFirebaseAuth(event)
  const query = getQuery(event)
  const granularity: TrendGranularity =
    query.granularity === 'week' || query.granularity === 'month'
      ? (query.granularity as TrendGranularity)
      : 'day'

  const db = getDb()
  let ref = db.collection('conversationSessions') as FirebaseFirestore.Query

  const startDate = query.startDate ? new Date(String(query.startDate)) : (() => {
    const d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0, 0, 0, 0); return d
  })()
  const endDate = query.endDate ? (() => {
    const d = new Date(String(query.endDate)); d.setHours(23, 59, 59, 999); return d
  })() : new Date()

  ref = ref.where('openedAt', '>=', startDate).where('openedAt', '<=', endDate)

  const snap = await ref.get()
  const bucketMap = new Map<string, TrendBucket>()

  for (const doc of snap.docs) {
    const s = doc.data()
    const ts = s.openedAt?.toDate?.()
    if (!ts) continue

    const key = bucketKey(ts, granularity)
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { date: key, total: 0, bot: 0, human: 0, unhandled: 0, handoff: 0, closed: 0 })
    }
    const bucket = bucketMap.get(key)!
    bucket.total++
    if (s.initialHandler === 'bot') bucket.bot++
    else if (s.initialHandler === 'human') bucket.human++
    else bucket.unhandled++
    if (s.hasHandoff) bucket.handoff++
    if (s.status === 'closed') bucket.closed++
  }

  const buckets = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)

  return { buckets }
})
