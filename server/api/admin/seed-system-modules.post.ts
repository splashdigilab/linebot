import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { SYSTEM_MODULE_IDS } from '~~/shared/types/conversation-stats'
import { requireFirebaseAuth } from '~~/server/utils/admin-auth'

const SYSTEM_MODULES = [
  {
    id: SYSTEM_MODULE_IDS.welcome,
    name: '歡迎模組',
    moduleType: 'welcome' as const,
  },
  {
    id: SYSTEM_MODULE_IDS.live_agent,
    name: '真人客服',
    moduleType: 'live_agent' as const,
  },
]

export default defineEventHandler(async (event) => {
  await requireFirebaseAuth(event)
  const db = getDb()
  const results: Array<{ id: string; created: boolean }> = []

  for (const mod of SYSTEM_MODULES) {
    const ref = db.collection('flows').doc(mod.id)
    const snap = await ref.get()

    if (!snap.exists) {
      await ref.set({
        name: mod.name,
        moduleType: mod.moduleType,
        isSystem: true,
        messages: [],
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      results.push({ id: mod.id, created: true })
    } else {
      // Ensure isSystem flag is set on existing docs
      if (!snap.data()?.isSystem) {
        await ref.update({ isSystem: true, moduleType: mod.moduleType })
      }
      results.push({ id: mod.id, created: false })
    }
  }

  return { ok: true, results }
})
