import { resolveAudienceUserIds } from '~~/server/utils/audience'
import type { AudienceFilter } from '~~/shared/types/tag-broadcast'

/**
 * POST /api/audience/estimate
 * 根據 filter 條件預估受眾人數（不儲存）
 * 給推播建立頁即時顯示「預估發送人數」用
 *
 * Body:
 * {
 *   filter: AudienceFilter
 * }
 *
 * Response:
 * {
 *   estimatedCount: number
 *   previewUserIds: string[]   // 前 5 筆
 * }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const filter: AudienceFilter = body?.filter

  if (!filter) {
    throw createError({ statusCode: 400, statusMessage: 'filter is required' })
  }

  const userIds = await resolveAudienceUserIds(filter)

  return {
    estimatedCount: userIds.length,
    previewUserIds: userIds.slice(0, 5),
  }
})
