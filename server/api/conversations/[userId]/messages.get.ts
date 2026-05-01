import { getDb } from '~~/server/utils/firebase'
import type { ConversationStatus } from '~~/shared/types/conversation-stats'
import { STATUS_LABELS } from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId required' })

  const db = getDb()
  const convRef = db.collection('conversations').doc(userId)
  const snap = await convRef
    .collection('messages')
    .orderBy('timestamp', 'desc')
    .limit(200)
    .get()

  // 抓最新 200 筆，再反轉成舊->新，讓前端顯示維持由上到下的時間序
  const messages = snap.docs.map(d => ({
    id: d.id,
    direction: d.data().direction as 'incoming' | 'outgoing',
    text: d.data().text as string,
    messageType: (d.data().messageType as string | undefined) ?? 'text',
    payload: d.data().payload ?? null,
    timestamp: d.data().timestamp ?? null,
  })).reverse()

  const convData = (await convRef.get()).data()
  const currentSessionId = convData?.currentSessionId as string | undefined | null
  let activeSession: {
    sessionId: string
    status: ConversationStatus
    statusLabel: string
  } | null = null

  if (currentSessionId) {
    const sSnap = await db.collection('conversationSessions').doc(currentSessionId).get()
    if (sSnap.exists) {
      const st = sSnap.data()?.status as ConversationStatus
      activeSession = {
        sessionId: currentSessionId,
        status: st,
        statusLabel: STATUS_LABELS[st] ?? String(st),
      }
    }
  }

  return { messages, activeSession }
})
