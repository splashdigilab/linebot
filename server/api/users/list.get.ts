import { getDb } from '~~/server/utils/firebase'

/**
 * GET /api/users/list
 * 取得會員列表，含每位用戶的標籤資訊
 *
 * Query:
 *   tagIds  - 以逗號分隔的 tagId，只回傳擁有其中任一標籤的用戶
 *   limit   - 最多幾筆（預設 200）
 *
 * Response:
 * {
 *   users: Array<{
 *     id: string        // LINE userId
 *     displayName: string
 *     pictureUrl: string
 *     createdAt: Timestamp
 *     tagIds: string[]
 *     tags: Array<{ id, code, name, category, color }>
 *   }>
 *   total: number
 * }
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tagIdsParam = query.tagIds as string | undefined
  const limitParam = Math.min(parseInt((query.limit as string) || '500'), 800)

  const db = getDb()

  // ── Step 1: 若有 tagIds filter，先取出符合的 userId 集合 ──────────
  let filterUserIds: Set<string> | null = null

  if (tagIdsParam) {
    const tagIds = tagIdsParam.split(',').filter(Boolean)
    if (tagIds.length > 0) {
      // Firestore `in` 最多 30 個值，先取前 30
      const snap = await db.collection('userTags')
        .where('tagId', 'in', tagIds.slice(0, 30))
        .get()
      filterUserIds = new Set(snap.docs.map((d) => d.data().userId as string))
    }
  }

  // ── Step 2: 取用戶列表 ───────────────────────────────────────────
  const usersSnap = await db.collection('users')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limitParam * 3, 1500))
    .get()

  let users = usersSnap.docs
    .filter((d) => d.data().isBlocked !== true)
    .slice(0, limitParam)
    .map((d) => ({
      id: d.id,
      displayName: d.data().displayName ?? d.id,
      pictureUrl: d.data().pictureUrl ?? '',
      createdAt: d.data().createdAt ?? null,
      isBlocked: false,
    }))

  if (filterUserIds !== null) {
    users = users.filter((u) => filterUserIds!.has(u.id))
  }

  if (!users.length) return { users: [], total: 0 }

  // ── Step 3: 批次取得 userTags ────────────────────────────────────
  const userIds = users.map((u) => u.id)
  const allUserTags: Array<{ userId: string; tagId: string }> = []
  const CHUNK = 30

  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK)
    const snap = await db.collection('userTags').where('userId', 'in', chunk).get()
    snap.docs.forEach((d) => {
      allUserTags.push({ userId: d.data().userId, tagId: d.data().tagId })
    })
  }

  // userId -> tagIds[]
  const userTagMap: Record<string, string[]> = {}
  for (const ut of allUserTags) {
    if (!userTagMap[ut.userId]) userTagMap[ut.userId] = []
    userTagMap[ut.userId].push(ut.tagId)
  }

  // ── Step 4: 批次取得標籤詳情 ─────────────────────────────────────
  const allTagIds = [...new Set(allUserTags.map((ut) => ut.tagId))]
  const tagMap: Record<string, any> = {}

  if (allTagIds.length > 0) {
    for (let i = 0; i < allTagIds.length; i += CHUNK) {
      const chunk = allTagIds.slice(i, i + CHUNK)
      const snap = await db.collection('tags').where('__name__', 'in', chunk).get()
      snap.docs.forEach((d) => {
        tagMap[d.id] = { id: d.id, ...d.data() }
      })
    }
  }

  // ── Step 5: 組合結果 ──────────────────────────────────────────────
  const enriched = users.map((user) => {
    const tagIds = userTagMap[user.id] ?? []
    return {
      ...user,
      tagIds,
      tags: tagIds.map((tid) => tagMap[tid]).filter(Boolean).map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        category: t.category,
        color: t.color,
      })),
    }
  })

  return { users: enriched, total: enriched.length }
})
