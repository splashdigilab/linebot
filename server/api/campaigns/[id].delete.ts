import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')!
  const db = getDb()
  const snap = await db.collection('leadCampaigns').doc(id).get()
  if (!snap.exists || snap.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })
  }
  await db.collection('leadCampaigns').doc(id).delete()
  return { success: true, id }
})
