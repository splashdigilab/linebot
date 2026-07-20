/**
 * 一次性工具：清掉指定 workspace 的 AI 用量「月結桶」（aiUsage/{workspaceId}_{yyyyMM}）。
 *
 * 用途：AI 還沒對客人正式啟用前，月結桶累積的都是「建置 + 測試」數字（非真客人）。
 * 正式上線前清掉，讓「用量 / 監控」頁從乾淨的 0 開始。summary API 讀不到 doc 時回全 0，
 * 所以「刪除」= 乾淨歸零，下次有真實用量會自動重建。
 *
 * 安全範圍：只刪 aiUsage 的指定 doc。**不碰** quotaUsage / conversations / aiSettings / 任何其他 collection。
 * 預設 dry-run（只印現況、不刪）；加 --apply 才真的刪。
 *
 *   # 先 dry-run 看會刪什麼（myfeel 租戶）
 *   node --env-file=.env --experimental-strip-types scripts/reset-ai-usage.ts <workspaceId> 202607
 *   # 確認無誤後實刪
 *   node --env-file=.env --experimental-strip-types scripts/reset-ai-usage.ts <workspaceId> 202607 --apply
 *   # splash 租戶改用 .env_splash；多個月份用逗號：202605,202606,202607
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')
const listOnly = process.argv.includes('--list')
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const workspaceId = positional[0]
const months = (positional[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)

// --list：唯讀列出「所有」aiUsage doc（不刪），用來確認有哪些 workspace / 月份、有沒有真客人資料。
if (!listOnly && (!workspaceId || !months.length)) {
  console.error('用法：\n  列出全部（唯讀）：reset-ai-usage.ts --list\n  清指定：reset-ai-usage.ts <workspaceId> <yyyyMM[,yyyyMM...]> [--apply]')
  process.exit(1)
}
if (!months.every(m => /^\d{6}$/.test(m))) {
  console.error('月份格式須為 yyyyMM（例：202607），多個以逗號分隔')
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

async function main() {
  const db = getFirestore()

  // ── 唯讀列出全部 aiUsage doc（不刪）──
  if (listOnly) {
    console.log(`[reset-ai-usage] project=${projectId} mode=LIST（唯讀，不刪）`)
    const all = await db.collection('aiUsage').get()
    if (all.empty) { console.log('  （沒有任何 aiUsage doc）'); return }
    for (const doc of all.docs) {
      const d = doc.data() ?? {}
      console.log(`  · ${doc.id}：invocations=${d.invocations ?? 0} answered=${d.answered ?? 0} handoffs=${d.handoffs ?? 0} input=${d.inputTokens ?? 0} output=${d.outputTokens ?? 0} embed=${d.embeddingTokens ?? 0} buildEmbed=${d.buildEmbeddingTokens ?? 0}`)
    }
    console.log(`  共 ${all.size} 個 doc。doc id 格式＝<workspaceId>_<yyyyMM>。`)
    return
  }

  console.log(`[reset-ai-usage] project=${projectId} workspace=${workspaceId} months=${months.join(',')} mode=${apply ? 'APPLY（實刪）' : 'DRY-RUN（只印）'}`)

  for (const m of months) {
    const id = `${workspaceId}_${m}`
    const ref = db.collection('aiUsage').doc(id)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`  · aiUsage/${id}：不存在，略過`)
      continue
    }
    const d = snap.data() ?? {}
    console.log(`  · aiUsage/${id}：invocations=${d.invocations ?? 0} answered=${d.answered ?? 0} handoffs=${d.handoffs ?? 0} input=${d.inputTokens ?? 0} output=${d.outputTokens ?? 0} embed=${d.embeddingTokens ?? 0} buildEmbed=${d.buildEmbeddingTokens ?? 0} test=${(d.testInputTokens ?? 0) + (d.testOutputTokens ?? 0) + (d.testEmbeddingTokens ?? 0)}`)
    if (apply) {
      await ref.delete()
      console.log(`    → 已刪除`)
    }
  }

  if (!apply) console.log('（dry-run，未刪任何資料。確認上面就是要清的月份後，加 --apply 重跑即可實刪。）')
  console.log('[reset-ai-usage] done')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
