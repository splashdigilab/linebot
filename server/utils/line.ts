import * as line from '@line/bot-sdk'
import { createHmac, timingSafeEqual } from 'crypto'

let _client: line.messagingApi.MessagingApiClient
let _blobClient: line.messagingApi.MessagingApiBlobClient

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
