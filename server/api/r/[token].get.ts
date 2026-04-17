import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { BroadcastClickLogDoc } from '~~/shared/types/tag-broadcast'

/**
 * GET /api/r/:token
 * 推播點擊追蹤 redirect
 *
 * token 格式（Base64url）:
 *   `${campaignId}|${deliveryId}|${userId}|${linkKey}|${targetUrl}`
 *
 * 流程：
 * 1. 解碼 token
 * 2. 寫入 broadcastClickLogs
 * 3. 302 redirect 到 targetUrl
 *
 * 若 token 無效，直接 redirect 到首頁，不顯示錯誤頁
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  if (!token) {
    return sendRedirect(event, '/', 302)
  }

  let campaignId = ''
  let deliveryId = ''
  let userId = ''
  let linkKey = ''
  let targetUrl = ''

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split('|')
    if (parts.length < 5) throw new Error('invalid token')
    const restParts = parts.slice(4)
    campaignId = parts[0] ?? ''
    deliveryId = parts[1] ?? ''
    userId = parts[2] ?? ''
    linkKey = parts[3] ?? ''
    targetUrl = restParts.join('|') // URL 本身可能含 | 符號
  }
  catch {
    return sendRedirect(event, '/', 302)
  }

  if (!targetUrl.startsWith('http')) {
    return sendRedirect(event, '/', 302)
  }

  // 寫入點擊 log（非同步，不阻塞 redirect）
  try {
    const db = getDb()
    const logDoc: BroadcastClickLogDoc = {
      campaignId,
      deliveryId: deliveryId || null,
      userId: userId || null,
      linkKey,
      targetUrl,
      clickedAt: FieldValue.serverTimestamp(),
    }
    await db.collection('broadcastClickLogs').doc(uuidv4()).set(logDoc)
  }
  catch (err) {
    console.error('[click-track] Failed to write click log:', err)
  }

  return sendRedirect(event, targetUrl, 302)
})
