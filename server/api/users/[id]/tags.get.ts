import { getDb } from '~~/server/utils/firebase'

/**
 * GET /api/users/:id/tags
 * 取得單一用戶目前擁有的所有標籤（含標籤詳細資訊）
 *
 * Response:
 * {
 *   userId: string,
 *   tags: Array<{
 *     userTagId: string
 *     tagId: string
 *     code: string
 *     name: string
 *     category: string
 *     color: string
 *     sourceType: string
 *     createdAt: Timestamp
 *   }>
 * }
 */
export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'id')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId is required' })

  const db = getDb()

  const userTagsSnap = await db.collection('userTags')
    .where('userId', '==', userId)
    .get()

  if (userTagsSnap.empty) {
    return { userId, tags: [] }
  }

  const sortedDocs = [...userTagsSnap.docs].sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() ?? 0
    const tb = b.data().createdAt?.toMillis?.() ?? 0
    return tb - ta
  })

  // 批次查詢標籤詳細資料
  const tagIds = [...new Set(sortedDocs.map((d) => d.data().tagId as string))]
  const tagSnaps = await Promise.all(tagIds.map((tagId) => db.collection('tags').doc(tagId).get()))
  const tagMap = new Map(tagSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]))

  const tags = sortedDocs.map((d) => {
    const utData = d.data()
    const tagData = tagMap.get(utData.tagId) ?? {}
    return {
      userTagId: d.id,
      tagId: utData.tagId,
      code: tagData.code ?? '',
      name: tagData.name ?? '',
      category: tagData.category ?? '',
      color: tagData.color ?? '',
      sourceType: utData.sourceType,
      createdAt: utData.createdAt,
    }
  })

  return { userId, tags }
})
