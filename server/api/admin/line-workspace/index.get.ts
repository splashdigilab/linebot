import { getDb } from '~~/server/utils/firebase'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'
import type { LineWorkspaceDoc } from '~~/shared/line-workspace'
import { DEFAULT_LINE_WORKSPACE_ID } from '~~/shared/line-workspace'

function secretSuffix(value: unknown): { configured: boolean; suffix: string | null } {
  const v = String(value ?? '').trim()
  if (!v) return { configured: false, suffix: null }
  /** 過短時不揭露末四碼，避免外洩完整 secret／token */
  if (v.length < 12) return { configured: true, suffix: null }
  return { configured: true, suffix: v.slice(-4) }
}

/**
 * GET /api/admin/line-workspace
 * 回傳目前 workspaces/default 狀態（不含完整 secret／token）。
 */
export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)

  const db = getDb()
  const snap = await db.collection('workspaces').doc(DEFAULT_LINE_WORKSPACE_ID).get()
  const saved = snap.exists ? (snap.data() as LineWorkspaceDoc) : null

  const access = secretSuffix(saved?.channelAccessToken)
  const secret = secretSuffix(saved?.channelSecret)

  const creds = await getLineWorkspaceCredentials()

  return {
    id: DEFAULT_LINE_WORKSPACE_ID,
    savedInFirestore: snap.exists,
    name: String(saved?.name ?? '').trim() || 'default',
    defaultLiffId: String(saved?.defaultLiffId ?? '').trim(),
    /** 實際用於 CTA fallback（僅 Firestore） */
    effectiveDefaultLiffId: String(creds.defaultLiffId ?? '').trim(),
    channelAccessTokenConfigured: access.configured,
    channelAccessTokenSuffix: access.suffix,
    channelSecretConfigured: secret.configured,
    channelSecretSuffix: secret.suffix,
  }
})
