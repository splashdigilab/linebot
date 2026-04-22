import { getDb } from '~~/server/utils/firebase'

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId required' })

  const db = getDb()
  const snap = await db.collection('conversations').doc(userId)
    .collection('messages')
    .orderBy('timestamp', 'desc')
    .limit(200)
    .get()

  // 抓最新 200 筆，再反轉成舊->新，讓前端顯示維持由上到下的時間序
  const messages = snap.docs.map(d => ({
    id: d.id,
    direction: d.data().direction as 'incoming' | 'outgoing',
    text: d.data().text as string,
    timestamp: d.data().timestamp ?? null,
  })).reverse()

  return { messages }
})
