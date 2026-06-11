import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore'
import type { LeadClaimDoc } from '~~/shared/types/lead-campaign'
import { getUserProfile } from '~~/server/utils/line'
import { resolveLineOaBasicId } from '~~/server/utils/line-oa-basic-id'
import { verifyLiffAccessToken, warnOnLiffChannelMismatch } from '~~/server/utils/liff-token'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

function sharedUserClaimDocId(campaignId: string, lineUserId: string): string {
  return createHash('sha256').update(`lead_shared|${campaignId}|${lineUserId}`).digest('hex')
}

function deriveUserRowTokenHash(campaignId: string, lineUserId: string): string {
  return createHash('sha256').update(`shared_user_row|${campaignId}|${lineUserId}`).digest('hex')
}

function buildUserClaimFromTemplate(
  template: DocumentData,
  templateRef: DocumentReference,
  lineUserIdForRow: string,
): LeadClaimDoc {
  const workspaceId = String(template.workspaceId || '').trim()
  const campaignId = String(template.campaignId || '').trim()
  return {
    workspaceId,
    campaignId,
    campaignCode: String(template.campaignCode || ''),
    tokenHash: deriveUserRowTokenHash(campaignId, lineUserIdForRow),
    sharedEntry: false,
    linkedTemplateClaimId: templateRef.id,
    lineUserId: null,
    status: 'pending',
    tagIds: Array.isArray(template.tagIds) ? template.tagIds.map(String).filter(Boolean) : [],
    moduleId: template.moduleId != null ? String(template.moduleId) : null,
    action: template.action ?? null,
    redirectUrl: template.redirectUrl != null ? template.redirectUrl : null,
    expiresAt: template.expiresAt ?? null,
    claimedAt: null,
    appliedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  }
}

function buildUserClaimTemplatePatch(
  template: DocumentData,
  templateRef: DocumentReference,
): Partial<LeadClaimDoc> {
  return {
    workspaceId: String(template.workspaceId || '').trim(),
    campaignId: String(template.campaignId || '').trim(),
    campaignCode: String(template.campaignCode || ''),
    linkedTemplateClaimId: templateRef.id,
    tagIds: Array.isArray(template.tagIds) ? template.tagIds.map(String).filter(Boolean) : [],
    moduleId: template.moduleId != null ? String(template.moduleId) : null,
    action: template.action ?? null,
    redirectUrl: template.redirectUrl != null ? template.redirectUrl : null,
    expiresAt: template.expiresAt ?? null,
  }
}

