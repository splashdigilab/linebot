import { getDb } from '~~/server/utils/firebase'
import { requireCapability } from '~~/server/utils/workspace-auth'
import { createFolder } from '~~/server/utils/ai-knowledge-folders'

/**
 * POST /api/ai/folders
 * Body: { name: string }
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireCapability(event, 'folders.write')
  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '請輸入資料夾名稱' })
  return createFolder(getDb(), workspaceId, name)
})
