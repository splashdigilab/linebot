/**
 * GET /api/campaigns/:id/stats
 *
 * 回傳此活動的 leadClaims 漏斗統計：
 *   total    → 產生過的 CTA 總數
 *   pending  → 尚未進入 LIFF
 *   claimed  → 已綁定 LINE 身份，等待加好友
 *   applied  → 已加好友並完成貼標
 *   expired  → 逾期未使用
 */
export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')!
  const db = getDb()

  const campaignSnap = await db.collection('leadCampaigns').doc(campaignId).get()
  if (!campaignSnap.exists) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })

  const snap = await db.collection('leadClaims')
    .where('campaignId', '==', campaignId)
    .get()

  const stats = { total: 0, pending: 0, claimed: 0, applied: 0, expired: 0 }

  for (const doc of snap.docs) {
    const status = doc.data().status as string
    stats.total++
    if (status === 'pending') stats.pending++
    else if (status === 'claimed') stats.claimed++
    else if (status === 'applied') stats.applied++
    else if (status === 'expired') stats.expired++
  }

  // 轉換率（避免除以零）
  const claimRate = stats.total > 0 ? Math.round((stats.claimed + stats.applied) / stats.total * 100) : 0
  const applyRate = stats.total > 0 ? Math.round(stats.applied / stats.total * 100) : 0

  return { campaignId, ...stats, claimRate, applyRate }
})
