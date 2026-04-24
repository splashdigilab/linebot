import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { LeadClaimDoc } from '~~/shared/types/lead-campaign'
import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'
import { normalizeAutoReplyAction } from '~~/shared/auto-reply-rule'

type CampaignForEntryUrl = {
  liffId?: string
  campaignCode?: string
  isActive?: boolean
  tagIds?: unknown
  moduleId?: unknown
  action?: unknown
}

/**
 * 依活動狀態同步「活動進入網址」：啟用且可解析 LIFF 時建立一筆 leadClaim 並寫入 leadCampaigns.publishedCtaUrl；
 * 停用或無 LIFF 時清除該欄位。
 */
export async function syncPublishedEntryUrlForCampaign(
  db: Firestore,
  campaignId: string,
  campaign: CampaignForEntryUrl,
): Promise<{ publishedCtaUrl: string | null; publishedClaimId: string | null }> {
  const { defaultLiffId: workspaceDefaultLiff } = await getLineWorkspaceCredentials()
  const liffId = String(campaign.liffId || '').trim() || String(workspaceDefaultLiff || '').trim()
  const isActive = campaign.isActive !== false

  if (!isActive || !liffId) {
    await db.collection('leadCampaigns').doc(campaignId).update({
      publishedCtaUrl: FieldValue.delete(),
      publishedClaimId: FieldValue.delete(),
    }).catch(() => {})
    return { publishedCtaUrl: null, publishedClaimId: null }
  }

  const rawToken = uuidv4()
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const claimId = uuidv4()
  const campaignCode = String(campaign.campaignCode || '')

  const mod = campaign.moduleId
  const hasActionType = Boolean(String((campaign.action as any)?.type ?? '').trim())
  const fallbackModule = mod != null ? String(mod).trim() : ''
  const action = hasActionType || fallbackModule
    ? normalizeAutoReplyAction(campaign.action, fallbackModule)
    : null
  const moduleId = action?.type === 'module' && action.moduleId ? action.moduleId : null

  const claimDoc: LeadClaimDoc = {
    campaignId,
    campaignCode,
    tokenHash,
    lineUserId: null,
    status: 'pending',
    tagIds: Array.isArray(campaign.tagIds) ? campaign.tagIds.map(String).filter(Boolean) : [],
    moduleId,
    action,
    claimedAt: null,
    appliedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  }

  const ctaUrl = `https://liff.line.me/${liffId}?ct=${rawToken}&c=${encodeURIComponent(campaignCode)}&liffId=${encodeURIComponent(liffId)}`

  const batch = db.batch()
  batch.set(db.collection('leadClaims').doc(claimId), claimDoc)
  batch.update(db.collection('leadCampaigns').doc(campaignId), {
    publishedCtaUrl: ctaUrl,
    publishedClaimId: claimId,
  })
  await batch.commit()

  return { publishedCtaUrl: ctaUrl, publishedClaimId: claimId }
}
