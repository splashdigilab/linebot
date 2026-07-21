/**
 * 一次性遷移：把仍停在「舊預設」的 disambiguation 兩個值放寬到新預設。
 *   cooldownMinutes 5 → 0（不再強制反問間隔）
 *   maxOptions      3 → 10（對齊 LINE Quick Reply 慣例上限）
 *
 * 背景：DEFAULT_DISAMBIGUATION_COOLDOWN_MINUTES/ MAX_OPTIONS 已在程式改為 0 / 10，
 * 但更早存過設定的 workspace 文件仍持久化舊值（5 / 3），normalize 看到 raw 有值就沿用、不會回退新預設。
 * 此腳本補正這些「舊預設殘留」。**逐欄比對**：只有欄位=舊預設時才改，
 * 不碰任何刻意設過別的值的 workspace（例：cooldown=15 或 maxOptions=5 都保留原樣）。
 *
 * 預設 dry-run（只印不寫）；加 --apply 才實際更新。
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/migrate-disambiguation-relax-defaults.ts          # myfeel dry-run
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/migrate-disambiguation-relax-defaults.ts --apply  # myfeel 實寫
 *   node --env-file=.env_splash --experimental-strip-types scripts/migrate-disambiguation-relax-defaults.ts --apply  # splash 實寫
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!projectId || !clientEmail || !privateKey) {
  console.error('缺少環境變數：FIREBASE_PROJECT_ID、FIREBASE_CLIENT_EMAIL、FIREBASE_PRIVATE_KEY')
  process.exit(1)
}

initializeApp({
  credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }),
})

const OLD_COOLDOWN = 5
const NEW_COOLDOWN = 0
const OLD_MAX_OPTIONS = 3
const NEW_MAX_OPTIONS = 10
const eq = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-6

async function main() {
  const db = getFirestore()
  console.log(`[migrate] project=${projectId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`)

  const snap = await db.collection('aiSettings').get()
  let scanned = 0
  let updated = 0

  for (const doc of snap.docs) {
    scanned++
    const dis = (doc.data()?.disambiguation ?? {}) as Record<string, unknown>
    const patch: Record<string, number> = {}

    if (eq(dis.cooldownMinutes, OLD_COOLDOWN)) patch['disambiguation.cooldownMinutes'] = NEW_COOLDOWN
    if (eq(dis.maxOptions, OLD_MAX_OPTIONS)) patch['disambiguation.maxOptions'] = NEW_MAX_OPTIONS

    if (Object.keys(patch).length === 0) continue

    const desc = Object.entries(patch).map(([k, v]) => `${k.split('.').pop()}=${dis[k.split('.').pop() as string]}→${v}`).join(', ')
    console.log(`  ${doc.id}: ${desc}`)
    if (apply) {
      await doc.ref.update(patch)
      updated++
    }
  }

  console.log(`[migrate] scanned=${scanned} updated=${apply ? updated : '(dry-run)'}`)
  if (!apply) console.log('[migrate] 這是 dry-run；確認無誤後加 --apply 實際寫入。')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
