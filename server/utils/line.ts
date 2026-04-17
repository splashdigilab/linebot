import * as line from '@line/bot-sdk'
import { HTTPFetchError } from '@line/bot-sdk'
import { createHmac, timingSafeEqual } from 'crypto'
import { getLineWorkspaceCredentials } from './line-workspace-credentials'

function lineMulticastErrorDetail(err: unknown): string {
  if (err instanceof HTTPFetchError && err.body) return `${err.message} | ${err.body}`
  if (err instanceof Error) return err.message
  return String(err)
}

type MessagingBundle = {
  token: string
  client: line.messagingApi.MessagingApiClient
  blob: line.messagingApi.MessagingApiBlobClient
}

let _messaging: MessagingBundle | null = null
let _insight: { token: string; client: line.insight.InsightClient } | null = null

async function getMessagingBundle(): Promise<MessagingBundle> {
  const { channelAccessToken } = await getLineWorkspaceCredentials()
  const token = String(channelAccessToken || '').trim()
  if (!token) throw new Error('LINE channel access token is not set (Firestore workspaces/default or LINE_CHANNEL_ACCESS_TOKEN)')

  if (!_messaging || _messaging.token !== token) {
    _messaging = {
      token,
      client: new line.messagingApi.MessagingApiClient({ channelAccessToken: token }),
      blob: new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: token }),
    }
  }
  return _messaging
}

/** Verify x-line-signature（憑證來自 Firestore 或 env） */
export async function verifyLineWebhookSignature(body: string, signature: string): Promise<boolean> {
  const { channelSecret } = await getLineWorkspaceCredentials()
  const secret = String(channelSecret || '').trim()
  if (!secret) return false
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('base64')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  }
  catch {
    return false
  }
}

/** LINE Insight（開封／官方互動統計） */
export async function getInsightClient(): Promise<line.insight.InsightClient> {
  const { channelAccessToken } = await getLineWorkspaceCredentials()
  const token = String(channelAccessToken || '').trim()
  if (!token) throw new Error('LINE channel access token is not set')

  if (!_insight || _insight.token !== token) {
    _insight = {
      token,
      client: new line.insight.InsightClient({ channelAccessToken: token }),
    }
  }
  return _insight.client
}

/** Reply to a LINE event's replyToken */
export async function replyMessage(
  replyToken: string,
  messages: line.messagingApi.Message[],
) {
  const { client } = await getMessagingBundle()
  return client.replyMessage({ replyToken, messages })
}

/** Push a message to a LINE userId */
export async function pushMessage(userId: string, messages: line.messagingApi.Message[]) {
  const { client } = await getMessagingBundle()
  return client.pushMessage({ to: userId, messages })
}

/** Create a Rich Menu and return its richMenuId */
export async function createRichMenu(richMenu: line.messagingApi.RichMenuRequest) {
  const { client } = await getMessagingBundle()
  const res = await client.createRichMenu(richMenu)
  return res.richMenuId
}

/** Upload image to a Rich Menu */
export async function uploadRichMenuImage(
  richMenuId: string,
  imageBuffer: Buffer,
  contentType: 'image/jpeg' | 'image/png',
) {
  const { blob } = await getMessagingBundle()
  return blob.setRichMenuImage(richMenuId, new Blob([imageBuffer], { type: contentType }))
}

/** Set the default Rich Menu for all users */
export async function setDefaultRichMenu(richMenuId: string) {
  const { client } = await getMessagingBundle()
  return client.setDefaultRichMenu(richMenuId)
}

/** Delete a Rich Menu from LINE */
export async function deleteLineRichMenu(richMenuId: string) {
  const { client } = await getMessagingBundle()
  return client.deleteRichMenu(richMenuId)
}

export type MulticastOptions = {
  /** LINE 彙總單位（最多 1 個），用於查詢開封／官方網址點擊統計 */
  customAggregationUnits?: string[]
}

/**
 * Multicast messages to multiple LINE userIds.
 * LINE API 限制單次最多 500 人，此函式自動分批處理。
 */