/**
 * POST /api/liff/claim
 *
 * LIFF 頁面取得 LINE userId 後呼叫此 API，完成 token 兌換與身份綁定。
 * - 若使用者已加好友，立即觸發 handleFollowEvent 完成貼標；否則等待 follow webhook。
 * - 若 claim 已是 applied 狀態（同一使用者），重置並重新觸發貼標與模組。
 * - 活動「進入網址」模板（sharedEntry）可多人共用同一連結；每人會寫入獨立 leadClaims 列。
 *
 * Body:
 * {
 *   rawToken: string    // CTA URL 中的 ct= 參數（原始 token，未 hash）
 *   accessToken: string // liff.getAccessToken()；後端向 LINE 驗證後取得真實 userId
 * }
 *
 * Response:
 * {
 *   ok: true
 *   campaignCode: string
 *   redirectUrl?: string         // 活動設定的完成後轉址網址（有設定才有此欄位）
 *   lineOaBasicId?: string       // 官方帳號 basicId，供前端開啟對話／加好友 deeplink（活動進入網址未帶 workspace 時仍可取得）
 *   immediatelyApplied?: true    // 使用者已加好友，本次立即完成貼標
 * }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const rawToken = String(body?.rawToken || '').trim()
  const accessToken = String(body?.accessToken || '').trim()

  if (!rawToken || !accessToken) {
    throw createError({ statusCode: 400, statusMessage: 'rawToken and accessToken are required' })
  }

  // userId 一律以 LINE 驗證結果為準，不信任 client 自報（防冒用他人身分兌換／觸發推播）
  const verifiedUser = await verifyLiffAccessToken(accessToken)
  const lineUserId = verifiedUser.userId

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const db = getDb()

  const sharedSnap = await db.collection('leadClaims')
    .where('tokenHash', '==', tokenHash)
    .where('sharedEntry', '==', true)
    .limit(1)
    .get()

  let claimData: DocumentData
  let claimRef: DocumentReference
  if (!sharedSnap.empty) {
    const templateSnap = sharedSnap.docs[0]
    if (!templateSnap) {
      throw createError({ statusCode: 404, statusMessage: 'Claim not found or invalid token' })
    }
    const templateData = templateSnap.data()
    const campaignId = String(templateData?.campaignId || '').trim()
    if (!campaignId) {
      throw createError({ statusCode: 409, statusMessage: 'Claim missing campaignId' })
    }

    const rawExpT = templateData?.expiresAt
    if (rawExpT != null) {
      const expiresAt = rawExpT instanceof Date ? rawExpT : rawExpT?.toDate?.()
      if (expiresAt && expiresAt < new Date()) {
        await templateSnap.ref.update({ status: 'expired' })
        throw createError({ statusCode: 410, statusMessage: '此連結已逾期，請重新取得' })
      }
    }

    const userRef = db.collection('leadClaims').doc(sharedUserClaimDocId(campaignId, lineUserId))
    const userSnap = await userRef.get()
    claimRef = userRef
    if (!userSnap.exists) {
      const newDoc = buildUserClaimFromTemplate(templateData, templateSnap.ref, lineUserId)
      await userRef.set(newDoc)
      claimData = newDoc
    }
    else {
      // 同一使用者重複進入時，需同步最新活動模板，避免沿用舊的觸發設定。
      const patch = buildUserClaimTemplatePatch(templateData, templateSnap.ref)
      await userRef.set(patch, { merge: true })
      claimData = { ...userSnap.data()!, ...patch }
    }
  }
  else {
    const legacySnap = await db.collection('leadClaims')
      .where('tokenHash', '==', tokenHash)
      .limit(1)
      .get()

    if (legacySnap.empty) {
      throw createError({ statusCode: 404, statusMessage: 'Claim not found or invalid token' })
    }
    const d = legacySnap.docs[0]
    if (!d) {
      throw createError({ statusCode: 404, statusMessage: 'Claim not found or invalid token' })
    }
    claimRef = d.ref
    claimData = d.data()!
  }

  const claim = claimData
  const docRef = claimRef

  // 若已完成（applied），同一使用者可重新觸發貼標與模組；不同使用者則拒絕
  if (claim.status === 'applied') {
    if (claim.lineUserId && claim.lineUserId !== lineUserId) {
      throw createError({ statusCode: 409, statusMessage: 'Token already claimed by another user' })
    }
    // 同一使用者：重置 appliedAt，下方 update 會設回 claimed，讓 handleFollowEvent 重新套用
  }

  // 逾期檢查（僅舊 claim 含 expiresAt 時有效；新產生連結不設期限）
  const rawExp = claim.expiresAt
  if (rawExp != null) {
    const expiresAt = rawExp instanceof Date ? rawExp : rawExp?.toDate?.()
    if (expiresAt && expiresAt < new Date()) {
      await docRef.update({ status: 'expired' })
      throw createError({ statusCode: 410, statusMessage: '此連結已逾期，請重新取得' })
    }
  }

  // 若已有另一個 lineUserId 綁定（不同人搶用），拒絕（舊版單人一 token）
  if (claim.lineUserId && claim.lineUserId !== lineUserId) {
    throw createError({ statusCode: 409, statusMessage: 'Token already claimed by another user' })
  }

  // 並行：Firestore 更新 + 查詢是否已加好友（兩者互不依賴）
  const claimWorkspaceId = String(claim.workspaceId || '').trim()
  if (!claimWorkspaceId) {
    throw createError({ statusCode: 409, statusMessage: 'Claim missing workspaceId' })
  }

  // 觀測用：token 所屬 Login channel 與 workspace LIFF 設定不一致時記 log（不阻擋）
  getLineWorkspaceCredentials(claimWorkspaceId)
    .then(c => warnOnLiffChannelMismatch(verifiedUser, c.defaultLiffId, 'liff/claim'))
    .catch(() => {})

  const [, followProfile] = await Promise.all([
    docRef.update({
      lineUserId,
      status: 'claimed',
      claimedAt: FieldValue.serverTimestamp(),
      appliedAt: null,
    }),
    getUserProfile(lineUserId, claimWorkspaceId),
  ])

  // 若使用者已加好友，標記為 immediatelyApplied（樂觀）
  // 實際貼標與模組推播由前端背景呼叫 /api/liff/apply 完成，避免 LINE pushMessage API 阻塞回應
  const immediatelyApplied = !!followProfile
  const lineOaBasicId = await resolveLineOaBasicId(claimWorkspaceId).catch(() => '')

  const redirectUrl = String(claim.redirectUrl || '').trim() || undefined

  console.log('[liff/claim] claimed:', docRef.id, 'userId:', lineUserId, 'immediatelyApplied:', immediatelyApplied)
  return {
    ok: true,
    campaignCode: claim.campaignCode,
    immediatelyApplied,
    redirectUrl,
    ...(lineOaBasicId ? { lineOaBasicId } : {}),
    // 前端用於背景呼叫 /api/liff/apply（已加好友才需要）
    ...(immediatelyApplied ? { workspaceId: claimWorkspaceId } : {}),
  }
})
