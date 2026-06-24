/**
 * 一次性遷移：把 aiSettings 文件裡「舊預設殘留」的 disambiguation.top1Min 從 0.65 更新為 0.70。
 *
 * 背景：後端 DEFAULT_DISAMBIGUATION_TOP1_MIN 早已從 0.65 調高到 0.70（0.65 會讓弱匹配的多卡群
 * 亂觸發反問、塞不相關選項），但更早之前存過設定的 workspace 文件仍持久化著舊值 0.65，
 * normalize 看到 raw 有值就沿用，不會回退到新預設。此腳本把這些殘留值補正。
 *
 * 只動「舊預設/平衡 preset 簽名」的文件（top1Min===0.65 且 top1Max===0.78），
 * 不碰刻意選 loose(0.55/0.70) 或 strict(0.70/0.82) 或其他自訂值的 workspace。
 *
 * 預設為 dry-run（只印不寫）；加 --apply 才實際更新。
 *   node --env-file=.env       --experimental-strip-types scripts/migrate-disambiguation-top1min.ts          # myfeel dry-run
 *   node --env-file=.env       --experimental-strip-types scripts/migrate-disambiguation-top1min.ts --apply  # myfeel 實寫
 *   node --env-file=.env_splash --experimental-strip-types scripts/migrate-disambiguation-top1min.ts --apply # splash 實寫
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

const STALE_TOP1MIN = 0.65
const STALE_TOP1MAX = 0.78
const NEW_TOP1MIN = 0.70
const eq = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-6

async function main() {
  const db = getFirestore()
  console.log(`[migrate] project=${projectId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`)

  const snap = await db.collection('aiSettings').get()
  let scanned = 0
  let matched = 0
  let updated = 0

  for (const doc of snap.docs) {
    scanned++
    const dis = (doc.data()?.disambiguation ?? {}) as Record<string, unknown>
    const top1Min = dis.top1Min
    const top1Max = dis.top1Max
    if (eq(top1Min, STALE_TOP1MIN) && eq(top1Max, STALE_TOP1MAX)) {
      matched++
      console.log(`  ${doc.id}: top1Min ${top1Min} → ${NEW_TOP1MIN} (top1Max=${top1Max})`)
      if (apply) {
        await doc.ref.update({ 'disambiguation.top1Min': NEW_TOP1MIN })
        updated++
      }
    }
  }

  console.log(`[migrate] scanned=${scanned} matched=${matched} updated=${updated}`)
  if (!apply && matched > 0) console.log('[migrate] 這是 dry-run；確認無誤後加 --apply 實際寫入。')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
