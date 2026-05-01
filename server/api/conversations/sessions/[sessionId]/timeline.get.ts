import { getDb } from '~~/server/utils/firebase'
import type { ConversationEventType, ModuleType } from '~~/shared/types/conversation-stats'
import {
  MODULE_TYPE_LABELS,
  STATUS_LABELS,
} from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

type TimelineItemType = 'message' | 'event'

interface TimelineItem {
  id: string
  type: TimelineItemType
  timestamp: any
  // message fields
  direction?: 'incoming' | 'outgoing'
  text?: string
  messageType?: string
  payload?: unknown
  // event fields
  eventType?: ConversationEventType
  moduleType?: ModuleType
  moduleId?: string
  label?: string
}

function eventLabel(eventType: ConversationEventType, moduleType?: ModuleType): string {
  if (eventType === 'conversation_opened') return '新會話開始'
  if (eventType === 'conversation_closed') return '會話已結束'
  if (eventType === 'handoff_request') return '請求轉接真人'
  if (eventType === 'human_first_reply') return '真人客服首次回覆'
  if (eventType === 'entered_module') {
    const label = moduleType ? MODULE_TYPE_LABELS[moduleType] : '模組'
    return `進入：${label}`
  }
  return eventType
}

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'sessionId required' })

  await requireFirebaseAuth(event)

  const db = getDb()
  const sessionSnap = await db.collection('conversationSessions').doc(sessionId).get()
  if (!sessionSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此會話' })

  const session = sessionSnap.data()!
  const userId = session.userId as string

  // Fetch events for this session
  const eventsSnap = await db.collection('conversationEvents')
    .where('sessionId', '==', sessionId)
    .orderBy('timestamp', 'asc')
    .get()

  // Fetch messages in the session time window
  const openedAt = session.openedAt?.toDate?.() ?? new Date(0)
  const closedAt = session.closedAt?.toDate?.() ?? new Date()

  let msgsRef = db.collection('conversations').doc(userId).collection('messages')
    .where('timestamp', '>=', openedAt)
    .orderBy('timestamp', 'asc') as FirebaseFirestore.Query

  if (session.closedAt) {
    msgsRef = db.collection('conversations').doc(userId).collection('messages')
      .where('timestamp', '>=', openedAt)
      .where('timestamp', '<=', closedAt)
      .orderBy('timestamp', 'asc')
  }

  const msgsSnap = await msgsRef.limit(500).get()

  const items: TimelineItem[] = []

  for (const d of eventsSnap.docs) {
    const e = d.data()
    items.push({
      id: d.id,
      type: 'event',
      timestamp: e.timestamp,
      eventType: e.eventType,
      moduleType: e.moduleType,
      moduleId: e.moduleId,
      label: eventLabel(e.eventType, e.moduleType),
    })
  }

  for (const d of msgsSnap.docs) {
    const m = d.data()
    items.push({
      id: d.id,
      type: 'message',
      timestamp: m.timestamp,
      direction: m.direction,
      text: m.text,
      messageType: m.messageType,
      payload: m.payload,
    })
  }

  // Sort by timestamp
  items.sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() ?? 0
    const tb = b.timestamp?.toMillis?.() ?? 0
    return ta - tb
  })

  return {
    sessionId,
    userId,
    status: session.status,
    statusLabel: STATUS_LABELS[session.status as keyof typeof STATUS_LABELS] ?? session.status,
    initialHandler: session.initialHandler,
    hasHandoff: session.hasHandoff,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    items,
  }
})
