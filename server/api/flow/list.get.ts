import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const flows = await listDocs('flows', (ref) =>
    ref.where('workspaceId', '==', workspaceId).orderBy('createdAt', 'desc'),
  )
  return flows.map((flow: any) => {
    const { triggers, trigger, ...rest } = flow
    return rest
  })
})
