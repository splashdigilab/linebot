/**
 * GET /api/richmenu/debug-aliases
 * Query LINE directly to see what aliases actually exist and what richMenuId they point to.
 */
export default defineEventHandler(async () => {
  const db = getDb()
  const snap = await db.collection('richmenus').get()

  const results = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const aliasId = data.aliasId ?? `menu-${doc.id}`

    let lineStatus: any = null
    try {
      lineStatus = await getRichMenuAlias(aliasId)
    } catch (e: any) {
      lineStatus = { error: e.message ?? String(e) }
    }

    results.push({
      firestoreId: doc.id,
      name: data.name,
      richMenuId: data.richMenuId,      // What Firestore thinks the richMenuId is
      aliasId,
      lineAlias: lineStatus,            // What LINE actually has for this alias
    })
  }

  return results
})
