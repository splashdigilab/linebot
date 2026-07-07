/**
 * 知識卡 (knowledgeChunks) 的服務層：建立 / 更新 / 重新索引 / 刪除。
 *
 * 設計重點：
 * - Collection 走「top-level + workspaceId 欄位」與既有 autoReplies/conversations 一致
 * - 寫入流程：先寫 pending → 同步呼叫 embed → 成功 indexed / 失敗 failed
 * - 同步寫入時間預期 ~300-500ms（Gemini embed ~200ms + Firestore 2 次寫入）
 * - 排程任務會掃 pending 太久或 failed 的卡重新嘗試
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { embedDocument, estimateTokens } from './gemini'
import { recordAiUsage } from './ai-usage'
import type { KnowledgeChunkDoc, KnowledgeChunkStatus } from '~~/shared/types/ai-knowledge'

export const KNOWLEDGE_CHUNKS_COLLECTION = 'knowledgeChunks'

/** pending 卡超過此時間就算「卡住」，會被排程任務撿回來重試 */
export const PENDING_STUCK_MS = 5 * 60 * 1000

/** 排程自動重試上限；超過代表非暫時性錯誤（內容問題等），停止無限重試燒 API。手動 reindex 不受限 */
export const MAX_AUTO_RETRIES = 5

export interface ChunkInput {
  title: string
  content: string
  tags: string[]
  /**
   * 「客人常見問法」（LLM 切卡 / normalize 時生成），會一併進 embedding 拉高
   * query-card 相似度。undefined = 呼叫端沒提供（編輯表單沒有此欄位），保留既有值。
   */
  questions?: string[]
  sourceId?: string | null
  /** 是否為列表頁合成的「總覽卡」（見 KnowledgeChunkDoc.isOverview） */
  isOverview?: boolean
}

export function normalizeChunkInput(raw: any): ChunkInput {
  return {
    title: String(raw?.title ?? '').trim(),
    content: String(raw?.content ?? '').trim(),
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String).map((t: string) => t.trim()).filter(Boolean) : [],
    questions: Array.isArray(raw?.questions)
      ? raw.questions.map(String).map((q: string) => q.trim()).filter(Boolean).slice(0, 3)
      : undefined,
    sourceId: raw?.sourceId != null ? String(raw.sourceId).trim() || null : null,
    isOverview: raw?.isOverview === true,
  }
}

export function validateChunkInput(input: ChunkInput): string | null {
  if (!input.title) return '請輸入標題'
  if (!input.content) return '請輸入內容'
  if (input.content.length > 5000) return '內容過長（上限 5000 字）'
  return null
}

/**
 * 組出實際被 embed 的文字：title + 常見問法 + content。
 * - title：切卡規則把核心識別資訊（品名等）放在 title，content 不一定會重複，
 *   只 embed content 會讓「客人用品名提問」撈不到卡。
 * - questions：客人是用問句提問、卡片是敘述句；把「常見問法」一起進向量
 *   能直接拉高 query-card 相似度（比調 grounding 門檻有效）。
 */
export function buildEmbeddingText(title: string, content: string, questions?: string[]): string {
  const parts = [
    String(title || '').trim(),
    ...(questions ?? []).map(q => String(q).trim()).filter(Boolean),
    String(content || '').trim(),
  ]
  return parts.filter(Boolean).join('\n')
}

interface CreateChunkParams extends ChunkInput {
  workspaceId: string
  chunkId: string
  /**
   * 批次呼叫端(bulk-create 等)設 true:跳過每卡一次的 embedding 記帳,
   * 由呼叫端用回傳的 embeddingTokens 加總、整批記一次(避免打爆單一月用量文件)。
   */
  skipUsageRecording?: boolean
}

/**
 * 建立一張知識卡並嘗試索引。回傳最終狀態。
 * 流程：寫 pending → embed → 寫 indexed/failed。失敗不會 throw，會回 failed。
 */
