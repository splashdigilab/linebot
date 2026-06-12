/**
 * knowledgeSources 服務層：CRUD + 簡單列表查詢。
 *
 * Source = 「匯入的來源」（PDF / 網址 / 手打）。每個 source 自動切出多張 chunk，
 * chunk.sourceId 指回 source.id。手打單卡（type='manual'）也可有 source 把它們群組起來。
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { invalidateTagIndexCache, KNOWLEDGE_CHUNKS_COLLECTION } from './ai-knowledge-chunks'
import type {
  KnowledgeSourceDoc,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '~~/shared/types/ai-knowledge'

export const KNOWLEDGE_SOURCES_COLLECTION = 'knowledgeSources'

export interface SourceSummary {
  id: string
  type: KnowledgeSourceType
  name: string
  url: string
  /** 所屬資料夾；null = 未分類 */
  folderId: string | null
  status: KnowledgeSourceStatus
  failureReason?: string
  chunkCount: number
  refreshIntervalMinutes: number
  onChangeBehavior: 'notify' | 'log_only'
  lastFetchedAtMs: number
  outdatedAtMs: number
  updatedAtMs: number
}

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

/** 把 raw doc 轉成 UI 友善的 summary（時間戳轉 ms、有預設值） */
export function docToSourceSummary(id: string, raw: Partial<KnowledgeSourceDoc>): SourceSummary {
  return {
    id,
    type: (raw.type ?? 'file') as KnowledgeSourceType,
    name: String(raw.name ?? ''),
    url: String(raw.url ?? ''),
    folderId: raw.folderId ?? null,
    status: (raw.status ?? 'ready') as KnowledgeSourceStatus,
    failureReason: raw.failureReason,
    chunkCount: Number(raw.chunkCount ?? 0),
    refreshIntervalMinutes: Number(raw.refreshIntervalMinutes ?? 0),
    onChangeBehavior: raw.onChangeBehavior === 'log_only' ? 'log_only' : 'notify',
    lastFetchedAtMs: tsToMs(raw.lastFetchedAt),
    outdatedAtMs: tsToMs(raw.outdatedAt),
    updatedAtMs: tsToMs(raw.updatedAt),
  }
}

/**
 * 列出某 workspace 的所有 source（依 updatedAt 倒序）。
 */
export async function listSources(
  db: Firestore,
  workspaceId: string,
  limit = 100,
): Promise<SourceSummary[]> {
  const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get()
  return snap.docs.map(d => docToSourceSummary(d.id, d.data() as any))
}

/**
 * 取得單一 source（含 workspace 比對）。找不到回 null。
 */
export async function getSource(
  db: Firestore,
  sourceId: string,
  workspaceId: string,
): Promise<{ id: string; data: KnowledgeSourceDoc } | null> {
  const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).get()
  if (!snap.exists) return null
  const data = snap.data() as KnowledgeSourceDoc
  if (data.workspaceId !== workspaceId) return null
  return { id: snap.id, data }
}

/**
 * 重新算 chunkCount（給 source detail 顯示「目前有幾張卡」）。
 */
export async function countSourceChunks(
  db: Firestore,
  workspaceId: string,
  sourceId: string,
): Promise<number> {
  const snap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('sourceId', '==', sourceId)
    .count()
    .get()
  return snap.data().count
}

/**
 * 列出某 source 旗下的所有 chunk（給 source detail panel）。
 */
export async function listChunksBySource(
  db: Firestore,
  workspaceId: string,
  sourceId: string,
): Promise<Array<{ id: string; title: string; content: string; tags: string[]; status: string; manuallyEditedAtMs: number; updatedAtMs: number }>> {
  const snap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('sourceId', '==', sourceId)
    .get()
  return snap.docs.map((d) => {
    const data = d.data() as any
    return {
      id: d.id,
      title: String(data?.title ?? ''),
      content: String(data?.content ?? ''),
      tags: Array.isArray(data?.tags) ? data.tags.map(String) : [],
      status: String(data?.status ?? 'pending'),
      manuallyEditedAtMs: tsToMs(data?.manuallyEditedAt),
      updatedAtMs: tsToMs(data?.updatedAt),
    }
  })
}

/**
 * 刪除 source 與底下所有 chunk。給「整批退場」用。
 * 注意：不刪 file storage（filePath），那是另一個生命週期。
 */
export async function deleteSourceWithChunks(
  db: Firestore,
  workspaceId: string,
  sourceId: string,
): Promise<{ chunksDeleted: number }> {
  const source = await getSource(db, sourceId, workspaceId)
  if (!source) return { chunksDeleted: 0 }

  const chunksSnap = await db.collection(KNOWLEDGE_CHUNKS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('sourceId', '==', sourceId)
    .get()

  const batch = db.batch()
  for (const doc of chunksSnap.docs) batch.delete(doc.ref)
  // 變動偵測的全文暫存（subcollection）也一併清掉，避免孤兒 doc
  batch.delete(db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).collection('cache').doc('extracted'))
  batch.delete(db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId))
  await batch.commit()
  invalidateTagIndexCache(workspaceId)

  return { chunksDeleted: chunksSnap.size }
}

export interface UpdateSourceSettingsInput {
  refreshIntervalMinutes?: number
  onChangeBehavior?: 'notify' | 'log_only'
  name?: string
  /** 移動到指定資料夾；null = 移出資料夾（未分類） */
  folderId?: string | null
}

/**
 * 更新 source 的設定（refresh 頻率、處理方式、顯示名稱、所屬資料夾）。
 * 只動使用者可配置的欄位；不動 hash / etag / lastFetchedAt 等系統管理欄位。
 */
export async function updateSourceSettings(
  db: Firestore,
  workspaceId: string,
  sourceId: string,
  input: UpdateSourceSettingsInput,
): Promise<SourceSummary | null> {
  const source = await getSource(db, sourceId, workspaceId)
  if (!source) return null

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (input.refreshIntervalMinutes != null) {
    const n = Number(input.refreshIntervalMinutes)
    update.refreshIntervalMinutes = Number.isFinite(n) ? Math.max(0, Math.min(43_200, Math.round(n))) : 0
  }
  if (input.onChangeBehavior === 'notify' || input.onChangeBehavior === 'log_only') {
    update.onChangeBehavior = input.onChangeBehavior
  }
  if (typeof input.name === 'string' && input.name.trim()) {
    update.name = input.name.trim().slice(0, 200)
  }
  if (input.folderId !== undefined) {
    update.folderId = input.folderId ? String(input.folderId) : null
  }

  await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update(update)
  const fresh = await getSource(db, sourceId, workspaceId)
  return fresh ? docToSourceSummary(fresh.id, fresh.data) : null
}

/**
 * 標 source「偵測到變動，等使用者確認」。
 * 由排程任務在比對到 contentHash 變了之後呼叫。
 */
export async function markSourceOutdated(
  db: Firestore,
  sourceId: string,
): Promise<void> {
  await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
    outdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/**
 * 清掉「偵測到變動」旗標（套用 re-sync 後呼叫）。
 */
export async function clearSourceOutdated(
  db: Firestore,
  sourceId: string,
): Promise<void> {
  await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
    outdatedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
}
