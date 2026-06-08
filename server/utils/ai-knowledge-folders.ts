/**
 * knowledgeFolders 服務層：CRUD + 簡單的列表。
 *
 * Folder 用來在來源管理頁把 source 分組（資料夾）。
 * 刪除 folder 時 cascade 把底下 source 的 folderId 設為 null（變成未分類），
 * **不會**刪掉底下的 sources / chunks（避免誤刪整批資料）。
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { KNOWLEDGE_SOURCES_COLLECTION } from './ai-knowledge-sources'
import type { KnowledgeFolderDoc } from '~~/shared/types/ai-knowledge'

export const KNOWLEDGE_FOLDERS_COLLECTION = 'knowledgeFolders'

export interface FolderSummary {
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

export function docToFolderSummary(id: string, raw: Partial<KnowledgeFolderDoc>): FolderSummary {
  return {
    id,
    name: String(raw.name ?? ''),
    order: Number(raw.order ?? 0),
    createdAtMs: tsToMs(raw.createdAt),
  }
}

export async function listFolders(
  db: Firestore,
  workspaceId: string,
): Promise<FolderSummary[]> {
  // 沒部署複合索引 (workspaceId, order) 時退到「workspaceId 過濾 + JS 端排序」
  try {
    const snap = await db.collection(KNOWLEDGE_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .orderBy('order', 'asc')
      .get()
    return snap.docs.map(d => docToFolderSummary(d.id, d.data() as any))
  }
  catch (err: any) {
    console.warn('[ai-folders] orderBy index missing, falling back to JS sort:', err?.message)
    const snap = await db.collection(KNOWLEDGE_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .get()
    return snap.docs
      .map(d => docToFolderSummary(d.id, d.data() as any))
      .sort((a, b) => a.order - b.order)
  }
}

export async function createFolder(
  db: Firestore,
  workspaceId: string,
  name: string,
): Promise<FolderSummary> {
  const cleaned = name.trim().slice(0, 50)
  if (!cleaned) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  // 用最大 order + 1 放到最後（之後想做拖曳排序時也適用）。
  // 若複合索引 (workspaceId, order DESC) 還沒部署，退而求其次用 Date.now() 當 order，
  // 讓建立還是能成功；索引部署後新建的資料夾就會依序入列。
  let nextOrder: number
  try {
    const lastSnap = await db.collection(KNOWLEDGE_FOLDERS_COLLECTION)
      .where('workspaceId', '==', workspaceId)
      .orderBy('order', 'desc')
      .limit(1)
      .get()
    nextOrder = lastSnap.empty ? 0 : Number(lastSnap.docs[0]!.data()?.order ?? 0) + 1
  }
  catch (err: any) {
    console.warn('[ai-folders] orderBy index missing, using timestamp fallback:', err?.message)
    nextOrder = Date.now()
  }

  const ref = db.collection(KNOWLEDGE_FOLDERS_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  await ref.set({
    workspaceId,
    name: cleaned,
    order: nextOrder,
    createdAt: now,
    updatedAt: now,
  })
  const snap = await ref.get()
  return docToFolderSummary(ref.id, snap.data() as any)
}

export async function renameFolder(
  db: Firestore,
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<FolderSummary | null> {
  const cleaned = name.trim().slice(0, 50)
  if (!cleaned) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  const ref = db.collection(KNOWLEDGE_FOLDERS_COLLECTION).doc(folderId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as KnowledgeFolderDoc
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  await ref.update({ name: cleaned, updatedAt: FieldValue.serverTimestamp() })
  const fresh = await ref.get()
  return docToFolderSummary(ref.id, fresh.data() as any)
}

/**
 * 刪除 folder：先把底下 source 的 folderId 設成 null（變未分類），再刪 folder。
 * 不刪 sources / chunks 本身。
 */
export async function deleteFolderCascade(
  db: Firestore,
  workspaceId: string,
  folderId: string,
): Promise<{ movedSources: number }> {
  const ref = db.collection(KNOWLEDGE_FOLDERS_COLLECTION).doc(folderId)
  const snap = await ref.get()
  if (!snap.exists) return { movedSources: 0 }
  const data = snap.data() as KnowledgeFolderDoc
  if (data.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  // 把底下 source 的 folderId 變 null
  const childrenSnap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('folderId', '==', folderId)
    .get()

  const batch = db.batch()
  for (const child of childrenSnap.docs) {
    batch.update(child.ref, { folderId: null, updatedAt: FieldValue.serverTimestamp() })
  }
  batch.delete(ref)
  await batch.commit()

  return { movedSources: childrenSnap.size }
}
