import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import type { UserTagDoc, TagLogDoc, UserTagSourceType } from '~~/shared/types/tag-broadcast'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

export interface TaggingResult {
  added: string[]
  skipped: string[]
}

/**
 * 冪等貼標：對單一使用者批次加標籤。
 * - 已存在的 userTag doc（userId_tagId）自動略過，不重複寫入。
 * - 同時寫 tagLogs 供稽核。
 * - 使用 Firestore batch，保證原子性。
 */
export async function addTagsToUser(
  /** Firestore users 主鍵：`${workspaceId}_${lineUserId}` */
  userFirestoreDocId: string,
  tagIds: string[],
  sourceType: UserTagSourceType,
  sourceRefId: string | null,
  workspaceId: string = DEFAULT_LINE_WORKSPACE_ID,
): Promise<TaggingResult> {
  if (!userFirestoreDocId || !tagIds.length) return { added: [], skipped: [] }

  const db = getDb()
  const now = FieldValue.serverTimestamp()
  const added: string[] = []
  const skipped: string[] = []
  const batch = db.batch()

  for (const tagId of tagIds) {
    const docId = `${userFirestoreDocId}_${tagId}`
    const ref = db.collection('userTags').doc(docId)
    const snap = await ref.get()

    if (snap.exists) {
      skipped.push(tagId)
      continue
    }

    const userTagDoc: UserTagDoc = {
      workspaceId,
      userId: userFirestoreDocId,
      tagId,
      sourceType,
      sourceRefId,
      createdBy: null,
      createdAt: now,
    }
    batch.set(ref, userTagDoc)

    const logDoc: TagLogDoc = {
      workspaceId,
      action: 'add',
      userId: userFirestoreDocId,
      tagId,
      sourceType,
      sourceRefId,
      operatorId: null,
      createdAt: now,
    }
    batch.set(db.collection('tagLogs').doc(uuidv4()), logDoc)

    added.push(tagId)
  }

  if (added.length > 0) {
    await batch.commit()
  }

  return { added, skipped }
}
