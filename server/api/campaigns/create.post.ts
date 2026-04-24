import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { generateLeadCampaignCode } from '~~/server/utils/lead-campaign-code'
import { syncPublishedEntryUrlForCampaign } from '~~/server/utils/lead-campaign-published-url'
import { normalizeCampaignScheduleInput } from '~~/server/utils/campaign-schedule'

function validateCampaign(body: any): string | null {
  if (!String(body?.name || '').trim()) return '請輸入活動名稱'
  const codeRaw = String(body?.campaignCode ?? '').trim()
  if (codeRaw && !/^[a-z0-9_]+$/.test(codeRaw)) return '活動代碼只能使用英文小寫、數字與底線'
  if (!Array.isArray(body?.tagIds) || body.tagIds.length === 0) return '請至少選擇一個標籤'
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const error = validateCampaign(body)
  if (error) throw createError({ statusCode: 400, statusMessage: error })

  const sched = normalizeCampaignScheduleInput(body)
  if (typeof sched === 'string') throw createError({ statusCode: 400, statusMessage: sched })

  const id = uuidv4()
  const now = FieldValue.serverTimestamp()
  const campaignCode = String(body.campaignCode ?? '').trim() || generateLeadCampaignCode()
  const doc: Record<string, unknown> = {
    name: String(body.name).trim(),
    campaignCode,
    liffId: String(body.liffId ?? '').trim(),
    tagIds: (body.tagIds as string[]).map(String).filter(Boolean),
    moduleId: body.moduleId ? String(body.moduleId).trim() : null,
    description: String(body.description || '').trim(),
    isActive: body.isActive !== false,
    createdAt: now,
    updatedAt: now,
  }
  if (sched.startsAt) doc.startsAt = sched.startsAt
  if (sched.endsAt) doc.endsAt = sched.endsAt

  const db = getDb()
  await db.collection('leadCampaigns').doc(id).set(doc)

  const urlRes = await syncPublishedEntryUrlForCampaign(db, id, {
    liffId: doc.liffId,
    campaignCode: doc.campaignCode,
    isActive: doc.isActive,
    tagIds: doc.tagIds,
    moduleId: doc.moduleId,
  })

  return { id, ...doc, publishedCtaUrl: urlRes.publishedCtaUrl ?? null }
})
