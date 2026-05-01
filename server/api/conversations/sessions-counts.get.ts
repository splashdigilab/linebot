import { getDb } from '~~/server/utils/firebase'
import type { ConversationStatus } from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

const STATUSES: ConversationStatus[] = [
  'open',
  'bot_handling',
  'pending_human',
  'human_handling',
  'closed',
]

export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)
  const db = getDb()

  const counts = {} as Record<ConversationStatus, number>
  await Promise.all(
    STATUSES.map(async (status) => {
      const snap = await db
        .collection('conversationSessions')
        .where('status', '==', status)
        .count()
        .get()
      counts[status] = snap.data().count
    }),
  )

  const total = STATUSES.reduce((sum, s) => sum + counts[s], 0)

  return { counts, total }
})
