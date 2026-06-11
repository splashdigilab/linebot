import { verifyLineWebhookSignature } from '../utils/line'
import { listWorkspaceLineCredentials } from '../utils/line-workspace-credentials'
import { handleMessageEvent, handlePostbackEvent, handleFollowEvent, handleUnfollowEvent } from '../utils/handler'
import { claimWebhookEvent } from '../utils/webhook-dedup'
import type { webhook } from '@line/bot-sdk'

function resolveRequestOrigin(event: Parameters<typeof getHeader>[0]): string {
  const protoRaw = String(getHeader(event, 'x-forwarded-proto') || 'https')
  const hostRaw = String(getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || '')
  const proto = (protoRaw.split(',')[0] ?? '').trim().toLowerCase()
  const host = (hostRaw.split(',')[0] ?? '').trim()
  if (!host) return ''
  const safeProto = proto === 'http' || proto === 'https' ? proto : 'https'
  return `${safeProto}://${host}`
}

function toRawBodyBuffer(raw: unknown): Buffer {
  if (raw instanceof Buffer) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (typeof raw === 'string') return Buffer.from(raw, 'utf8')
  // Some runtimes expose raw body as { type: 'Buffer', data: number[] }.
  if (raw && typeof raw === 'object') {
    const o = raw as { type?: unknown; data?: unknown }
    if (o.type === 'Buffer' && Array.isArray(o.data)) {
      const bytes = o.data.filter(v => Number.isInteger(v) && v >= 0 && v <= 255) as number[]
      if (bytes.length) return Buffer.from(bytes)
    }
  }
  return Buffer.alloc(0)
}

export default defineEventHandler(async (event) => {
  // 必須用「未改動的 raw body」驗簽；Buffer 可避免部分環境字串解碼與 LINE 不一致。
  const raw = await readRawBody(event, false)
  const signature = getHeader(event, 'x-line-signature') ?? ''
  const requestOrigin = resolveRequestOrigin(event)

  const bodyBuf = toRawBodyBuffer(raw)

  const candidates = await listWorkspaceLineCredentials()
  let matchedWorkspaceId = ''
  let matchedSecret = ''
  if (bodyBuf.length > 0) {
    for (const row of candidates) {
      const secret = String(row.credentials.channelSecret || '').trim()
      if (!secret) continue
      if (await verifyLineWebhookSignature(bodyBuf, signature, { channelSecret: secret })) {
        matchedWorkspaceId = row.workspaceId
        matchedSecret = secret
        break
      }
    }
  }
  const secretConfigured = Boolean(matchedSecret)
  const sigOk = Boolean(matchedWorkspaceId)

  if (!sigOk) {
    console.warn('[webhook] signature verify failed', {
      secretConfigured,
      bodyBytes: bodyBuf.length,
      hasSignature: Boolean(String(signature || '').trim()),
      rawType: raw == null ? String(raw) : (raw as any).constructor?.name || typeof raw,
      workspaceCandidates: candidates.length,
    })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  const bodyText = bodyBuf.toString('utf8')
  let payload: { events: webhook.Event[] }
  try {
    payload = JSON.parse(bodyText)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' })
  }

  console.log('[webhook] received', payload.events.length, 'event(s):', payload.events.map(e => e.type))
  const tasks = payload.events.map(async (e) => {
    try {
      // 冪等去重：LINE redelivery（逾時重送）同一 webhookEventId 只處理一次
      const isFirstDelivery = await claimWebhookEvent(matchedWorkspaceId, (e as { webhookEventId?: string }).webhookEventId)
      if (!isFirstDelivery) {
        console.log('[webhook] duplicate event skipped:', e.type, (e as { webhookEventId?: string }).webhookEventId)
        return
      }
      if (e.type === 'message') {
        await handleMessageEvent(e as webhook.MessageEvent, { requestOrigin, workspaceId: matchedWorkspaceId })
      }
      else if (e.type === 'postback') {
        await handlePostbackEvent(e as webhook.PostbackEvent, { requestOrigin, workspaceId: matchedWorkspaceId })
      }
      else if (e.type === 'follow') {
        const userId = (e as webhook.FollowEvent).source?.userId
        if (userId) await handleFollowEvent(userId, undefined, matchedWorkspaceId)
      }
      else if (e.type === 'unfollow') {
        const userId = (e as webhook.UnfollowEvent).source?.userId
        if (userId) await handleUnfollowEvent(userId, matchedWorkspaceId)
      }
    }
    catch (err) {
      console.error('[webhook] event error:', err)
    }
  })

  await Promise.all(tasks)

  return { status: 'ok' }
})
