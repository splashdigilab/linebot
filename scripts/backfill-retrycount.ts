/**
 * 一次性回填:status='failed' 但缺 retryCount 欄位的舊知識卡補上 retryCount: 0。
 *
 * 背景:retryStuckChunks 的查詢改用 where('retryCount','<',MAX_AUTO_RETRIES) 防餓死,
 * 但 Firestore 不等式會排除「沒有該欄位」的文件。git 歷史上 status:'failed' 的寫入
 * (7f5d842) 早於 retryCount increment 上線 (8423709),該時間窗的失敗卡沒有欄位,
 * 不補的話永遠不會再被自動重試。
 *
 * 預設 dry-run;加 --apply 實寫。
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/backfill-retrycount.ts
 *   node --env-file=.env_myfeel --experimental-strip-types scripts/backfill-retrycount.ts --apply
 *   node --env-file=.env_splash --experimental-strip-types scripts/backfill-retrycount.ts --apply
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!projectId || !clientEmail || !privateKey) {
  console.error('缺少環境變數:FIREBASE_PROJECT_ID、FIREBASE_CLIENT_EMAIL、FIREBASE_PRIVATE_KEY')
  process.exit(1)
}

initializeApp({
  credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }),
})

async function main() {
  const db = getFirestore()
  console.log(`[backfill-retrycount] project=${projectId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`)

  const snap = await db.collection('knowledgeChunks')
    .where('status', '==', 'failed')
    .select('workspaceId', 'title', 'retryCount')
    .get()

  let scanned = 0
  let missing = 0
  let updated = 0
  for (const doc of snap.docs) {
    scanned++
    const data = doc.data() as Record<string, unknown>
    if (typeof data.retryCount === 'number') continue
    missing++
    console.log(`  缺 retryCount: chunk=${doc.id} ws=${data.workspaceId} title=「${String(data.title ?? '').slice(0, 40)}」`)
    if (apply) {
      await doc.ref.update({ retryCount: 0 })
      updated++
    }
  }

  console.log(`[backfill-retrycount] failed 卡=${scanned} 缺欄位=${missing} 已補=${updated}${apply ? '' : '(dry-run,加 --apply 實寫)'}`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
