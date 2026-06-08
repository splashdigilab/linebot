import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { updateSourceSettings } from '~~/server/utils/ai-knowledge-sources'

/**
 * PUT /api/ai/sources/:sourceId
 * Body: { refreshIntervalMinutes?, onChangeBehavior?, name? }
 *
 * 只動使用者可配置欄位；hash / etag / lastFetchedAt 等系統欄位不在這支處理。
 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const sourceId = String(getRouterParam(event, 'sourceId') ?? '').trim()
  if (!sourceId) throw createError({ statusCode: 400, statusMessage: 'sourceId required' })

  const body = await readBody(event).catch(() => ({}))
  const result = await updateSourceSettings(getDb(), workspaceId, sourceId, {
    refreshIntervalMinutes: body?.refreshIntervalMinutes,
    onChangeBehavior: body?.onChangeBehavior,
    name: body?.name,
    folderId: body?.folderId === null ? null : (typeof body?.folderId === 'string' ? body.folderId : undefined),
  })
  if (!result) throw createError({ statusCode: 404, statusMessage: 'source not found' })
  return result
})
