export default defineEventHandler(async () => {
  const db = getDb()
  const snap = await db.collection('autoReplies').orderBy('createdAt', 'desc').get()
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
})
