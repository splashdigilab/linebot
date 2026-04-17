import * as line from '@line/bot-sdk'
import { HTTPFetchError } from '@line/bot-sdk'
import { createHmac, timingSafeEqual } from 'crypto'

function lineMulticastErrorDetail(err: unknown): string {
  if (err instanceof HTTPFetchError && err.body) return `${err.message} | ${err.body}`
  if (err instanceof Error) return err.message
  return String(err)
}

let _client: line.messagingApi.MessagingApiClient
let _blobClient: line.messagingApi.MessagingApiBlobClient
let _insightClient: line.insight.InsightClient | null = null

function getClient() {
  if (!_client) {
    const config = useRuntimeConfig()
    _client = new line.messagingApi.MessagingApiClient({
      channelAccessToken: config.lineChannelAccessToken,
    })
  }
  return _client
}

function getBlobClient() {
  if (!_blobClient) {
    const config = useRuntimeConfig()
    _blobClient = new line.messagingApi.MessagingApiBlobClient({
      channelAccessToken: config.lineChannelAccessToken,
    })
  }
  return _blobClient
}

/** LINE Insight（開封／官方互動統計） */
export function getInsightClient(): line.insight.InsightClient {
  if (!_insightClient) {
    const config = useRuntimeConfig()
    _insightClient = new line.insight.InsightClient({
      channelAccessToken: config.lineChannelAccessToken,
    })
  }
  return _insightClient
}

/** Verify x-line-signature header */
export function verifySignature(body: string, signature: string): boolean {
  const config = useRuntimeConfig()
  const expected = createHmac('sha256', config.lineChannelSecret)
    .update(body)
    .digest('base64')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  }
  catch {
    return false
  }
}

/** Reply to a LINE event's replyToken */
export async function replyMessage(
  replyToken: string,
  messages: line.messagingApi.Message[],
) {
  return getClient().replyMessage({ replyToken, messages })
}

/** Push a message to a LINE userId */
export async function pushMessage(userId: string, messages: line.messagingApi.Message[]) {
  return getClient().pushMessage({ to: userId, messages })
}

/** Create a Rich Menu and return its richMenuId */
export async function createRichMenu(richMenu: line.messagingApi.RichMenuRequest) {
  const res = await getClient().createRichMenu(richMenu)
  return res.richMenuId
}

/** Upload image to a Rich Menu */
export async function uploadRichMenuImage(
  richMenuId: string,
  imageBuffer: Buffer,
  contentType: 'image/jpeg' | 'image/png',
) {
  return getBlobClient().setRichMenuImage(richMenuId, new Blob([imageBuffer], { type: contentType }))
}

/** Set the default Rich Menu for all users */
export async function setDefaultRichMenu(richMenuId: string) {
  return getClient().setDefaultRichMenu(richMenuId)
}

/** Delete a Rich Menu from LINE */
export async function deleteLineRichMenu(richMenuId: string) {
  return getClient().deleteRichMenu(richMenuId)
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
      await getClient().multicast(
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
          await getClient().multicast({ to: batch, messages })
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

/** Get user profile */
export async function getUserProfile(userId: string) {
  try {
    return await getClient().getProfile(userId)
  }
  catch {
    return null
  }
}

/** Link a specific Rich Menu to a User */
export async function linkRichMenuIdToUser(userId: string, richMenuId: string) {
  return getClient().linkRichMenuIdToUser(userId, richMenuId)
}

/** Create a Rich Menu Alias (for instant richmenuswitch) */
export async function createRichMenuAlias(richMenuId: string, richMenuAliasId: string) {
  return getClient().createRichMenuAlias({ richMenuId, richMenuAliasId })
}

/** Delete a Rich Menu Alias */
export async function deleteRichMenuAlias(richMenuAliasId: string) {
  try {
    return await getClient().deleteRichMenuAlias(richMenuAliasId)
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
  return getClient().getRichMenuAlias(richMenuAliasId)
}


