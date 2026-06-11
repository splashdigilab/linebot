/**
 * flowFolders 服務層：把 regular flows 分組用。
 * 跟 knowledgeFolders 同一個 pattern，但用獨立 collection。
 *
 * 刪除 folder 時 cascade 把底下 flow.folderId 設為 null（變未分類），
 * **不會** 刪掉底下的 flows。
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { FlowFolderDoc } from '~~/shared/types/firestore-docs'

export const FLOW_FOLDERS_COLLECTION = 'flowFolders'
export const FLOWS_COLLECTION = 'flows'

export interface FlowFolderSummary {
  id: string
  name: string
  order: number
  createdAtMs: number
}

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

export function docToFlowFolderSummary(id: string, raw: Partial<FlowFolderDoc>): FlowFolderSummary {
  return {
    id,
    name: String(raw.name ?? ''),
    order: Number(raw.order ?? 0),
    createdAtMs: tsToMs(raw.createdAt),
  }
}

export async function listFlowFolders(
  db: Firestore,
  workspaceId: string,
): Promise<FlowFolderSummary[]> {
  // 沒部署複合索引時退到 JS 端 sort
  try {
    const snap = await db.collection(FLOW_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .orderBy('order', 'asc')
      .get()
    return snap.docs.map(d => docToFlowFolderSummary(d.id, d.data() as any))
  }
  catch (err: any) {
    console.warn('[flow-folders] orderBy index missing, falling back:', err?.message)
    const snap = await db.collection(FLOW_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .get()
    return snap.docs
      .map(d => docToFlowFolderSummary(d.id, d.data() as any))
      .sort((a, b) => a.order - b.order)
  }
}

export async function createFlowFolder(
  db: Firestore,
  workspaceId: string,
  name: string,
): Promise<FlowFolderSummary> {
  const cleaned = name.trim().slice(0, 50)
  if (!cleaned) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  let nextOrder: number
  try {
    const lastSnap = await db.collection(FLOW_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .orderBy('order', 'desc')
      .limit(1)
      .get()
    nextOrder = lastSnap.empty ? 0 : Number(lastSnap.docs[0]!.data()?.order ?? 0) + 1
  }
  catch {
    nextOrder = Date.now()
  }

  const ref = db.collection(FLOW_FOLDERS_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  await ref.set({
    workspaceId,
    name: cleaned,
    order: nextOrder,
    createdAt: now,
    updatedAt: now,
  })
  const snap = await ref.get()
  return docToFlowFolderSummary(ref.id, snap.data() as any)
}

export async function renameFlowFolder(
  db: Firestore,
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<FlowFolderSummary | null> {
  const cleaned = name.trim().slice(0, 50)
  if (!cleaned) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  const ref = db.collection(FLOW_FOLDERS_COLLECTION).doc(folderId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as FlowFolderDoc
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  await ref.update({ name: cleaned, updatedAt: FieldValue.serverTimestamp() })
  const fresh = await ref.get()
  return docToFlowFolderSummary(ref.id, fresh.data() as any)
}

/**
 * 重排資料夾：orderedIds 必須跟現有資料夾一一對應，order 直接寫成 index。
 */
export async function reorderFlowFolders(
  db: Firestore,
  workspaceId: string,
  orderedIds: string[],
): Promise<void> {
  const existing = await listFlowFolders(db, workspaceId)
  const existingIds = new Set(existing.map(f => f.id))
  if (orderedIds.length !== existing.length || orderedIds.some(id => !existingIds.has(id))) {
    throw createError({ statusCode: 400, statusMessage: '排序列表與資料夾數量不符' })
  }

  const batch = db.batch()
  orderedIds.forEach((id, index) => {
    batch.update(db.collection(FLOW_FOLDERS_COLLECTION).doc(id), {
      order: index,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  await batch.commit()
}

/**
 * 刪 folder：把底下 flows 的 folderId 改成 null，再刪 folder。
 * 不刪 flows 本身。
 */
export async function deleteFlowFolderCascade(
  db: Firestore,
  workspaceId: string,
  folderId: string,
): Promise<{ movedFlows: number }> {
  const ref = db.collection(FLOW_FOLDERS_COLLECTION).doc(folderId)
  const snap = await ref.get()
  if (!snap.exists) return { movedFlows: 0 }
  const data = snap.data() as FlowFolderDoc
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  const childrenSnap = await db.collection(FLOWS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('folderId', '==', folderId)
    .get()

  const batch = db.batch()
  for (const c of childrenSnap.docs) {
    batch.update(c.ref, { folderId: null })
  }
  batch.delete(ref)
  await batch.commit()

  return { movedFlows: childrenSnap.size }
}
