import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { renameFlowFolder } from '~~/server/utils/flow-folders'

/**
 * PUT /api/flow-folders/:folderId
 * Body: { name }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const folderId = String(getRouterParam(event, 'folderId') ?? '').trim()
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  const result = await renameFlowFolder(getDb(), workspaceId, folderId, name)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'folder not found' })
  return result
})
