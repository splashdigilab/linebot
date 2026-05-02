import { requireSuperAdmin } from '~~/server/utils/workspace-auth'

/**
 * GET /api/admin/super/workspaces
 * 列出所有 workspaces。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const db = getDb()
  const snap = await db.collection('workspaces').get()

  return snap.docs.map(d => ({
    id: d.id,
    name: d.data().name ?? d.id,
    organizationId: d.data().organizationId ?? null,
    channelAccessTokenConfigured: !!d.data().channelAccessToken,
    channelSecretConfigured: !!d.data().channelSecret,
  }))
})
