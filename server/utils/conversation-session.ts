import { FieldValue } from 'firebase-admin/firestore'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './firebase'
import { DEFAULT_LINE_WORKSPACE_ID, lineUserFirestoreDocId, lineUserIdFromFirestoreDocId } from '~~/shared/line-workspace'
import type {
  ConversationEventType,
  ConversationStatus,
  InitialHandler,
  ModuleType,
} from '~~/shared/types/conversation-stats'
import { SESSION_24H_MS } from '~~/shared/types/conversation-stats'

// ── Session In-Memory Cache ───────────────────────────────────────
// Avoids running a Firestore transaction on every single webhook event.
// Common path: active session within 24h → return cached ID, update lastActivityAt in background.
// TTL is intentionally short (10s) to limit stale-status window when admin changes session state.

interface SessionCacheEntry {
  sessionId: string
  status: ConversationStatus
  lastActivityAt: number  // JS ms timestamp
  cachedAt: number
}
const SESSION_CACHE_TTL_MS = 10 * 1000
const sessionByUser = new Map<string, SessionCacheEntry>()   // lineUserId → entry
const sessionStatusById = new Map<string, { status: ConversationStatus; cachedAt: number }>() // sessionId → status

export function _updateSessionStatusCache(sessionId: string, status: ConversationStatus) {
  sessionStatusById.set(sessionId, { status, cachedAt: Date.now() })
  // Also update per-user cache if it references this session
  for (const [uid, entry] of sessionByUser) {
    if (entry.sessionId === sessionId) {
      sessionByUser.set(uid, { ...entry, status, cachedAt: Date.now() })
      break
    }
  }
}

export function _invalidateUserSessionCache(lineUserId: string) {
  const entry = sessionByUser.get(lineUserId)
  if (entry) sessionStatusById.delete(entry.sessionId)
  sessionByUser.delete(lineUserId)
}

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
 * Close any non-closed sessions for a user that are not the current active session.
 * Handles orphaned sessions left by race conditions.
 */
