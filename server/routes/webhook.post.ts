import { verifySignature } from '../utils/line'
import { handleMessageEvent, handlePostbackEvent } from '../utils/handler'
import type { webhook } from '@line/bot-sdk'

export default defineEventHandler(async (event) => {
  // Read raw body for signature verification
  const body = await readRawBody(event)
  const signature = getHeader(event, 'x-line-signature') ?? ''

  if (!body || !verifySignature(body, signature)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: { events: webhook.Event[] }
  try {
    payload = JSON.parse(body)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' })
  }

  // Process events concurrently (non-blocking)
  console.log('[webhook] received', payload.events.length, 'event(s):', payload.events.map(e => e.type))
  const tasks = payload.events.map(async (e) => {
    try {
      if (e.type === 'message') {
        await handleMessageEvent(e as webhook.MessageEvent)
      }
      else if (e.type === 'postback') {
        await handlePostbackEvent(e as webhook.PostbackEvent)
      }
    }
    catch (err) {
      console.error('[webhook] event error:', err)
    }
  })

  await Promise.all(tasks)

  return { status: 'ok' }
})