export async function multicastMessage(
  userIds: string[],
  messages: line.messagingApi.Message[],
  options?: MulticastOptions,
): Promise<{ successCount: number; failedIds: string[]; lineAggregationApplied: boolean }> {
  const { client } = await getMessagingBundle()
  const BATCH_SIZE = 500
  let successCount = 0
  const failedIds: string[] = []
  const units = options?.customAggregationUnits?.length
    ? [options.customAggregationUnits[0]]
    : undefined
  /** 僅當所有批次皆以 customAggregationUnits 成功送出時為 true（任一批改走無彙總重試則 false） */
  let lineAggregationApplied = Boolean(units?.length)

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE)
    const sendWithUnits = Boolean(units?.length && lineAggregationApplied)
    try {
      await client.multicast(
        sendWithUnits
          ? { to: batch, messages, customAggregationUnits: units! }
          : { to: batch, messages },
      )
      successCount += batch.length
    }
    catch (err) {
      if (sendWithUnits && units) {
        console.warn(
          `[multicastMessage] batch ${i}~${i + batch.length - 1} 帶 customAggregationUnits 失敗，改為不帶彙總重試：`,
          lineMulticastErrorDetail(err),
        )
        lineAggregationApplied = false
        try {
          await client.multicast({ to: batch, messages })
          successCount += batch.length
        }
        catch (err2) {
          console.error(
            `[multicastMessage] batch ${i}~${i + batch.length - 1} failed:`,
            lineMulticastErrorDetail(err2),
          )
          failedIds.push(...batch)
        }
      }
      else {
        console.error(
          `[multicastMessage] batch ${i}~${i + batch.length - 1} failed:`,
          lineMulticastErrorDetail(err),
        )
        failedIds.push(...batch)
      }
    }
  }

  return { successCount, failedIds, lineAggregationApplied }
}

const LINE_MESSAGING_ORIGIN = 'https://api.line.me/v2'

/**
 * 取得已加官方帳號為好友的 userId 清單（Messaging API GET /bot/followers/ids，分頁）。
 * 用於補齊 Firestore users：僅靠訊息／postback 寫入時，不會包含「加好友後從未互動」的帳號。
 */
export async function fetchAllFollowerUserIds(options?: {
  /** 最多收集幾個 userId（避免極大帳號一次佔滿記憶體） */
  maxIds?: number
}): Promise<{ userIds: string[]; truncated: boolean }> {
  const { channelAccessToken } = await getLineWorkspaceCredentials()
  const token = String(channelAccessToken || '').trim()
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set')

  const maxIds = Math.min(Math.max(1, options?.maxIds ?? 80_000), 100_000)
  const all: string[] = []
  let start: string | undefined
  let truncated = false

  while (all.length < maxIds) {
    const url = new URL(`${LINE_MESSAGING_ORIGIN}/bot/followers/ids`)
    url.searchParams.set('limit', '1000')
    if (start) url.searchParams.set('start', start)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`LINE followers/ids ${res.status}: ${text}`)
    }
    let data: { userIds?: string[]; next?: string }
    try {
      data = JSON.parse(text) as { userIds?: string[]; next?: string }
    }
    catch {
      throw new Error(`LINE followers/ids invalid JSON: ${text.slice(0, 240)}`)
    }

    const ids = data.userIds ?? []
    const room = maxIds - all.length
    if (ids.length > room) {
      all.push(...ids.slice(0, room))
      truncated = true
      break
    }
    all.push(...ids)
    if (!data.next || ids.length === 0) break
    start = data.next
  }

  return { userIds: all, truncated }
}

/** Get user profile */
export async function getUserProfile(userId: string) {
  try {
    const { client } = await getMessagingBundle()
    return await client.getProfile(userId)
  }
  catch {
    return null
  }
}

/** Link a specific Rich Menu to a User */
export async function linkRichMenuIdToUser(userId: string, richMenuId: string) {
  const { client } = await getMessagingBundle()
  return client.linkRichMenuIdToUser(userId, richMenuId)
}

/** Create a Rich Menu Alias (for instant richmenuswitch) */
export async function createRichMenuAlias(richMenuId: string, richMenuAliasId: string) {
  const { client } = await getMessagingBundle()
  return client.createRichMenuAlias({ richMenuId, richMenuAliasId })
}

/** Delete a Rich Menu Alias */
export async function deleteRichMenuAlias(richMenuAliasId: string) {
  const { client } = await getMessagingBundle()
  try {
    return await client.deleteRichMenuAlias(richMenuAliasId)
  } catch {
    // Ignore if alias doesn't exist
  }
}

/** Update a Rich Menu Alias to point to a new richMenuId.
 *  LINE doesn't have a direct "update" API, so we delete then recreate. */
export async function updateRichMenuAlias(richMenuId: string, richMenuAliasId: string) {
  await deleteRichMenuAlias(richMenuAliasId)
  return createRichMenuAlias(richMenuId, richMenuAliasId)
}

/** Get Rich Menu Alias details from LINE */
export async function getRichMenuAlias(richMenuAliasId: string) {
  const { client } = await getMessagingBundle()
  return client.getRichMenuAlias(richMenuAliasId)
}
