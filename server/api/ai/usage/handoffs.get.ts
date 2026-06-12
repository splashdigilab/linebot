import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import type { AiConversationMeta } from '~~/shared/types/ai-knowledge'

interface HandoffRow {
  userId: string
  displayName: string
  lastQuery: string
  lastConfidence: number
  handoffReason: AiConversationMeta['lastHandoffReason']
  sources: Array<{ chunkId: string; title: string }>
  updatedAtMs: number
  /** 已被標記處理（resolvedAt >= updatedAt） */
  resolved: boolean
}

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

/**
 * GET /api/ai/usage/handoffs?limit=20&reason=low_confidence|no_grounding|any
 *
 * 列出最近被 AI 轉真人的對話（包含使用者原問與當時命中的卡）。
 * 監控頁的「補知識」入口；點進去可以看完整對話、或在知識庫補一張對應卡。
 */
export default defineEventHandler(async (event): Promise<HandoffRow[]> => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const query = getQuery(event)
  const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)))
  const reason = String(query.reason ?? '').trim()

  const includeResolved = String(query.includeResolved ?? '') === '1'

  const db = getDb()
  let q: FirebaseFirestore.Query = db.collection('conversations')
    .where('workspaceId', '==', workspaceId)
    .where('aiMeta.lastDecision', '==', 'handoff')

  // 若指定特定 handoff 原因，多加一條 where（要對應到 indexes.json 的 composite index）
  if (reason === 'low_confidence' || reason === 'no_grounding' || reason === 'user_request') {
    q = db.collection('conversations')
      .where('workspaceId', '==', workspaceId)
      .where('aiMeta.lastHandoffReason', '==', reason)
  }

  // resolved 過濾在記憶體做：已處理的會佔掉名額，所以多抓幾倍再 filter + slice，
  // 避免「前 N 筆全是已處理」讓更舊的未處理案例被完全遮住
  const fetchLimit = includeResolved ? limit : Math.min(100, limit * 3)
  const snap = await q.orderBy('aiMeta.updatedAt', 'desc').limit(fetchLimit).get()

  // Hydrate chunk titles（一次撈完，避免每列再打）
  const allChunkIds = new Set<string>()
  snap.docs.forEach((d) => {
    const meta = (d.data() as { aiMeta?: AiConversationMeta }).aiMeta
    meta?.lastSourceChunkIds?.forEach(id => allChunkIds.add(id))
  })
  const titleByChunkId: Record<string, string> = {}
  if (allChunkIds.size) {
    const chunkDocs = await Promise.all(
      Array.from(allChunkIds).map(id =>
        db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(id).get().catch(() => null),
      ),
    )
    chunkDocs.forEach((d) => {
      if (d?.exists) {
        const cd = d.data() as { workspaceId?: string; title?: string }
        if (cd?.workspaceId === workspaceId) titleByChunkId[d.id] = String(cd.title ?? '')
      }
    })
  }

  const rows = snap.docs.map((d) => {
    const data = d.data() as { aiMeta?: AiConversationMeta; userId?: string; displayName?: string }
    const meta = data.aiMeta!
    const updatedAtMs = tsToMs(meta.updatedAt)
    const resolvedAtMs = tsToMs(meta.handoffResolvedAt)
    return {
      userId: String(data.userId ?? d.id),
      displayName: String(data.displayName ?? ''),
      lastQuery: String(meta.lastQuery ?? ''),
      lastConfidence: Number(meta.lastConfidence ?? 0),
      handoffReason: meta.lastHandoffReason ?? null,
      sources: (meta.lastSourceChunkIds ?? []).map(id => ({
        chunkId: id,
        title: titleByChunkId[id] ?? '(卡片已刪除)',
      })),
      updatedAtMs,
      resolved: resolvedAtMs > 0 && resolvedAtMs >= updatedAtMs,
    }
  })

  // 預設只回未處理的案例；includeResolved=1 連已處理的一起回
  return (includeResolved ? rows : rows.filter(r => !r.resolved)).slice(0, limit)
})
