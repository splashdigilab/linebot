import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'viewer')
  const items = await listDocs('richMessages', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )
  return items
})
