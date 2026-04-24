import { FieldValue } from 'firebase-admin/firestore'
import { syncPublishedEntryUrlForCampaign } from '~~/server/utils/lead-campaign-published-url'
import { normalizeCampaignScheduleInput, schedulePatchForUpdate } from '~~/server/utils/campaign-schedule'

function validateCampaign(body: any): string | null {
  if (!String(body?.name || '').trim()) return '請輸入活動名稱'
  if (!Array.isArray(body?.tagIds) || body.tagIds.length === 0) return '請至少選擇一個標籤'
  return null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const error = validateCampaign(body)
  if (error) throw createError({ statusCode: 400, statusMessage: error })

  const sched = normalizeCampaignScheduleInput(body)
  if (typeof sched === 'string') throw createError({ statusCode: 400, statusMessage: sched })

  const db = getDb()
  const snap = await db.collection('leadCampaigns').doc(id).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })

  const updates: Record<string, unknown> = {
    name: String(body.name).trim(),
    liffId: String(body.liffId ?? '').trim(),
    tagIds: (body.tagIds as string[]).map(String).filter(Boolean),
    moduleId: body.moduleId ? String(body.moduleId).trim() : null,
    description: String(body.description || '').trim(),
    isActive: body.isActive !== false,
    updatedAt: FieldValue.serverTimestamp(),
    ...schedulePatchForUpdate(sched),
  }

  await db.collection('leadCampaigns').doc(id).update(updates)

  const merged = { ...snap.data(), ...updates }
  const urlRes = await syncPublishedEntryUrlForCampaign(db, id, {
    liffId: String(merged.liffId ?? ''),
    campaignCode: String(merged.campaignCode ?? ''),
    isActive: merged.isActive !== false,
    tagIds: merged.tagIds,
    moduleId: merged.moduleId,
  })

  return {
    id,
    name: String(updates.name),
    liffId: String(updates.liffId),
    tagIds: updates.tagIds as string[],
    moduleId: updates.moduleId as string | null,
    description: String(updates.description),
    isActive: Boolean(updates.isActive),
    startsAt: sched.startsAt,
    endsAt: sched.endsAt,
    publishedCtaUrl: urlRes.publishedCtaUrl,
  }
})
