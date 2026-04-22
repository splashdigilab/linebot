import { getDb } from '~~/server/utils/firebase'

export default defineEventHandler(async () => {
  const db = getDb()

  const snap = await db.collection('conversations')
    .orderBy('lastMessageAt', 'desc')
    .limit(100)
    .get()

  if (snap.empty) return { conversations: [] }

  const userIds = snap.docs.map(d => d.id)
  const CHUNK = 30
  const userMap: Record<string, any> = {}

  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK)
    const uSnap = await db.collection('users').where('__name__', 'in', chunk).get()
    uSnap.docs.forEach(d => { userMap[d.id] = d.data() })
  }

  const conversations = snap.docs.map(d => {
    const data = d.data()
    const user = userMap[d.id] ?? {}
    return {
      userId: d.id,
      displayName: user.displayName ?? d.id,
      pictureUrl: user.pictureUrl ?? '',
      lastMessage: data.lastMessage ?? '',
      lastDirection: data.lastDirection ?? 'incoming',
      lastMessageAt: data.lastMessageAt ?? null,
    }
  })

  return { conversations }
})
