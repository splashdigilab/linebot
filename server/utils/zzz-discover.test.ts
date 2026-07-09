import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'

const cfg = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
}
;(globalThis as any).useRuntimeConfig = () => cfg
;(globalThis as any).createError = (o: any) => new Error(typeof o === 'string' ? o : o?.message)

const WS = 'f2d418e2-9f5a-4123-86db-2d9d5bc6a779'

it('dump chunk titles', async () => {
  const { getDb } = await import('./firebase')
  const db = getDb()
  const snap = await db.collection('knowledgeChunks')
    .where('workspaceId', '==', WS)
    .select('title', 'isOverview', 'sourceId')
    .get()
  const rows = snap.docs.map((d) => {
    const x = d.data() as any
    return { title: x.title, ov: !!x.isOverview, sid: (x.sourceId ?? '').slice(0, 6) }
  })
  // group by source, list titles
  const bySource: Record<string, string[]> = {}
  for (const r of rows) {
    const k = r.sid || '(none)'
    ;(bySource[k] ??= []).push((r.ov ? '★' : '') + r.title)
  }
  writeFileSync('/private/tmp/claude-501/-Users-kevin-Documents-Github-linebot/39a5990d-aa85-400a-8b27-b9b78c0e674a/scratchpad/titles.json', JSON.stringify({ total: rows.length, overviewCount: rows.filter(r => r.ov).length, bySource }, null, 2))
  expect(rows.length).toBeGreaterThan(0)
}, 120000)
