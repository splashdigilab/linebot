import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { renameFolder } from '~~/server/utils/ai-knowledge-folders'

/**
 * PUT /api/ai/folders/:folderId
 * Body: { name }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const folderId = String(getRouterParam(event, 'folderId') ?? '').trim()
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })

  const result = await renameFolder(getDb(), workspaceId, folderId, name)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'folder not found' })
  return result
})
