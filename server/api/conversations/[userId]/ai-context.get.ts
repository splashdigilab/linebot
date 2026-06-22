import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import { lineUserFirestoreDocId, lineUserIdFromFirestoreDocId } from '~~/shared/line-workspace'
import type { AiConversationMeta } from '~~/shared/types/ai-knowledge'

interface AiContextResponse {
  hasMeta: boolean
  lastDecision: AiConversationMeta['lastDecision'] | ''
  lastConfidence: number
  lastHandoffReason: AiConversationMeta['lastHandoffReason']
  lastQuery: string
  suggestedReply: string
  handoffSummary: string
  sources: Array<{ chunkId: string; title: string }>
  updatedAtMs: number
}

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

/**
 * GET /api/conversations/:userId/ai-context
 *
 * 回傳該對話最近一次 AI 介入的脈絡。Phase 4 真人收件匣側欄消費。
 * sources 會 hydrate 為知識卡標題（不回傳內容，避免 payload 過大）。
 */
export default defineEventHandler(async (event): Promise<AiContextResponse> => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const userIdRaw = String(getRouterParam(event, 'userId') ?? '').trim()
  if (!userIdRaw) throw createError({ statusCode: 400, statusMessage: 'userId required' })

  const db = getDb()
  const lineUserId = lineUserIdFromFirestoreDocId(userIdRaw, workspaceId)
  const convDocId = lineUserFirestoreDocId(lineUserId, workspaceId)
  const snap = await db.collection('conversations').doc(convDocId).get()

  const empty: AiContextResponse = {
    hasMeta: false,
    lastDecision: '',
    lastConfidence: 0,
    lastHandoffReason: null,
    lastQuery: '',
    suggestedReply: '',
    handoffSummary: '',
    sources: [],
    updatedAtMs: 0,
  }
  if (!snap.exists) return empty

  const data = snap.data() as { workspaceId?: string; aiMeta?: AiConversationMeta }
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }
  const meta = data.aiMeta
  if (!meta) return empty

  const ids: string[] = Array.isArray(meta.lastSourceChunkIds) ? meta.lastSourceChunkIds.slice(0, 5) : []
  const titleByChunkId: Record<string, string> = {}
  if (ids.length) {
    const docs = await Promise.all(
      ids.map(id => db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(id).get().catch(() => null)),
    )
    docs.forEach((d, i) => {
      if (d?.exists) {
        const cd = d.data() as { workspaceId?: string; title?: string }
        if (cd?.workspaceId === workspaceId) titleByChunkId[ids[i]!] = String(cd.title ?? '')
      }
    })
  }

  return {
    hasMeta: true,
    lastDecision: meta.lastDecision,
    lastConfidence: Number(meta.lastConfidence ?? 0),
    lastHandoffReason: meta.lastHandoffReason ?? null,
    lastQuery: String(meta.lastQuery ?? ''),
    suggestedReply: String(meta.suggestedReply ?? ''),
    handoffSummary: String(meta.handoffSummary ?? ''),
    sources: ids.map(id => ({ chunkId: id, title: titleByChunkId[id] ?? '(卡片已刪除)' })),
    updatedAtMs: tsToMs(meta.updatedAt),
  }
})
