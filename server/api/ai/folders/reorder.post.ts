import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { reorderFolders } from '~~/server/utils/ai-knowledge-folders'

/**
 * POST /api/ai/folders/reorder
 * Body: { orderedIds: string[] } — 全部資料夾的新順序
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event).catch(() => ({}))
  const orderedIds = body?.orderedIds

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds is required' })
  }
  const ids = orderedIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
  if (ids.length !== orderedIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds 格式錯誤' })
  }

  await reorderFolders(getDb(), workspaceId, ids)
  return { success: true }
})
