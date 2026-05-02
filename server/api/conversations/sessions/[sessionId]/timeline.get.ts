import { getDb } from '~~/server/utils/firebase'
import type { ConversationEventType, ModuleType } from '~~/shared/types/conversation-stats'
import {
  MODULE_TYPE_LABELS,
  STATUS_LABELS,
} from '~~/shared/types/conversation-stats'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { lineUserFirestoreDocId, lineUserIdFromFirestoreDocId } from '~~/shared/line-workspace'

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

function toMillis(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw === 'object' && raw !== null && 'toMillis' in raw && typeof (raw as { toMillis: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis()
  }
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().getTime()
  }
  if (raw instanceof Date) return raw.getTime()
  const t = new Date(String(raw)).getTime()
  return Number.isFinite(t) ? t : 0
}

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'sessionId required' })

  const db = getDb()
  const sessionSnap = await db.collection('conversationSessions').doc(sessionId).get()
  if (!sessionSnap.exists || sessionSnap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: '找不到此會話' })
  }

  const session = sessionSnap.data()!
  const userId = session.userId as string
  const lineUserId = lineUserIdFromFirestoreDocId(userId)
  const convDocId = lineUserFirestoreDocId(lineUserId, workspaceId)

  // Fetch events for this session (avoid composite index: sessionId + orderBy timestamp)
  const eventsSnap = await db.collection('conversationEvents')
    .where('sessionId', '==', sessionId)
    .get()

  // Fetch messages in the session time window
  const openedAt = session.openedAt?.toDate?.() ?? new Date(0)
  const closedAt = session.closedAt?.toDate?.() ?? new Date()
  const openMs = toMillis(openedAt)
  const closeMs = session.closedAt ? toMillis(closedAt) : Number.POSITIVE_INFINITY

  const msgCol = db.collection('conversations').doc(convDocId).collection('messages')

  let messageDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
  try {
    let msgsRef = msgCol
      .where('timestamp', '>=', openedAt)
      .orderBy('timestamp', 'asc') as FirebaseFirestore.Query

    if (session.closedAt) {
      msgsRef = msgCol
        .where('timestamp', '>=', openedAt)
        .where('timestamp', '<=', closedAt)
        .orderBy('timestamp', 'asc')
    }

    messageDocs = (await msgsRef.limit(500).get()).docs
  }
  catch (e: any) {
    const msg = String(e?.message || '')
    const code = Number(e?.code || 0)
    const isMissingIndex = code === 9 && /requires an index/i.test(msg)
    if (!isMissingIndex) throw e
    console.warn('[timeline] message window query missing index, using fallback:', msg.slice(0, 280))
    const snap = await msgCol.orderBy('timestamp', 'desc').limit(500).get()
    messageDocs = snap.docs
      .filter((d) => {
        const t = toMillis(d.data().timestamp)
        return t >= openMs && t <= closeMs
      })
      .reverse()
  }

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

  for (const d of messageDocs) {
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
  items.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp))

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
