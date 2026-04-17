import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

/**
 * POST /api/richmenu/migrate-aliases
 * Uses raw fetch (not SDK) to expose LINE's actual error body.
 */
export default defineEventHandler(async () => {
  const { channelAccessToken: token } = await getLineWorkspaceCredentials()

  const db = getDb()
  const snap = await db.collection('richmenus').get()

  const results: any[] = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const firestoreId = doc.id
    // ALWAYS recalculate in correct format — max 32 chars, alphanumeric only (LINE requirement)
    // Ignore any previously stored aliasId which may have been in wrong format
    const aliasId = `rm${firestoreId.replace(/-/g, '').slice(0, 28)}`
    const richMenuId = data.richMenuId

    if (!richMenuId) {
      results.push({ id: firestoreId, name: data.name, aliasId, status: 'skipped', detail: 'no richMenuId' })
      continue
    }

    // Step 1: Delete existing alias (raw fetch, ignore all errors)
    try {
      await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {}

    // Step 2: Create fresh alias using raw fetch to get real LINE error
    const res = await fetch('https://api.line.me/v2/bot/richmenu/alias', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ richMenuId, richMenuAliasId: aliasId }),
    })

    const resBody = await res.json().catch(() => ({}))

    if (res.ok) {
      // Save aliasId to Firestore
      await updateDoc('richmenus', firestoreId, { aliasId })
      results.push({ id: firestoreId, name: data.name, aliasId, richMenuId, status: 'created ✅' })
    } else {
      results.push({
        id: firestoreId,
        name: data.name,
        aliasId,
        richMenuId,
        status: `failed ❌ (HTTP ${res.status})`,
        detail: resBody,  // ← This is LINE's real error JSON
      })
    }
  }

  return { total: results.length, results }
})
