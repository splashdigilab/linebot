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
import type { KnowledgeChunkDoc, KnowledgeChunkStatus } from '~~/shared/types/ai-knowledge'

export const KNOWLEDGE_CHUNKS_COLLECTION = 'knowledgeChunks'

/** pending 卡超過此時間就算「卡住」，會被排程任務撿回來重試 */
export const PENDING_STUCK_MS = 5 * 60 * 1000

export interface ChunkInput {
  title: string
  content: string
  tags: string[]
  sourceId?: string | null
}

export function normalizeChunkInput(raw: any): ChunkInput {
  return {
    title: String(raw?.title ?? '').trim(),
    content: String(raw?.content ?? '').trim(),
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String).map((t: string) => t.trim()).filter(Boolean) : [],
    sourceId: raw?.sourceId != null ? String(raw.sourceId).trim() || null : null,
  }
}

export function validateChunkInput(input: ChunkInput): string | null {
  if (!input.title) return '請輸入標題'
  if (!input.content) return '請輸入內容'
  if (input.content.length > 5000) return '內容過長（上限 5000 字）'
  return null
}

interface CreateChunkParams extends ChunkInput {
  workspaceId: string
  chunkId: string
}

/**
 * 建立一張知識卡並嘗試索引。回傳最終狀態。
 * 流程：寫 pending → embed → 寫 indexed/failed。失敗不會 throw，會回 failed。
 */
export async function createKnowledgeChunk(
  db: Firestore,
  params: CreateChunkParams,
): Promise<{ id: string; status: KnowledgeChunkStatus; failureReason?: string }> {
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(params.chunkId)
  const now = FieldValue.serverTimestamp()

  await ref.set({
    workspaceId: params.workspaceId,
    title: params.title,
    content: params.content,
    tags: params.tags,
    embedding: null,
    tokens: estimateTokens(params.content),
    status: 'pending',
    sourceId: params.sourceId ?? null,
    lastIndexedAt: null,
    manuallyEditedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<KnowledgeChunkDoc, 'createdAt' | 'updatedAt'> & { createdAt: any; updatedAt: any })

  return runIndexOnChunk(db, params.chunkId, params.content)
}

interface UpdateChunkParams extends ChunkInput {
  chunkId: string
  /** 內容沒變（只改標題/標籤）時可跳過重新索引 */
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

  const baseUpdate: Record<string, unknown> = {
    title: params.title,
    content: params.content,
    tags: params.tags,
    updatedAt: now,
  }
  if (params.manualEdit) {
    baseUpdate.manuallyEditedAt = now
  }

  if (!params.contentChanged) {
    await ref.update(baseUpdate)
    const snap = await ref.get()
    return { status: (snap.data()?.status as KnowledgeChunkStatus) ?? 'pending' }
  }

  // 內容變動：先標 pending、清掉舊向量，再跑 embed
  await ref.update({
    ...baseUpdate,
    embedding: null,
    tokens: estimateTokens(params.content),
    status: 'pending',
    lastIndexedAt: null,
    failureReason: FieldValue.delete(),
  })

  return runIndexOnChunk(db, params.chunkId, params.content)
}

/**
 * 對單一卡跑 embedding。供 create / update / 排程 retry 共用。
 * 不會 throw：embed 失敗就把卡標成 failed 並寫入失敗原因。
 */
export async function runIndexOnChunk(
  db: Firestore,
  chunkId: string,
  content: string,
): Promise<{ id: string; status: KnowledgeChunkStatus; failureReason?: string }> {
  const ref = db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(chunkId)
  try {
    const values = await embedDocument(content)
    await ref.update({
      embedding: FieldValue.vector(values),
      status: 'indexed' satisfies KnowledgeChunkStatus,
      lastIndexedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      failureReason: FieldValue.delete(),
    })
    return { id: chunkId, status: 'indexed' }
  }
  catch (err: any) {
    const reason = String(err?.statusMessage || err?.message || 'embed failed').slice(0, 300)
    await ref.update({
      status: 'failed' satisfies KnowledgeChunkStatus,
      failureReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    return { id: chunkId, status: 'failed', failureReason: reason }
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
): Promise<{ scanned: number; retried: number; indexed: number; failed: number }> {
  const maxBatch = opts.maxBatch ?? 20
  const stuckMs = opts.pendingStuckMs ?? PENDING_STUCK_MS
  const cutoff = new Date(Date.now() - stuckMs)

  // 撿 failed
  const failedSnap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('status', '==', 'failed')
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
  let failed = 0
  for (const doc of docs) {
    if (seen.has(doc.id)) continue
    seen.add(doc.id)
    const content = String(doc.data()?.content ?? '')
    if (!content) {
      failed++
      continue
    }
    const result = await runIndexOnChunk(db, doc.id, content)
    if (result.status === 'indexed') indexed++
    else failed++
  }

  return { scanned: docs.length, retried: seen.size, indexed, failed }
}
