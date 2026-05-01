import { FieldValue } from 'firebase-admin/firestore'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './firebase'
import type {
  ConversationEventType,
  ConversationStatus,
  InitialHandler,
  ModuleType,
} from '~~/shared/types/conversation-stats'
import { SESSION_24H_MS } from '~~/shared/types/conversation-stats'

// ── Event Recording ───────────────────────────────────────────────

export async function recordConversationEvent(
  sessionId: string,
  userId: string,
  eventType: ConversationEventType,
  extras?: { moduleType?: ModuleType; moduleId?: string },
): Promise<void> {
  const db = getDb()
  const eventRef = db.collection('conversationEvents').doc()
  await eventRef.set({
    sessionId,
    userId,
    eventType,
    ...(extras?.moduleType ? { moduleType: extras.moduleType } : {}),
    ...(extras?.moduleId ? { moduleId: extras.moduleId } : {}),
    timestamp: FieldValue.serverTimestamp(),
  })
}

// ── Session Lifecycle ─────────────────────────────────────────────

/**
 * Get or create the active conversation session for a user.
 * Creates a new session if:
 * - No current session exists
 * - Current session is closed
 * - >= 24h since last activity (the previous open session is closed first so stats stay correct)
 */
export async function ensureConversationSession(userId: string): Promise<string> {
  const db = getDb()
  const convRef = db.collection('conversations').doc(userId)
  const convSnap = await convRef.get()
  const convData = convSnap.data()
  const now = Date.now()

  if (convData?.currentSessionId) {
    const sessionRef = db.collection('conversationSessions').doc(convData.currentSessionId)
    const sessionSnap = await sessionRef.get()
    const session = sessionSnap.data()

    if (session && session.status !== 'closed') {
      const lastActivity: number = session.lastActivityAt?.toMillis?.() ?? 0
      if (now - lastActivity < SESSION_24H_MS) {
        await sessionRef.update({ lastActivityAt: FieldValue.serverTimestamp() })
        return convData.currentSessionId as string
      }
      await closeConversationSession(convData.currentSessionId as string, userId)
    }
  }

  const sessionId = uuidv4()
  await db.collection('conversationSessions').doc(sessionId).set({
    userId,
    openedAt: FieldValue.serverTimestamp(),
    closedAt: null,
    lastActivityAt: FieldValue.serverTimestamp(),
    status: 'open' as ConversationStatus,
    initialHandler: 'unhandled' as InitialHandler,
    currentHandler: 'unhandled' as InitialHandler,
    initialModuleType: null,
    currentModuleType: null,
    hasHandoff: false,
    handoffRequestedAt: null,
    humanFirstRepliedAt: null,
  })

  await convRef.set({ currentSessionId: sessionId }, { merge: true })
  await recordConversationEvent(sessionId, userId, 'conversation_opened')

  return sessionId
}

/**
 * Record that a module was entered in the current session.
 * Updates initial/current handler and status accordingly.
 * system_notice entries do NOT count toward initialHandler.
 */
export async function enterModule(
  sessionId: string,
  userId: string,
  moduleType: ModuleType,
  moduleId?: string,
): Promise<void> {
  const db = getDb()
  const sessionRef = db.collection('conversationSessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return

  const session = sessionSnap.data() as any
  const updates: Record<string, any> = {
    currentModuleType: moduleType,
    lastActivityAt: FieldValue.serverTimestamp(),
  }

  const hasInitial = session.initialModuleType !== null && session.initialModuleType !== undefined

  // system_notice never counts as initial handler
  if (!hasInitial && moduleType !== 'system_notice') {
    updates.initialModuleType = moduleType
    if (moduleType === 'live_agent') {
      updates.initialHandler = 'human'
      updates.currentHandler = 'human'
    } else {
      updates.initialHandler = 'bot'
      updates.currentHandler = 'bot'
    }
  }

  // Status transitions
  if (moduleType === 'live_agent') {
    updates.currentHandler = 'human'
    if (session.status !== 'human_handling') {
      updates.status = 'pending_human'
    }
  } else if (moduleType === 'welcome' || moduleType === 'bot_flow') {
    updates.currentHandler = 'bot'
    if (session.status === 'open' || session.status === 'pending_human') {
      updates.status = 'bot_handling'
    }
  }

  // Record handoff_request on first live_agent entry
  const isNewHandoff = moduleType === 'live_agent' && !session.hasHandoff
  if (isNewHandoff) {
    updates.hasHandoff = true
    updates.handoffRequestedAt = FieldValue.serverTimestamp()
  }

  await sessionRef.update(updates)
  await recordConversationEvent(sessionId, userId, 'entered_module', { moduleType, moduleId })
  if (isNewHandoff) {
    await recordConversationEvent(sessionId, userId, 'handoff_request')
  }
}

/**
 * Record a human agent's first reply in a session (after handoff).
 * Idempotent: only fires once per session.
 */
export async function recordHumanFirstReply(sessionId: string, userId: string): Promise<void> {
  const db = getDb()
  const sessionRef = db.collection('conversationSessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return

  const session = sessionSnap.data() as any
  if (session.humanFirstRepliedAt) return

  await sessionRef.update({
    humanFirstRepliedAt: FieldValue.serverTimestamp(),
    status: 'human_handling' as ConversationStatus,
    currentHandler: 'human' as InitialHandler,
    currentModuleType: 'live_agent' as ModuleType,
    lastActivityAt: FieldValue.serverTimestamp(),
  })
  await recordConversationEvent(sessionId, userId, 'human_first_reply')
}

/**
 * Close a conversation session. Idempotent.
 */
export async function closeConversationSession(sessionId: string, userId: string): Promise<void> {
  const db = getDb()
  const sessionRef = db.collection('conversationSessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return

  const session = sessionSnap.data() as any
  if (session.status === 'closed') return

  await sessionRef.update({
    status: 'closed' as ConversationStatus,
    closedAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
  })
  await db.collection('conversations').doc(userId).set(
    { currentSessionId: null },
    { merge: true },
  )
  await recordConversationEvent(sessionId, userId, 'conversation_closed')
}

/**
 * Update lastActivityAt when an outgoing message is sent by human agent.
 * Also promotes pending_human → human_handling on first human reply.
 */
export async function onHumanOutgoingMessage(userId: string): Promise<void> {
  const db = getDb()
  const convSnap = await db.collection('conversations').doc(userId).get()
  const sessionId = convSnap.data()?.currentSessionId as string | undefined
  if (!sessionId) return

  const sessionSnap = await db.collection('conversationSessions').doc(sessionId).get()
  const session = sessionSnap.data()
  if (!session || session.status === 'closed') return

  if (session.status === 'pending_human' && !session.humanFirstRepliedAt) {
    await recordHumanFirstReply(sessionId, userId)
  } else {
    await db.collection('conversationSessions').doc(sessionId).update({
      lastActivityAt: FieldValue.serverTimestamp(),
    })
  }
}