async function closeOrphanedSessions(lineUserId: string, currentSessionId: string): Promise<void> {
  const db = getDb()
  const snap = await db
    .collection('conversationSessions')
    .where('userId', '==', lineUserId)
    .where('workspaceId', '==', DEFAULT_LINE_WORKSPACE_ID)
    .get()

  const orphans = snap.docs.filter(d => d.id !== currentSessionId && d.data().status !== 'closed')
  if (orphans.length === 0) return

  const batch = db.batch()
  for (const doc of orphans) {
    batch.update(doc.ref, {
      status: 'closed' as ConversationStatus,
      closedAt: FieldValue.serverTimestamp(),
      lastActivityAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()

  await Promise.all(
    orphans.map(doc =>
      recordConversationEvent(doc.id, lineUserId, 'conversation_closed')
        .catch(e => console.warn('[session] orphan close event failed:', doc.id, e)),
    ),
  )
}

/**
 * Get or create the active conversation session for a user.
 * Creates a new session if:
 * - No current session exists
 * - Current session is closed
 * - >= 24h since last activity (the previous open session is closed first so stats stay correct)
 *
 * Uses a Firestore transaction to prevent duplicate sessions from concurrent webhook calls.
 * After creating a new session, any orphaned non-closed sessions for the same user are also closed.
 */
export async function ensureConversationSession(userId: string): Promise<string> {
  const db = getDb()
  const lineUserId = lineUserIdFromFirestoreDocId(userId)
  const convDocId = lineUserFirestoreDocId(lineUserId)
  const convRef = db.collection('conversations').doc(convDocId)
  const now = Date.now()

  // ── Fast path: active cached session ─────────────────────────────
  // For the common case (user messaging within 24h), skip the Firestore transaction entirely.
  // lastActivityAt is updated in the background so it doesn't block the reply.
  const cached = sessionByUser.get(lineUserId)
  if (
    cached &&
    now - cached.cachedAt < SESSION_CACHE_TTL_MS &&
    cached.status !== 'closed' &&
    now - cached.lastActivityAt < SESSION_24H_MS
  ) {
    db.collection('conversationSessions').doc(cached.sessionId)
      .update({ lastActivityAt: FieldValue.serverTimestamp() })
      .catch(e => console.warn('[session] bg lastActivityAt update failed:', e))
    sessionByUser.set(lineUserId, { ...cached, lastActivityAt: now, cachedAt: now })
    return cached.sessionId
  }

  // ── Slow path: Firestore transaction ─────────────────────────────
  // Pre-generate the new session ID outside the transaction so tx.set() can reference it.
  const newSessionId = uuidv4()
  const newSessionRef = db.collection('conversationSessions').doc(newSessionId)

  let createdNew = false
  let closedOldSessionId: string | null = null
  let resultStatus: ConversationStatus = 'open'

  const resultId = await db.runTransaction(async (tx) => {
    const convSnap = await tx.get(convRef)
    const convData = convSnap.data()

    // Read existing session inside the transaction (prevents concurrent creates).
    let existingRef: FirebaseFirestore.DocumentReference | null = null
    let existingData: FirebaseFirestore.DocumentData | null = null
    if (convData?.currentSessionId) {
      existingRef = db.collection('conversationSessions').doc(convData.currentSessionId as string)
      const existingSnap = await tx.get(existingRef)
      existingData = existingSnap.data() ?? null
    }

    if (existingData && existingData.status !== 'closed' && existingRef) {
      const lastActivity: number = existingData.lastActivityAt?.toMillis?.() ?? 0
      if (now - lastActivity < SESSION_24H_MS) {
        tx.update(existingRef, { lastActivityAt: FieldValue.serverTimestamp() })
        resultStatus = existingData.status as ConversationStatus
        return convData!.currentSessionId as string
      }
      // 24h expired — close inline (event recorded outside the tx)
      tx.update(existingRef, {
        status: 'closed' as ConversationStatus,
        closedAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
      })
      closedOldSessionId = convData!.currentSessionId as string
    }

    tx.set(newSessionRef, {
      workspaceId: DEFAULT_LINE_WORKSPACE_ID,
      userId: lineUserId,
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
    tx.set(convRef, {
      workspaceId: DEFAULT_LINE_WORKSPACE_ID,
      userId: lineUserId,
      currentSessionId: newSessionId,
    }, { merge: true })

    createdNew = true
    return newSessionId
  })

  // Populate both caches with the result of the transaction
  sessionByUser.set(lineUserId, {
    sessionId: resultId,
    status: resultStatus,
    lastActivityAt: now,
    cachedAt: now,
  })
  sessionStatusById.set(resultId, { status: resultStatus, cachedAt: now })

  // Record events and clean up orphans outside the transaction (non-blocking for stats only).
  if (closedOldSessionId) {
    recordConversationEvent(closedOldSessionId, lineUserId, 'conversation_closed')
      .catch(e => console.warn('[session] close event record failed:', e))
  }
  if (createdNew) {
    // Event recording and orphan cleanup are independent — run in parallel, non-blocking
    Promise.all([
      recordConversationEvent(newSessionId, lineUserId, 'conversation_opened'),
      closeOrphanedSessions(lineUserId, newSessionId),
    ]).catch(e => console.warn('[session] post-create cleanup failed:', e))
  }

  return resultId
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
    if (session.status === 'open') {
      updates.status = 'bot_handling'
    }
    // pending_human / human_handling are intentionally not overwritten here
  }

  // Record handoff_request on first live_agent entry
  const isNewHandoff = moduleType === 'live_agent' && !session.hasHandoff
  if (isNewHandoff) {
    updates.hasHandoff = true
    updates.handoffRequestedAt = FieldValue.serverTimestamp()
  }

  await sessionRef.update(updates)

  // Keep status cache in sync after module entry changes session status
  if (updates.status) {
    _updateSessionStatusCache(sessionId, updates.status as ConversationStatus)
  }

  if (moduleType === 'live_agent') {
    const uid = lineUserFirestoreDocId(lineUserIdFromFirestoreDocId(userId))
    await db
      .collection('users')
      .doc(uid)
      .update({ activeInput: FieldValue.delete() })
      .catch((e) => console.warn('[session] clear activeInput on live_agent:', e))
  }
  await recordConversationEvent(sessionId, lineUserIdFromFirestoreDocId(userId), 'entered_module', { moduleType, moduleId })
  if (isNewHandoff) {
    await recordConversationEvent(sessionId, lineUserIdFromFirestoreDocId(userId), 'handoff_request')
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
  _updateSessionStatusCache(sessionId, 'human_handling')
  await recordConversationEvent(sessionId, userId, 'human_first_reply')
}

/**
 * Close a conversation session. Idempotent.
 */
export async function closeConversationSession(sessionId: string, userId: string): Promise<void> {
  const db = getDb()
  const lineUserId = lineUserIdFromFirestoreDocId(userId)
  const convDocId = lineUserFirestoreDocId(lineUserId)
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
  _updateSessionStatusCache(sessionId, 'closed')
  _invalidateUserSessionCache(lineUserId)
  await db.collection('conversations').doc(convDocId).set(
    { currentSessionId: null },
    { merge: true },
  )
  await recordConversationEvent(sessionId, lineUserId, 'conversation_closed')
}

/**
 * 待真人或真人處理中：使用者文字不應再觸發機器人（activeInput、自動回覆含 anyText），
 * 避免與真人客服對話時誤觸「輸入任何內容」等規則。
 */
export async function shouldSuppressInboundBotAutomationForSession(
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!sessionId) return false

  // Use cached status to avoid a redundant DB read (session was just read in ensureConversationSession)
  const now = Date.now()
  const cached = sessionStatusById.get(sessionId)
  if (cached && now - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.status === 'pending_human' || cached.status === 'human_handling'
  }

  const db = getDb()
  const snap = await db.collection('conversationSessions').doc(sessionId).get()
  if (!snap.exists) return false
  const status = snap.data()?.status as ConversationStatus | undefined
  if (status) sessionStatusById.set(sessionId, { status, cachedAt: now })
  return status === 'pending_human' || status === 'human_handling'
}

export async function onHumanOutgoingMessage(userId: string): Promise<void> {
  const db = getDb()
  const convDocId = lineUserFirestoreDocId(lineUserIdFromFirestoreDocId(userId))
  const convSnap = await db.collection('conversations').doc(convDocId).get()
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
