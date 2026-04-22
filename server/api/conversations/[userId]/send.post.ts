import { getDb } from '~~/server/utils/firebase'
import { pushMessage } from '~~/server/utils/line'
import { saveConversationMessage } from '~~/server/utils/handler'

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId required' })

  const body = await readBody(event)
  const text: string = body?.text?.trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text required' })

  const db = getDb()
  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })

  await pushMessage(userId, [{ type: 'text', text }])
  await saveConversationMessage(userId, 'outgoing', text, {
    messageType: 'text',
    payload: { type: 'text', text },
  })

  return { ok: true }
})
