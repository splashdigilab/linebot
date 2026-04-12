export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = getDb()
  await db.collection('autoReplies').doc(id).delete()
  return { id }
})
