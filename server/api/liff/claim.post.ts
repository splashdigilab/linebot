import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * POST /api/liff/claim
 *
 * LIFF 頁面取得 LINE userId 後呼叫此 API，完成 token 兌換與身份綁定。
 * 後續等待使用者加好友（follow webhook），再由 handleFollowEvent 完成貼標。
 *
 * Body:
 * {
 *   rawToken: string   // CTA URL 中的 ct= 參數（原始 token，未 hash）
 *   lineUserId: string // liff.getProfile().userId
 * }
 *
 * Response:
 * {
 *   ok: true
 *   campaignCode: string
 *   alreadyApplied?: true   // 已完成貼標（follow 已觸發）
 * }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const rawToken = String(body?.rawToken || '').trim()
  const lineUserId = String(body?.lineUserId || '').trim()

  if (!rawToken || !lineUserId) {
    throw createError({ statusCode: 400, statusMessage: 'rawToken and lineUserId are required' })
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const db = getDb()

  const snap = await db.collection('leadClaims')
    .where('tokenHash', '==', tokenHash)
    .limit(1)
    .get()

  if (snap.empty) {
    throw createError({ statusCode: 404, statusMessage: 'Claim not found or invalid token' })
  }

  const doc = snap.docs[0]
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Claim not found or invalid token' })
  }
  const claim = doc.data()

  // 已完成貼標，冪等回應
  if (claim.status === 'applied') {
    return { ok: true, alreadyApplied: true, campaignCode: claim.campaignCode }
  }

  // 逾期檢查（僅舊 claim 含 expiresAt 時有效；新產生連結不設期限）
  const rawExp = claim.expiresAt
  if (rawExp != null) {
    const expiresAt = rawExp instanceof Date ? rawExp : rawExp?.toDate?.()
    if (expiresAt && expiresAt < new Date()) {
      await doc.ref.update({ status: 'expired' })
      throw createError({ statusCode: 410, statusMessage: '此連結已逾期，請重新取得' })
    }
  }

  // 若已有另一個 lineUserId 綁定（不同人搶用），拒絕
  if (claim.lineUserId && claim.lineUserId !== lineUserId) {
    throw createError({ statusCode: 409, statusMessage: 'Token already claimed by another user' })
  }

  await doc.ref.update({
    lineUserId,
    status: 'claimed',
    claimedAt: FieldValue.serverTimestamp(),
  })

  console.log('[liff/claim] claimed:', doc.id, 'userId:', lineUserId)
  return { ok: true, campaignCode: claim.campaignCode }
})
