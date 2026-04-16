import { verifySignature } from '../utils/line'
import { handleMessageEvent, handlePostbackEvent } from '../utils/handler'
import type { webhook } from '@line/bot-sdk'

function resolveRequestOrigin(event: Parameters<typeof getHeader>[0]): string {
  const protoRaw = String(getHeader(event, 'x-forwarded-proto') || 'https')
  const hostRaw = String(getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || '')
  const proto = protoRaw.split(',')[0].trim().toLowerCase()
  const host = hostRaw.split(',')[0].trim()
  if (!host) return ''
  const safeProto = proto === 'http' || proto === 'https' ? proto : 'https'
  return `${safeProto}://${host}`
}

export default defineEventHandler(async (event) => {
  // Read raw body for signature verification
  const body = await readRawBody(event)
  const signature = getHeader(event, 'x-line-signature') ?? ''
  const requestOrigin = resolveRequestOrigin(event)

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
        await handleMessageEvent(e as webhook.MessageEvent, { requestOrigin })
      }
      else if (e.type === 'postback') {
        await handlePostbackEvent(e as webhook.PostbackEvent, { requestOrigin })
      }
    }
    catch (err) {
      console.error('[webhook] event error:', err)
    }
  })

  await Promise.all(tasks)

  return { status: 'ok' }
})
