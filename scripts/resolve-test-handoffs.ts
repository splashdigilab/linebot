/**
 * 一次性工具：把指定 workspace 「還沒處理的轉真人對話」全部標記為已處理。
 *
 * 用途：正式上線前，用量頁的「近期轉真人案例」清單來源是 conversations（不是月結桶），
 * reset-ai-usage 不會清到。AI 尚未對客人啟用時，這些 handoff 都是你自己測試留下的。
 * 本工具**非破壞性**：只寫 aiMeta.handoffResolvedAt（比照 /handoffs/resolve 端點），
 * 對話內容完全保留；日後同客人若再發生新 handoff（updatedAt 更新），仍會自動回到未處理。
 *
 * 預設 dry-run（只印）；加 --apply 才實際標記。
 *   node --env-file=.env --experimental-strip-types scripts/resolve-test-handoffs.ts <workspaceId>
 *   node --env-file=.env --experimental-strip-types scripts/resolve-test-handoffs.ts <workspaceId> --apply
 *   # splash 租戶改用 .env_splash
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')
const workspaceId = process.argv.slice(2).find(a => !a.startsWith('--'))

if (!workspaceId) {
  console.error('用法：resolve-test-handoffs.ts <workspaceId> [--apply]')
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY
if (!projectId || !clientEmail || !privateKey) {
  console.error('缺少環境變數：FIREBASE_PROJECT_ID、FIREBASE_CLIENT_EMAIL、FIREBASE_PRIVATE_KEY')
  process.exit(1)
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }) })

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

async function main() {
  const db = getFirestore()
  console.log(`[resolve-test-handoffs] project=${projectId} workspace=${workspaceId} mode=${apply ? 'APPLY（實際標記）' : 'DRY-RUN（只印）'}`)

  // workspaceId 為 equality（自動索引），lastDecision / resolved 在記憶體過濾，免複合索引。
  const snap = await db.collection('conversations').where('workspaceId', '==', workspaceId).get()
  const targets = snap.docs.filter((d) => {
    const meta = (d.data() as { aiMeta?: { lastDecision?: string; updatedAt?: unknown; handoffResolvedAt?: unknown } }).aiMeta
    if (meta?.lastDecision !== 'handoff') return false
    const resolvedMs = tsToMs(meta.handoffResolvedAt)
    const updatedMs = tsToMs(meta.updatedAt)
    return !(resolvedMs > 0 && resolvedMs >= updatedMs) // 未處理
  })

  console.log(`  找到 ${targets.length} 筆「還沒處理的轉真人對話」`)
  for (const d of targets) {
    const data = d.data() as { displayName?: string; aiMeta?: { lastQuery?: string } }
    console.log(`  · ${d.id}  ${data.displayName || '匿名'}：${(data.aiMeta?.lastQuery || '').slice(0, 40)}`)
    if (apply) {
      await d.ref.set({ aiMeta: { handoffResolvedAt: FieldValue.serverTimestamp() } }, { merge: true })
    }
  }

  if (apply) console.log('  → 已全部標記為已處理（對話內容保留）')
  else console.log('（dry-run，未改任何資料。確認上面就是要清的對話後，加 --apply 重跑。）')
  console.log('[resolve-test-handoffs] done')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
