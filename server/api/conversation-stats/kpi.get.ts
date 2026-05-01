import { getDb } from '~~/server/utils/firebase'
import type { KpiResult } from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event): Promise<KpiResult> => {
  await requireFirebaseAuth(event)
  const query = getQuery(event)
  const db = getDb()

  let ref = db.collection('conversationSessions') as FirebaseFirestore.Query

  if (query.startDate) {
    ref = ref.where('openedAt', '>=', new Date(String(query.startDate)))
  }
  if (query.endDate) {
    const end = new Date(String(query.endDate))
    end.setHours(23, 59, 59, 999)
    ref = ref.where('openedAt', '<=', end)
  }

  const snap = await ref.get()
  const sessions = snap.docs.map(d => d.data())

  const total = sessions.length
  const botHandled = sessions.filter(s => s.initialHandler === 'bot').length
  const humanHandled = sessions.filter(s => s.initialHandler === 'human').length
  const unhandled = sessions.filter(s => s.initialHandler === 'unhandled').length
  const handoffCount = sessions.filter(s => s.hasHandoff === true).length
  const closedCount = sessions.filter(s => s.status === 'closed').length
  const handledCount = botHandled + humanHandled

  return {
    total,
    botHandled,
    humanHandled,
    unhandled,
    handoffCount,
    handoffRate: total > 0 ? handoffCount / total : 0,
    closedCount,
    handledCount,
    closeRateByTotal: total > 0 ? closedCount / total : 0,
    closeRateByHandled: handledCount > 0 ? closedCount / handledCount : 0,
  }
})
