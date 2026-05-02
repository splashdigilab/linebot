import { getDb } from '~~/server/utils/firebase'
import type { ConversationStatus, InitialHandler } from '~~/shared/types/conversation-stats'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

const PAGE_SIZE = 30
const CHUNK = 30
const FALLBACK_MAX_FETCH = 1000

function toMillis(raw: any): number {
  if (!raw) return 0
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw?.toMillis === 'function') return raw.toMillis()
  if (typeof raw?.toDate === 'function') return raw.toDate()?.getTime?.() ?? 0
  const parsed = new Date(raw)
  const t = parsed.getTime()
  return Number.isFinite(t) ? t : 0
}

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const query = getQuery(event)
  const db = getDb()

  const status = String(query.status || 'all')
  const initialHandler = String(query.initialHandler || 'all')
  const hasHandoff = query.hasHandoff === 'true' ? true : query.hasHandoff === 'false' ? false : undefined
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || PAGE_SIZE)))

  const offset = (page - 1) * limit

  const startDate = query.startDate ? new Date(String(query.startDate)) : null
  const endDate = query.endDate ? new Date(String(query.endDate)) : null
  if (endDate) endDate.setHours(23, 59, 59, 999)
  const startMs = startDate ? startDate.getTime() : null
  const endMs = endDate ? endDate.getTime() : null

  // Firestore composite indexes are painful during local dev and can break admin pages.
  // Strategy: try the "ideal" query first; if it fails with FAILED_PRECONDITION (missing index),
  // fall back to a safe query (status-only) and do the rest in memory.
  const runFallback = async () => {
    let safeRef = db.collection('conversationSessions') as FirebaseFirestore.Query
    safeRef = safeRef.where('workspaceId', '==', workspaceId)
    if (status !== 'all') {
      safeRef = safeRef.where('status', '==', status as ConversationStatus)
    }
    safeRef = safeRef.limit(FALLBACK_MAX_FETCH)
    const safeSnap = await safeRef.get()
    if (safeSnap.empty) return { sessions: [], total: 0, page, limit, truncated: false }

    const filtered = safeSnap.docs
      .map(d => ({ id: d.id, data: d.data() as any }))
      .filter(({ data }) => {
        if (initialHandler !== 'all' && data.initialHandler !== initialHandler) return false
        if (hasHandoff !== undefined && Boolean(data.hasHandoff) !== hasHandoff) return false
        const t = toMillis(data.lastActivityAt)
        if (startMs !== null && t < startMs) return false
        if (endMs !== null && t > endMs) return false
        return true
      })
      .sort((a, b) => toMillis(b.data.lastActivityAt) - toMillis(a.data.lastActivityAt))

    const sliced = filtered.slice(offset, offset + limit)
    if (sliced.length === 0) return { sessions: [], total: filtered.length, page, limit, truncated: filtered.length >= FALLBACK_MAX_FETCH }

    const userIds = [...new Set(sliced.map(x => String(x.data.userId || '')).filter(Boolean))]
    const userMap: Record<string, any> = {}
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK)
      const uSnap = await db.collection('users').where('__name__', 'in', chunk).get()
      uSnap.docs.forEach(d => { userMap[d.id] = d.data() })
    }

    const sessions = sliced.map(({ id, data: s }) => {
      const user = userMap[s.userId] ?? {}
      return {
        sessionId: id,
        userId: s.userId,
        displayName: user.displayName ?? s.userId,
        pictureUrl: user.pictureUrl ?? '',
        status: s.status,
        initialHandler: s.initialHandler,
        currentHandler: s.currentHandler,
        initialModuleType: s.initialModuleType,
        currentModuleType: s.currentModuleType,
        hasHandoff: s.hasHandoff,
        openedAt: s.openedAt ?? null,
        closedAt: s.closedAt ?? null,
        lastActivityAt: s.lastActivityAt ?? null,
      }
    })

    return {
      sessions,
      total: filtered.length,
      page,
      limit,
      truncated: filtered.length >= FALLBACK_MAX_FETCH,
    }
  }

  try {
    let ref = db.collection('conversationSessions') as FirebaseFirestore.Query
    ref = ref.where('workspaceId', '==', workspaceId)

    if (status !== 'all') {
      ref = ref.where('status', '==', status as ConversationStatus)
    }
    if (initialHandler !== 'all') {
      ref = ref.where('initialHandler', '==', initialHandler as InitialHandler)
    }
    if (hasHandoff !== undefined) {
      ref = ref.where('hasHandoff', '==', hasHandoff)
    }
    if (startDate) {
      ref = ref.where('lastActivityAt', '>=', startDate)
    }
    if (endDate) {
      ref = ref.where('lastActivityAt', '<=', endDate)
    }

    ref = ref.orderBy('lastActivityAt', 'desc')

    const countSnap = await ref.count().get()
    const total = countSnap.data().count

    if (offset > 0) {
      // Use offset pagination for simplicity (Firestore supports up to 1000)
      ref = ref.offset(offset)
    }
    ref = ref.limit(limit)

    const snap = await ref.get()
    if (snap.empty) return { sessions: [], total, page, limit }

    // Batch-fetch user data
    const userIds = [...new Set(snap.docs.map(d => d.data().userId as string))]
    const userMap: Record<string, any> = {}
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK)
      const uSnap = await db.collection('users').where('__name__', 'in', chunk).get()
      uSnap.docs.forEach(d => { userMap[d.id] = d.data() })
    }

    const sessions = snap.docs.map((d) => {
      const s = d.data()
      const user = userMap[s.userId] ?? {}
      return {
        sessionId: d.id,
        userId: s.userId,
        displayName: user.displayName ?? s.userId,
        pictureUrl: user.pictureUrl ?? '',
        status: s.status,
        initialHandler: s.initialHandler,
        currentHandler: s.currentHandler,
        initialModuleType: s.initialModuleType,
        currentModuleType: s.currentModuleType,
        hasHandoff: s.hasHandoff,
        openedAt: s.openedAt ?? null,
        closedAt: s.closedAt ?? null,
        lastActivityAt: s.lastActivityAt ?? null,
      }
    })

    return { sessions, total, page, limit }
  }
  catch (e: any) {
    const msg = String(e?.message || '')
    const code = Number(e?.code || 0)
    const isMissingIndex = code === 9 && /requires an index/i.test(msg)
    if (isMissingIndex) {
      console.warn('[sessions.get] missing composite index, using fallback query:', msg.slice(0, 300))
      return await runFallback()
    }
    throw e
  }
})
