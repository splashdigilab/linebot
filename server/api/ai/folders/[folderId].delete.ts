import { getDb } from '~~/server/utils/firebase'
import { requireCapability } from '~~/server/utils/workspace-auth'
import { deleteFolderCascade } from '~~/server/utils/ai-knowledge-folders'

/**
 * DELETE /api/ai/folders/:folderId
 * 刪資料夾時不會刪底下的來源，只把它們的 folderId 設成 null（變未分類）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireCapability(event, 'folders.write')
  const folderId = String(getRouterParam(event, 'folderId') ?? '').trim()
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  return deleteFolderCascade(getDb(), workspaceId, folderId)
})
