import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { deleteFlowFolderCascade } from '~~/server/utils/flow-folders'

/**
 * DELETE /api/flow-folders/:folderId
 * 刪資料夾不會刪底下 flows，只把它們的 folderId 改成 null（變未分類）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')
  const folderId = String(getRouterParam(event, 'folderId') ?? '').trim()
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  return deleteFlowFolderCascade(getDb(), workspaceId, folderId)
})
