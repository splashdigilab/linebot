import { getDb } from '~~/server/utils/firebase'
import { requireCapability } from '~~/server/utils/workspace-auth'
import { deleteSourceWithChunks } from '~~/server/utils/ai-knowledge-sources'

/**
 * DELETE /api/ai/sources/:sourceId
 * 連同底下所有 chunk 一併刪除（一鍵清乾淨來源）。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireCapability(event, 'sources.write')
  const sourceId = String(getRouterParam(event, 'sourceId') ?? '').trim()
  if (!sourceId) throw createError({ statusCode: 400, statusMessage: 'sourceId required' })

  return deleteSourceWithChunks(getDb(), workspaceId, sourceId)
})
