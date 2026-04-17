import { getDb } from '~~/server/utils/firebase'
import { resolveAudienceUserIds } from '~~/server/utils/audience'
import type { BroadcastDoc, AudienceFilter } from '~~/shared/types/tag-broadcast'

/**
 * POST /api/broadcast/:id/validate
 * 發送前檢查，回傳預估資訊，不真正發送
 *
 * Response:
 * {
 *   valid: boolean
 *   errors: string[]
 *   estimatedCount: number     // 預估發送人數
 *   previewUserIds: string[]   // 前 5 筆預覽
 * }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const snap = await db.collection('broadcasts').doc(id).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Broadcast not found' })

  const data = snap.data() as BroadcastDoc
  const errors: string[] = []

  // 檢查訊息內容
  if (!data.messages?.length) {
    errors.push('推播訊息不能為空')
  }

  // 檢查狀態
  if (data.status === 'completed') {
    errors.push('此推播已發送完成，無法再次發送')
  }
  if (data.status === 'processing') {
    errors.push('此推播正在發送中')
  }

  // 解析受眾
  let resolvedUserIds: string[] = []
  try {
    if (data.audienceSource.type === 'all') {
      const usersSnap = await db.collection('users').select().get()
      resolvedUserIds = usersSnap.docs.map((d) => d.id)
    }
    else if (data.audienceSource.type === 'tags' && data.audienceSource.tagIds?.length) {
      const filter: AudienceFilter = {
        conditions: [{ type: 'includeAny', tagIds: data.audienceSource.tagIds }],
        joinedAfter: null,
        joinedBefore: null,
        isBlocked: null,
      }
      resolvedUserIds = await resolveAudienceUserIds(filter)
    }
    else if (data.audienceSource.type === 'audience' && data.audienceSource.audienceId) {
      const audienceSnap = await db.collection('audiences').doc(data.audienceSource.audienceId).get()
      if (!audienceSnap.exists) {
        errors.push('指定的受眾群組不存在')
      }
      else {
        resolvedUserIds = await resolveAudienceUserIds(audienceSnap.data()!.filter as AudienceFilter)
      }
    }
    else if (data.audienceSource.type === 'import') {
      resolvedUserIds = data.audienceSource.importedUserIds ?? []
    }
  }
  catch (err) {
    errors.push('受眾解析失敗，請稍後再試')
  }

  if (!resolvedUserIds.length && !errors.length) {
    errors.push('受眾人數為 0，無法發送')
  }

  return {
    valid: errors.length === 0,
    errors,
    estimatedCount: resolvedUserIds.length,
    previewUserIds: resolvedUserIds.slice(0, 5),
  }
})
