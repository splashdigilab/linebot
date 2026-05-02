import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

const DISPLAY_FALLBACK = 'LINE 用戶'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'agent')

  const db = getDb()

  const snap = await db.collection('conversations')
    .where('workspaceId', '==', workspaceId)
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
      displayName: String(user.displayName || '').trim() || DISPLAY_FALLBACK,
      pictureUrl: String(user.pictureUrl || '').trim(),
      lastMessage: data.lastMessage ?? '',
      lastDirection: data.lastDirection ?? 'incoming',
      lastMessageAt: data.lastMessageAt ?? null,
    }
  })

  return { conversations }
})
