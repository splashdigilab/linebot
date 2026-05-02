import { getDoc } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const flow = await getDoc<{ isSystem?: boolean; workspaceId?: string }>('flows', id)
  if (!flow || flow.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (flow?.isSystem) {
    throw createError({ statusCode: 403, statusMessage: '系統模組不可刪除' })
  }

  await deleteDoc('flows', id)

  return { success: true }
})
