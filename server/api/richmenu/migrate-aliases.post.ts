/**
 * POST /api/richmenu/migrate-aliases
 * Force-recreates aliases for all existing rich menus.
 * Safe to call multiple times — always deletes then recreates.
 */
export default defineEventHandler(async () => {
  const db = getDb()
  const snap = await db.collection('richmenus').get()

  const results: { id: string; name: string; aliasId: string; richMenuId: string; status: string; detail?: string }[] = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const firestoreId = doc.id
    const aliasId = data.aliasId ?? `menu-${firestoreId}`
    const richMenuId = data.richMenuId

    if (!richMenuId) {
      results.push({ id: firestoreId, name: data.name, aliasId, richMenuId: '', status: 'skipped (no richMenuId)' })
      continue
    }

    // Step 1: Delete existing alias (ignore errors)
    try {
      await deleteRichMenuAlias(aliasId)
    } catch {}

    // Step 2: Create fresh alias
    try {
      await createRichMenuAlias(richMenuId, aliasId)
      // Save aliasId to Firestore
      await updateDoc('richmenus', firestoreId, { aliasId })
      results.push({ id: firestoreId, name: data.name, aliasId, richMenuId, status: 'created ✅' })
    } catch (e: any) {
      // Try to extract LINE's real error body
      let detail = e?.message ?? String(e)
      try {
        const resp = e?.cause ?? e?.originalError?.response
        if (resp?.json) {
          const body = await resp.json()
          detail = JSON.stringify(body)
        }
      } catch {}
      results.push({ id: firestoreId, name: data.name, aliasId, richMenuId, status: 'failed ❌', detail })
    }
  }

  return { total: results.length, results }
})
