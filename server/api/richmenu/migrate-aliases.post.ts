/**
 * POST /api/richmenu/migrate-aliases
 * One-time migration: creates aliases for all existing rich menus that don't have one.
 * Safe to call multiple times.
 */
export default defineEventHandler(async () => {
  const db = getDb()
  const snap = await db.collection('richmenus').get()

  const results: { id: string; aliasId: string; status: string }[] = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const firestoreId = doc.id
    const aliasId = data.aliasId ?? `menu-${firestoreId}`

    if (!data.richMenuId) {
      results.push({ id: firestoreId, aliasId, status: 'skipped (no richMenuId)' })
      continue
    }

    try {
      await createRichMenuAlias(data.richMenuId, aliasId)
      // Save aliasId to Firestore if missing
      if (!data.aliasId) {
        await updateDoc('richmenus', firestoreId, { aliasId })
      }
      results.push({ id: firestoreId, aliasId, status: 'created' })
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      // Alias already exists = fine
      if (msg.includes('already') || msg.includes('400')) {
        if (!data.aliasId) {
          await updateDoc('richmenus', firestoreId, { aliasId })
        }
        results.push({ id: firestoreId, aliasId, status: 'already exists (ok)' })
      } else {
        results.push({ id: firestoreId, aliasId, status: `error: ${msg}` })
      }
    }
  }

  return { migrated: results.length, results }
})
