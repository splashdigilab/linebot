import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import {
  clearSourceOutdated,
  countSourceChunks,
  getSource,
  KNOWLEDGE_SOURCES_COLLECTION,
} from '~~/server/utils/ai-knowledge-sources'
import {
  createKnowledgeChunk,
  KNOWLEDGE_CHUNKS_COLLECTION,
  updateKnowledgeChunk,
} from '~~/server/utils/ai-knowledge-chunks'
import type { DiffAction, DiffEntry } from '~~/server/utils/ai-knowledge-resync'

/**
 * POST /api/ai/sources/:sourceId/resync-apply
 *
 * Body: { entries: DiffEntry[], decisions: Record<entryId, DiffAction> }
 *
 * 客戶端把 preview 拿到的 diff entries 跟使用者每張的決定送回來，後端依決定套用：
 *   - add_new   → 新建 chunk（含 embedding）
 *   - use_new   → 用新版內容覆蓋舊 chunk（觸發 re-index）；清掉 manuallyEditedAt
 *   - keep_old  → 不動
 *   - delete_old → 刪掉舊 chunk
 *   - skip      → 不動（跟 keep_old 等價，但語意上指「新版被略過」）
 *
 * 套用後：清掉 outdatedAt 旗標、更新 source.lastFetchedAt / chunkCount。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const sourceId = String(getRouterParam(event, 'sourceId') ?? '').trim()
  if (!sourceId) throw createError({ statusCode: 400, statusMessage: 'sourceId required' })

  const body = await readBody(event)
  const entries = Array.isArray(body?.entries) ? body.entries as DiffEntry[] : []
  const decisions = body?.decisions as Record<string, DiffAction> | undefined
  if (!entries.length || !decisions) {
    throw createError({ statusCode: 400, statusMessage: '請提供 entries 與 decisions' })
  }

  const db = getDb()
  const source = await getSource(db, sourceId, workspaceId)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'source not found' })

  let added = 0
  let updated = 0
  let deleted = 0
  let kept = 0
  const errors: Array<{ entryId: string; message: string }> = []

  for (const entry of entries) {
    const action = decisions[entry.id]
    if (!action) {
      kept++
      continue
    }
    try {
      if (action === 'keep_old' || action === 'skip') {
        kept++
        continue
      }
      if (action === 'add_new' && entry.newChunk) {
        await createKnowledgeChunk(db, {
          workspaceId,
          chunkId: uuidv4(),
          title: entry.newChunk.title,
          content: entry.newChunk.content,
          tags: entry.newChunk.tags,
          sourceId,
        })
        added++
        continue
      }
      if (action === 'use_new' && entry.oldChunk && entry.newChunk) {
        await updateKnowledgeChunk(db, {
          chunkId: entry.oldChunk.id,
          title: entry.newChunk.title,
          content: entry.newChunk.content,
          tags: entry.newChunk.tags,
          contentChanged: entry.oldChunk.content !== entry.newChunk.content,
          manualEdit: false, // re-sync 是自動的，不算手動編輯
        })
        // 清掉 manuallyEditedAt（使用者已選擇用新版了）
        await db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(entry.oldChunk.id).update({
          manuallyEditedAt: null,
        }).catch(() => {})
        updated++
        continue
      }
      if (action === 'delete_old' && entry.oldChunk) {
        await db.collection(KNOWLEDGE_CHUNKS_COLLECTION).doc(entry.oldChunk.id).delete()
        deleted++
        continue
      }
      errors.push({ entryId: entry.id, message: `invalid action "${action}" for kind "${entry.kind}"` })
    }
    catch (err: any) {
      errors.push({
        entryId: entry.id,
        message: String(err?.statusMessage || err?.message || 'unknown error').slice(0, 200),
      })
    }
  }

  // 更新 source 狀態
  const newChunkCount = await countSourceChunks(db, workspaceId, sourceId)
  await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
    chunkCount: newChunkCount,
    lastFetchedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await clearSourceOutdated(db, sourceId)

  return {
    sourceId,
    added,
    updated,
    deleted,
    kept,
    errors,
    chunkCount: newChunkCount,
  }
})
