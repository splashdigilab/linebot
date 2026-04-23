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

  const isHttpUrl = (input: unknown) => /^https?:\/\//i.test(String(input || '').trim())

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

  if (type === 'image') {
    const originalContentUrl = String(body?.originalContentUrl || '').trim()
    const previewImageUrl = String(body?.previewImageUrl || originalContentUrl).trim()
    if (!isHttpUrl(originalContentUrl) || !isHttpUrl(previewImageUrl)) {
      throw createError({ statusCode: 400, statusMessage: '圖片網址格式不正確' })
    }
    const message = { type: 'image' as const, originalContentUrl, previewImageUrl }
    await pushMessage(userId, [message])
    await saveConversationMessage(userId, 'outgoing', '[圖片]', {
      messageType: 'image',
      payload: message,
    })
    return { ok: true }
  }

  if (type === 'video') {
    const originalContentUrl = String(body?.originalContentUrl || '').trim()
    const previewImageUrl = String(body?.previewImageUrl || '').trim()
    if (!isHttpUrl(originalContentUrl) || !isHttpUrl(previewImageUrl)) {
      throw createError({ statusCode: 400, statusMessage: '影片網址格式不正確' })
    }
    const message = { type: 'video' as const, originalContentUrl, previewImageUrl }
    await pushMessage(userId, [message])
    await saveConversationMessage(userId, 'outgoing', '[影片]', {
      messageType: 'video',
      payload: message,
    })
    return { ok: true }
  }

  if (type === 'audio') {
    const originalContentUrl = String(body?.originalContentUrl || '').trim()
    const duration = Number(body?.duration ?? body?.durationMs)
    if (!isHttpUrl(originalContentUrl) || !Number.isFinite(duration) || duration < 1) {
      throw createError({ statusCode: 400, statusMessage: '音訊參數不正確' })
    }
    const message = { type: 'audio' as const, originalContentUrl, duration: Math.round(duration) }
    await pushMessage(userId, [message as any])
    await saveConversationMessage(userId, 'outgoing', '[音訊]', {
      messageType: 'audio',
      payload: message,
    })
    return { ok: true }
  }

  if (type === 'file') {
    const originalContentUrl = String(body?.originalContentUrl || '').trim()
    const fileName = String(body?.fileName || '').trim()
    if (!isHttpUrl(originalContentUrl) || !fileName) {
      throw createError({ statusCode: 400, statusMessage: '檔案參數不正確' })
    }
    const message = { type: 'file' as const, originalContentUrl, fileName }
    await pushMessage(userId, [message as any])
    await saveConversationMessage(userId, 'outgoing', `[檔案] ${fileName}`, {
      messageType: 'file',
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
