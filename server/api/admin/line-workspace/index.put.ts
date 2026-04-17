import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'
import {
  invalidateLineWorkspaceCredentialsCache,
} from '~~/server/utils/line-workspace-credentials'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

type PutBody = {
  name?: string
  defaultLiffId?: string
  channelAccessToken?: string
  channelSecret?: string
  /** 為 true 時刪除整份 workspaces/default，改回僅用環境變數 */
  clearWorkspace?: boolean
}

/**
 * PUT /api/admin/line-workspace
 * 以 merge 更新。`channelAccessToken` / `channelSecret` 僅在 body 含該欄位時寫入；
 * 傳空字串表示刪除該欄位（改由環境變數補齊）。
 */
export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)

  const body = await readBody(event) as PutBody

  if (body?.clearWorkspace === true) {
    const db = getDb()
    await db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID).delete().catch(() => {})
    invalidateLineWorkspaceCredentialsCache()
    return { ok: true, cleared: true }
  }

  const db = getDb()
  const ref = db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID)
  const snap = await ref.get()

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body?.name !== undefined) {
    updates.name = String(body.name).trim() || 'default'
  }
  else if (!snap.exists) {
    updates.name = 'default'
  }

  if (Object.prototype.hasOwnProperty.call(body, 'defaultLiffId')) {
    const v = String(body.defaultLiffId ?? '').trim()
    updates.defaultLiffId = v ? v : FieldValue.delete()
  }

  if (Object.prototype.hasOwnProperty.call(body, 'channelAccessToken')) {
    const v = String(body.channelAccessToken ?? '').trim()
    updates.channelAccessToken = v ? v : FieldValue.delete()
  }

  if (Object.prototype.hasOwnProperty.call(body, 'channelSecret')) {
    const v = String(body.channelSecret ?? '').trim()
    updates.channelSecret = v ? v : FieldValue.delete()
  }

  await ref.set(updates, { merge: true })
  invalidateLineWorkspaceCredentialsCache()

  return { ok: true, id: DEFAULT_LINE_WORKSPACE_ID }
})
