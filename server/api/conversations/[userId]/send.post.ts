import { getDb } from '~~/server/utils/firebase'
import { pushMessage } from '~~/server/utils/line'
import { saveConversationMessage } from '~~/server/utils/handler'

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'userId required' })

  const body = await readBody(event)
  const type = String(body?.type || 'text').trim()

  const db = getDb()
  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此使用者' })

  if (type === 'sticker') {
    const packageId = String(body?.packageId || '').trim()
    const stickerId = String(body?.stickerId || '').trim()
    if (!/^\d+$/.test(packageId) || !/^\d+$/.test(stickerId)) {
      throw createError({ statusCode: 400, statusMessage: 'packageId / stickerId 必須是數字字串' })
    }
    const message = { type: 'sticker' as const, packageId, stickerId }
    await pushMessage(userId, [message])
    await saveConversationMessage(userId, 'outgoing', '[貼圖]', {
      messageType: 'sticker',
      payload: message,
    })
    return { ok: true }
  }

  const text: string = String(body?.text || '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text required' })

  const message = { type: 'text' as const, text }
  await pushMessage(userId, [message])
  await saveConversationMessage(userId, 'outgoing', text, {
    messageType: 'text',
    payload: message,
  })

  return { ok: true }
})
