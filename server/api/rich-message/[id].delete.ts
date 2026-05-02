import { getDoc } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const existing = await getDoc<{ workspaceId?: string }>('richMessages', id)
  if (!existing || existing.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  await deleteDoc('richMessages', id)
  return { success: true }
})
