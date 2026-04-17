export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = getDb()
  const snap = await db.collection('leadCampaigns').doc(id).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })
  await db.collection('leadCampaigns').doc(id).delete()
  return { success: true, id }
})
