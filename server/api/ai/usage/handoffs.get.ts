import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { KNOWLEDGE_CHUNKS_COLLECTION } from '~~/server/utils/ai-knowledge-chunks'
import { HANDOFF_REASON_LABELS } from '~~/shared/types/ai-knowledge'
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

  // 若指定特定 handoff 原因，改用 lastHandoffReason 查詢（對應 indexes.json 的 composite index）。
  // 注意:lastDecision 條件此時無法進查詢(會需要三欄複合索引),改在記憶體過濾——
  // 否則「還在等客人確認、實際沒轉接」的 handoff_confirm 會混進清單。
  // 白名單由共用標籤表導出(手抄第二份會漂移:新 reason 加了前端卻漏這裡,
  // 篩選會靜默變成回全量);'manual' 是內部人工指定,不開放篩選。
  const VALID_REASONS = new Set(Object.keys(HANDOFF_REASON_LABELS).filter(k => k !== 'manual'))
  const reasonFiltered = VALID_REASONS.has(reason)
  if (reasonFiltered) {
    q = db.collection('conversations')
      .where('workspaceId', '==', workspaceId)
      .where('aiMeta.lastHandoffReason', '==', reason)
  }

  // resolved 與 lastDecision 過濾都在記憶體做,會吃掉查詢名額:只要任一種記憶體過濾
  // 會發生（未含已處理、或帶 reason 篩選）就多抓幾倍再 filter + slice,
  // 避免「前 N 筆都被濾掉」讓頁面短少、更舊的真實案例被遮住
  const hasMemoryFilter = !includeResolved || reasonFiltered
  const fetchLimit = hasMemoryFilter ? Math.min(100, limit * 3) : limit
  const snap = await q.orderBy('aiMeta.updatedAt', 'desc').limit(fetchLimit).get()

  // Hydrate chunk titles（一次撈完，避免每列再打）
  const allChunkIds = new Set<string>()
  snap.docs.forEach((d) => {
    const meta = (d.data() as { aiMeta?: AiConversationMeta }).aiMeta
    meta?.lastSourceChunkIds?.forEach(id => allChunkIds.add(id))
  })
  const titleByChunkId: Record<string, string> = {}
  if (allChunkIds.size) {
    // getAll 一次批次讀,取代逐筆 doc().get()(最多 100 對話 × 數個 chunkId 的往返)。
    // 批次失敗是全有全無——不能直接回空陣列,否則一次抖動會讓每列都顯示「(卡片已刪除)」;
    // 退回逐筆讀當 fallback,只損失個別文件
    const refs = Array.from(allChunkIds).map(id => db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(id))
    const chunkDocs = await db.getAll(...refs)
      .catch(() => Promise.all(refs.map(r => r.get().catch(() => null))))
    chunkDocs.forEach((d) => {
      if (d?.exists) {
        const cd = d.data() as { workspaceId?: string; title?: string }
        if (cd?.workspaceId === workspaceId) titleByChunkId[d.id] = String(cd.title ?? '')
      }
    })
  }

  const rows = snap.docs
    // reason 查詢時 lastDecision 沒進 where:排除 handoff_confirm(等確認中)等非真正轉接的狀態
    .filter(d => !reasonFiltered || ((d.data() as { aiMeta?: AiConversationMeta }).aiMeta?.lastDecision === 'handoff'))
    .map((d) => {
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
