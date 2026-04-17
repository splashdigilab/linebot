import { FieldValue } from 'firebase-admin/firestore'

function validateCampaign(body: any): string | null {
  if (!String(body?.name || '').trim()) return '請輸入活動名稱'
  if (!String(body?.campaignCode || '').trim()) return '請輸入活動代碼'
  if (!/^[a-z0-9_]+$/.test(String(body.campaignCode).trim())) return '活動代碼只能使用英文小寫、數字與底線'
  if (!String(body?.liffId || '').trim()) return '請輸入 LIFF ID'
  if (!Array.isArray(body?.tagIds) || body.tagIds.length === 0) return '請至少選擇一個標籤'
  return null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const error = validateCampaign(body)
  if (error) throw createError({ statusCode: 400, statusMessage: error })

  const db = getDb()
  const snap = await db.collection('leadCampaigns').doc(id).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })

  const updates = {
    name: String(body.name).trim(),
    campaignCode: String(body.campaignCode).trim(),
    liffId: String(body.liffId).trim(),
    tagIds: (body.tagIds as string[]).map(String).filter(Boolean),
    moduleId: body.moduleId ? String(body.moduleId).trim() : null,
    description: String(body.description || '').trim(),
    isActive: body.isActive !== false,
    updatedAt: FieldValue.serverTimestamp(),
  }

  await db.collection('leadCampaigns').doc(id).update(updates)
  return { id, ...updates }
})