export async function createKnowledgeChunk(
  db: Firestore,
  params: CreateChunkParams,
): Promise<{ id: string; status: KnowledgeChunkStatus; failureReason?: string; embeddingTokens: number }> {
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(params.chunkId)
  const now = FieldValue.serverTimestamp()

  await ref.set({
    workspaceId: params.workspaceId,
    title: params.title,
    content: params.content,
    tags: params.tags,
    questions: params.questions ?? [],
    isOverview: params.isOverview === true,
    embedding: null,
    tokens: estimateTokens(params.content),
    status: 'pending',
    sourceId: params.sourceId ?? null,
    lastIndexedAt: null,
    manuallyEditedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<KnowledgeChunkDoc, 'createdAt' | 'updatedAt'> & { createdAt: any; updatedAt: any })

  invalidateTagIndexCache(params.workspaceId)
  return runIndexOnChunk(
    db,
    params.chunkId,
    buildEmbeddingText(params.title, params.content, params.questions),
    params.skipUsageRecording ? undefined : params.workspaceId,
  )
}

interface UpdateChunkParams extends Omit<ChunkInput, 'tags'> {
  chunkId: string
  /**
   * 標籤；undefined = 呼叫端沒提供 → 保留既有標籤（同 questions）。
   * re-sync 補問法時某卡沒補到 tags 就傳 undefined，避免把先前補好的標籤洗成空陣列。
   */
  tags?: string[]
  /** title 或 content 有變就要重新索引（兩者都會進 embedding）；只改標籤可跳過 */
  contentChanged: boolean
  /**
   * 是否為「使用者手動編輯」（非 re-sync 自動覆蓋）。
   * true：寫 manuallyEditedAt = now，之後 re-sync 預設保留此卡
   * false：不動 manuallyEditedAt（給 re-sync 用）
   */
  manualEdit?: boolean
}

/**
 * 更新知識卡。若內容變動則重新索引；只改標題/標籤則保留現有 embedding。
 */
export async function updateKnowledgeChunk(
  db: Firestore,
  params: UpdateChunkParams,
): Promise<{ status: KnowledgeChunkStatus; failureReason?: string }> {
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(params.chunkId)
  const now = FieldValue.serverTimestamp()

  // 單次前置讀：status（早退分支回傳用）、既有 questions（沿用 / 比對是否變更）、workspaceId（tag cache 失效用）
  const snap = await ref.get()
  const existing = snap.data() ?? {}
  const existingQuestions: string[] = Array.isArray(existing.questions) ? existing.questions.map(String) : []
  const questions = params.questions ?? existingQuestions
  // questions 也在 embedding 文字裡：有提供且與既有不同，就算 content 沒變也要重新索引，
  // 否則 doc 上的 questions 與向量會永久分歧
  const questionsChanged = params.questions !== undefined
    && JSON.stringify(params.questions) !== JSON.stringify(existingQuestions)
  const needsReindex = params.contentChanged || questionsChanged

  const baseUpdate: Record<string, unknown> = {
    title: params.title,
    content: params.content,
    updatedAt: now,
  }
  // tags / questions 都採「undefined = 保留既有值」：re-sync 補問法時某卡沒補到，
  // 就不要帶欄位，才不會把先前補好的洗成空陣列。
  if (params.tags !== undefined) {
    baseUpdate.tags = params.tags
  }
  if (params.questions !== undefined) {
    baseUpdate.questions = params.questions
  }
  if (params.manualEdit) {
    baseUpdate.manuallyEditedAt = now
  }

  if (typeof existing.workspaceId === 'string') {
    invalidateTagIndexCache(existing.workspaceId)
  }

  if (!needsReindex) {
    await ref.update(baseUpdate)
    return { status: (existing.status as KnowledgeChunkStatus) ?? 'pending' }
  }

  // 內容（或 questions）變動：先標 pending、清掉舊向量，再跑 embed
  await ref.update({
    ...baseUpdate,
    embedding: null,
    tokens: estimateTokens(params.content),
    status: 'pending',
    lastIndexedAt: null,
    failureReason: FieldValue.delete(),
  })

  return runIndexOnChunk(
    db,
    params.chunkId,
    buildEmbeddingText(params.title, params.content, questions),
    typeof existing.workspaceId === 'string' ? existing.workspaceId : undefined,
  )
}

/**
 * 對單一卡跑 embedding。供 create / update / 排程 retry 共用。
 * embeddingText 請用 buildEmbeddingText(title, content, questions) 組出。
 * 不會 throw：embed 失敗就把卡標成 failed 並寫入失敗原因。
 * workspaceId 有帶時把 embedding token 記入月用量（匯入/重建不入帳的話 quota 形同可繞過）。
 * **批次呼叫端（reindex-all、排程 retry）請不要帶 workspaceId**：每卡一寫會對同一份
 * 月用量文件連打（Firestore 單文件 ~1 write/s 建議值），被節流的寫入會靜默漏記——
 * 改用回傳的 embeddingTokens 自行加總、每批記一次。
 */
export async function runIndexOnChunk(
  db: Firestore,
  chunkId: string,
  embeddingText: string,
  workspaceId?: string,
): Promise<{ id: string; status: KnowledgeChunkStatus; failureReason?: string; embeddingTokens: number }> {
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(chunkId)
  const embeddingTokens = estimateTokens(embeddingText)
  try {
    const values = await embedDocument(embeddingText)
    await ref.update({
      embedding: FieldValue.vector(values),
      status: 'indexed' satisfies KnowledgeChunkStatus,
      lastIndexedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      failureReason: FieldValue.delete(),
      retryCount: FieldValue.delete(),
    })
    if (workspaceId) {
      // fire-and-forget：記帳失敗不影響索引結果（recordAiUsage 內部已吞錯）
      void recordAiUsage(workspaceId, { embeddingTokens }, db)
    }
    return { id: chunkId, status: 'indexed', embeddingTokens }
  }
  catch (err: any) {
    const reason = String(err?.statusMessage || err?.message || 'embed failed').slice(0, 300)
    await ref.update({
      status: 'failed' satisfies KnowledgeChunkStatus,
      failureReason: reason,
      retryCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    return { id: chunkId, status: 'failed', failureReason: reason, embeddingTokens: 0 }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Vector search
// ═══════════════════════════════════════════════════════════════════

export interface SimilarChunk {
  id: string
  title: string
  content: string
  tags: string[]
  /** 0–1，越高越相似（由 cosine distance 換算：max(0, 1 - distance)） */
  similarity: number
  /** 來源 ID（同來源切出來的多 chunk 用此 dedupe） */
  sourceId: string | null
  /** 是否為列表頁合成的「總覽卡」；答題端據此跳過反問澄清 */
  isOverview: boolean
}

/**
 * 在指定工作區裡用向量搜尋找最相似的 K 張卡。
 * 用 Firestore Vector Search（findNearest），前置篩選 workspaceId + status='indexed'。
 *
 * 注意：firestore.indexes.json 必須已部署對應的 vector index，否則會 throw。
 */
export async function searchSimilarChunks(
  db: Firestore,
  workspaceId: string,
  queryEmbedding: number[],
  topK = 5,
): Promise<SimilarChunk[]> {
  const baseRef = db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('status', '==', 'indexed')

  // findNearest 接受 number[] 或 VectorValue
  const vectorQuery = baseRef.findNearest({
    vectorField: 'embedding',
    queryVector: FieldValue.vector(queryEmbedding),
    limit: topK,
    distanceMeasure: 'COSINE',
    distanceResultField: '_distance',
  } as any)

  const snap = await vectorQuery.get()
  return snap.docs.map((doc) => {
    const data = doc.data() as any
    const distance = Number(data?._distance ?? 1)
    const similarity = Math.max(0, 1 - distance)
    return {
      id: doc.id,
      title: String(data?.title ?? ''),
      content: String(data?.content ?? ''),
      tags: Array.isArray(data?.tags) ? data.tags : [],
      similarity,
      sourceId: data?.sourceId ?? null,
      isOverview: data?.isOverview === true,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════
//  Identifier-tag exact match（向量檢索的精確補位）
//
//  切卡規則把品號 / SKU 放在 tags（例：「品號21070909」），而 embedding 對這類
//  識別碼幾乎沒有訊號 — 客人拿品號提問會 no_grounding。這裡用「英數字串 ≥ 4 碼」
//  的精確比對把這類查詢救回來：query 與 tag 共享同一段識別碼 run 即命中。
//  只比對識別碼 run、不比對一般中文標籤，避免「運費」這類通用詞誤觸發高信心。
// ═══════════════════════════════════════════════════════════════════

/** tag 精確命中視為高信心來源（高於一般 confidence 門檻，會直接過 grounding） */
export const TAG_MATCH_SIMILARITY = 0.95

const TAG_INDEX_TTL_MS = 60_000
const TAG_INDEX_MAX_DOCS = 2000
const tagIndexCache = new Map<string, {
  expiresAt: number
  entries: Array<{ id: string; runs: string[] }>
}>()

export function invalidateTagIndexCache(workspaceId: string) {
  tagIndexCache.delete(workspaceId)
}

/**
 * 抽出識別碼候選：連續英數 ≥ 4 碼且**至少含一個數字**（品號、型號、訂單編號都有數字），統一小寫。
 * 不含數字的 run（'line'、'mail'、'ipad' 這類一般單字）排除——否則 tag「LINE Pay」會讓
 * 任何提到 LINE 的提問以 0.95 信心繞過 grounding / confidence 兩道護欄。
 */
export function extractIdentifierRuns(text: string): string[] {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter(run => /\d/.test(run))
}

async function loadTagIndex(db: Firestore, workspaceId: string) {
  const cached = tagIndexCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.entries

  const snap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('status', '==', 'indexed')
    .select('tags')
    .limit(TAG_INDEX_MAX_DOCS)
    .get()

  const entries = snap.docs
    .map((d) => {
      const tags: string[] = Array.isArray(d.data()?.tags) ? d.data().tags.map(String) : []
      return { id: d.id, runs: tags.flatMap(extractIdentifierRuns) }
    })
    .filter(e => e.runs.length > 0)

  tagIndexCache.set(workspaceId, { expiresAt: Date.now() + TAG_INDEX_TTL_MS, entries })
  return entries
}

/**
 * 用「識別碼精確比對」找卡。query 沒有任何英數 run 時零成本直接回空陣列
 * （純中文提問完全不會多花 Firestore 讀取）。
 */
export async function searchChunksByIdentifierTag(
  db: Firestore,
  workspaceId: string,
  query: string,
  maxHits = 3,
): Promise<SimilarChunk[]> {
  const queryRuns = new Set(extractIdentifierRuns(query))
  if (!queryRuns.size) return []

  const index = await loadTagIndex(db, workspaceId)
  const matchedIds = index
    .filter(e => e.runs.some(r => queryRuns.has(r)))
    .slice(0, maxHits)
    .map(e => e.id)
  if (!matchedIds.length) return []

  const refs = matchedIds.map(id => db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(id))
  const snaps = await db.getAll(...refs)
  return snaps
    .filter(s => s.exists && s.data()?.status === 'indexed')
    .map((s) => {
      const data = s.data() as any
      return {
        id: s.id,
        title: String(data?.title ?? ''),
        content: String(data?.content ?? ''),
        tags: Array.isArray(data?.tags) ? data.tags : [],
        similarity: TAG_MATCH_SIMILARITY,
        sourceId: data?.sourceId ?? null,
        isOverview: data?.isOverview === true,
      }
    })
}

/**
 * 撿出 pending 卡住或 failed 的卡片，逐張重試。供排程任務呼叫。
 * 回傳掃到 / 重試 / 成功 / 失敗 的計數。
 */
export async function retryStuckChunks(
  db: Firestore,
  opts: { maxBatch?: number; pendingStuckMs?: number } = {},
): Promise<{ scanned: number; retried: number; indexed: number; failed: number; skippedPermanent: number }> {
  const maxBatch = opts.maxBatch ?? 20
  const stuckMs = opts.pendingStuckMs ?? PENDING_STUCK_MS
  const cutoff = new Date(Date.now() - stuckMs)

  // 撿 failed。必須在查詢層就排除 retryCount 達上限的卡：只靠撈出後 skip 的話，
  // 全平台累積 ≥maxBatch 張永久失敗卡（一份爛 PDF 就夠）後，每次撈到的都是同一批
  // skippedPermanent，其他租戶的暫時性失敗卡永遠排不進 batch（餓死）。
  // 註：failed 卡必有 retryCount（runIndexOnChunk 失敗路徑 increment 產生），
  // 不會因 Firestore 不等式排除缺欄位文件而漏撈。需要 (status, retryCount) 複合索引。
  const failedSnap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('status', '==', 'failed')
    .where('retryCount', '<', MAX_AUTO_RETRIES)
    .limit(maxBatch)
    .get()

  // 撿 pending 太久
  const pendingSnap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('status', '==', 'pending')
    .where('updatedAt', '<', cutoff)
    .limit(maxBatch)
    .get()

  const docs = [...failedSnap.docs, ...pendingSnap.docs]
  const seen = new Set<string>()
  let indexed = 0
  const tokensByWorkspace = new Map<string, number>()
  let failed = 0
  let skippedPermanent = 0
  for (const doc of docs) {
    if (seen.has(doc.id)) continue
    seen.add(doc.id)
    const data = doc.data()

    // 連續失敗超過上限 → 非暫時性錯誤（內容問題等），停止自動重試。
    // 卡片維持 failed 狀態，使用者手動 reindex 仍可重試（成功會歸零 retryCount）。
    if (Number(data?.retryCount ?? 0) >= MAX_AUTO_RETRIES) {
      skippedPermanent++
      continue
    }

    const content = String(data?.content ?? '')
    if (!content) {
      failed++
      continue
    }
    // 不帶 workspaceId:批次迴圈每卡一寫會打爆單一月用量文件,改累計、迴圈後每 workspace 一寫
    const result = await runIndexOnChunk(db, doc.id, buildEmbeddingText(
      String(data?.title ?? ''),
      content,
      Array.isArray(data?.questions) ? data.questions.map(String) : [],
    ))
    if (result.status === 'indexed') {
      indexed++
      const ws = typeof data?.workspaceId === 'string' ? data.workspaceId : ''
      if (ws) tokensByWorkspace.set(ws, (tokensByWorkspace.get(ws) ?? 0) + result.embeddingTokens)
    }
    else {
      failed++
    }
  }

  // 每個 workspace 記一次帳(排程跨租戶,不能混在同一份文件)
  for (const [ws, tokens] of tokensByWorkspace) {
    if (tokens > 0) await recordAiUsage(ws, { embeddingTokens: tokens }, db)
  }

  return { scanned: docs.length, retried: seen.size - skippedPermanent, indexed, failed, skippedPermanent }
}
