import { requireSuperAdmin } from '~~/server/utils/workspace-auth'
import { getDb } from '~~/server/utils/firebase'

/**
 * GET /api/admin/super/leads
 * 列出潛在客戶名單（demoLeads），最新在前。僅 super admin。
 *
 * 目前量小，一次撈最近 200 筆即可；日後量大再加分頁 / 狀態過濾。
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  const db = getDb()
  const snap = await db.collection('demoLeads')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()

  return snap.docs.map((d) => {
    const data = d.data()
    const created = data.createdAt
    return {
      id: d.id,
      name: data.name ?? '',
      contact: data.contact ?? '',
      industry: data.industry ?? '',
      need: data.need ?? '',
      interestedPlanId: data.interestedPlanId ?? null,
      source: data.source ?? 'landing_demo',
      status: data.status ?? 'new',
      note: data.note ?? null,
      // Timestamp → millis（前端好格式化）；避免把整個 Timestamp 物件塞回去
      createdAt: created?.toMillis ? created.toMillis() : null,
    }
  })
})
