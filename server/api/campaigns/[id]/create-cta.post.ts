import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { LeadClaimDoc } from '~~/shared/types/lead-campaign'

const CLAIM_TTL_MS = 72 * 60 * 60 * 1000 // 72 小時

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')!
  const db = getDb()

  const snap = await db.collection('leadCampaigns').doc(campaignId).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })

  const campaign = snap.data()!
  if (!campaign.liffId) throw createError({ statusCode: 400, statusMessage: 'Campaign 未設定 LIFF ID' })
  if (!campaign.isActive) throw createError({ statusCode: 400, statusMessage: 'Campaign 已停用' })

  const rawToken = uuidv4()
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const claimId = uuidv4()
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS)

  const claimDoc: LeadClaimDoc = {
    campaignId,
    campaignCode: String(campaign.campaignCode || ''),
    tokenHash,
    lineUserId: null,
    status: 'pending',
    tagIds: Array.isArray(campaign.tagIds) ? campaign.tagIds : [],
    moduleId: campaign.moduleId ?? null,
    expiresAt,
    claimedAt: null,
    appliedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  }

  await db.collection('leadClaims').doc(claimId).set(claimDoc)

  const ctaUrl = `https://liff.line.me/${campaign.liffId}?ct=${rawToken}&c=${encodeURIComponent(campaign.campaignCode)}`
  return { ctaUrl, claimId, expiresAt: expiresAt.toISOString() }
})
