/**
 * Nitro scheduled task：對 type='url' 的 source 做變動偵測。
 *
 * 偵測流程：
 *   1. 撈所有 refreshIntervalMinutes > 0 且 (now - lastFetchedAt) >= refreshIntervalMinutes 的 URL source
 *   2. HEAD（或 GET if HEAD 不支援）拿 etag / last-modified
 *   3. 若 etag 或 contentHash 沒變 → 只更新 lastFetchedAt
 *   4. 若變了：
 *      - onChangeBehavior='notify' → 標 outdatedAt = now（UI 顯示「⚠️ 偵測到變動」）
 *      - onChangeBehavior='log_only' → 只 console log
 *   5. 不直接覆寫 chunk（永遠手動套用）
 *
 * 不做事情：
 *   - 不切卡（切卡是 resync-apply 才做，這支只負責「告訴你有變」）
 *   - 不 cross-workspace 並行（一個工作區一張一張跑，避免 Gemini 沒進這支也不會吃 token）
 *   - 失敗一張不影響其他張（每張都 try/catch）
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import {
  KNOWLEDGE_SOURCES_COLLECTION,
  markSourceOutdated,
} from '~~/server/utils/ai-knowledge-sources'
import { extractUrlText } from '~~/server/utils/ai-source-extractors'
import { syncGoogleSheetSource } from '~~/server/utils/gsheet-sync'
import type { KnowledgeSourceDoc } from '~~/shared/types/ai-knowledge'

const SCAN_LIMIT = 50 // 單次跑最多幾張 source（避免一次塞太多 fetch）
const FETCH_CONCURRENCY = 3

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

/** 簡單 SHA-256 hash（不引入額外套件）— 用 Node 內建 crypto */
async function sha256(input: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(input).digest('hex')
}

interface CheckResult {
  sourceId: string
  outcome: 'unchanged' | 'changed_notified' | 'changed_logged' | 'gsheet_synced' | 'error'
  message?: string
}

async function checkOneSource(
  db: Firestore,
  sourceId: string,
  data: KnowledgeSourceDoc,
): Promise<CheckResult> {
  try {
    // Google Sheet：自動同步（一列一卡，直接套用新增/更新/刪除，不走人工 resync）。
    // autoApply === false 的來源視為「商家自管」，這支不動它。
    if (data.type === 'gsheet') {
      if (data.gsheetAutoApply === false) return { sourceId, outcome: 'unchanged' }
      const r = await syncGoogleSheetSource(db, data.workspaceId, sourceId, data)
      if (r.outcome === 'unchanged') return { sourceId, outcome: 'unchanged' }
      return { sourceId, outcome: 'gsheet_synced', message: `+${r.added} ~${r.updated} -${r.deleted}` }
    }

    if (data.type !== 'url' || !data.url) {
      return { sourceId, outcome: 'unchanged' } // 不該被撈到，保險
    }

    const extracted = await extractUrlText(data.url)
    const newHash = await sha256(extracted.text)

    // 檢查成功：清掉先前的失敗標記。FieldValue.delete() 對不存在的欄位是 no-op,
    // 不需要條件判斷(舊寫法 keys off 讀取時的快照,並發寫入的標記會漏清)。
    // status 曾被本任務標成 'failed'(連續失敗 ≥3)的也要復原——否則來源永遠顯示
    // 「失敗」且失敗原因已被清掉,使用者無從解釋、只能重新匯入。
    const clearFailure = {
      failureReason: FieldValue.delete(),
      checkFailCount: FieldValue.delete(),
      ...(data.status === 'failed' ? { status: 'ready' as const } : {}),
    }

    // 首次觀測（匯入時前端沒帶 hash → contentHash 為空）：只存 baseline,不標 outdated。
    // 內容並沒有「變」,只是還沒有比較基準;沒有這個分支的話,每個新 URL 來源
    // 第一次排程必被誤報「偵測到變動」,狼來了幾次使用者就不理警示了。
    if (!data.contentHash) {
      await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
        contentHash: newHash,
        lastFetchedAt: FieldValue.serverTimestamp(),
        ...clearFailure,
      })
      return { sourceId, outcome: 'unchanged' }
    }

    // 比對 contentHash
    if (data.contentHash === newHash) {
      // 沒變 → 只更新 lastFetchedAt
      await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
        lastFetchedAt: FieldValue.serverTimestamp(),
        ...clearFailure,
      })
      return { sourceId, outcome: 'unchanged' }
    }

    // 變了：記錄新 hash + 依設定決定行為
    const behavior = data.onChangeBehavior === 'log_only' ? 'log_only' : 'notify'
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
      contentHash: newHash,
      lastFetchedAt: FieldValue.serverTimestamp(),
      ...clearFailure,
    })

    // 全文暫存到 subcollection：偵測時已抓過全文，丟掉的話使用者按「套用」還要重抓一次，
    // 而且「偵測時的版本」和「套用時的版本」可能不一致。放 subcollection 避免 source
    // 列表查詢拖著幾百 KB 的內文。
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId)
      .collection('cache').doc('extracted')
      .set({
        text: extracted.text,
        hash: newHash,
        rawLength: extracted.rawLength,
        fetchedAt: FieldValue.serverTimestamp(),
      })
      .catch(e => console.warn(`[detect-source-updates] ${sourceId} cache write failed:`, e))

    if (behavior === 'notify') {
      await markSourceOutdated(db, sourceId)
      return { sourceId, outcome: 'changed_notified' }
    }
    console.log(`[detect-source-updates] ${sourceId} (${data.url}) content changed; log_only mode, no notify`)
    return { sourceId, outcome: 'changed_logged' }
  }
  catch (err: any) {
    // 失敗不要中斷整批；但**不能只 log**——官網改版把頁面移走後,這裡每天失敗而
    // UI 永遠顯示「正常」,知識庫悄悄過期沒人知道。把失敗寫回 source：
    //   - failureReason：來源頁本來就會顯示「失敗原因：…」
    //   - lastCheckedAt：退避基準（lastFetchedAt 保留「最後成功同步」語意不動）
    //   - 連續失敗 ≥3 次 → status='failed'，列表狀態直接可見
    const msg = String(err?.statusMessage || err?.message || 'unknown error').slice(0, 200)
    console.warn(`[detect-source-updates] ${sourceId} check failed: ${msg}`)
    const failCount = Number(data.checkFailCount ?? 0) + 1
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
      failureReason: `自動檢查失敗：${msg}`,
      checkFailCount: failCount,
      lastCheckedAt: FieldValue.serverTimestamp(),
      ...(failCount >= 3 ? { status: 'failed' } : {}),
    }).catch(() => {})
    return { sourceId, outcome: 'error', message: msg }
  }
}

export default defineTask({
  meta: {
    name: 'ai:detect-source-updates',
    description: '偵測 URL 來源內容變動，標記 outdated 等使用者確認',
  },
  async run() {
    const db = getDb()
    // 撈候選來源：refreshIntervalMinutes > 0（url 偵測 + gsheet 自動同步共用此排程）。
    // 只用單一不等式查詢（免複合索引），type 在 JS 端篩。
    // 進一步用 lastFetchedAt 過濾「到時間了」會比較準，但 Firestore 不易做時間區間查詢，
    // 一律撈出來後用 JS 過濾 — 工作區 source 通常不會多到爆。
    const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
      .where('refreshIntervalMinutes', '>', 0)
      .limit(SCAN_LIMIT * 5) // 撈寬一點，過濾後再砍到 SCAN_LIMIT
      .get()

    const now = Date.now()
    const dueDocs: Array<{ id: string; data: KnowledgeSourceDoc }> = []
    for (const d of snap.docs) {
      const data = d.data() as KnowledgeSourceDoc
      if (data.type !== 'url' && data.type !== 'gsheet') continue
      // 退避：失敗的檢查不更新 lastFetchedAt，若只看它會每次排程都重打掛掉的網站。
      // 以「最後一次嘗試」（成功或失敗）起算間隔。
      const lastMs = Math.max(tsToMs(data.lastFetchedAt), tsToMs(data.lastCheckedAt))
      const intervalMs = Number(data.refreshIntervalMinutes || 0) * 60_000
      if (!intervalMs) continue
      if (lastMs && (now - lastMs) < intervalMs) continue
      dueDocs.push({ id: d.id, data })
      if (dueDocs.length >= SCAN_LIMIT) break
    }

    if (!dueDocs.length) return { result: { scanned: 0 } }

    // 用 concurrency pool 跑 check
    const results: CheckResult[] = []
    let cursor = 0
    async function worker() {
      while (cursor < dueDocs.length) {
        const i = cursor++
        const doc = dueDocs[i]!
        const r = await checkOneSource(db, doc.id, doc.data)
        results.push(r)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, dueDocs.length) }, worker),
    )

    const tally = {
      scanned: results.length,
      unchanged: results.filter(r => r.outcome === 'unchanged').length,
      changedNotified: results.filter(r => r.outcome === 'changed_notified').length,
      changedLogged: results.filter(r => r.outcome === 'changed_logged').length,
      gsheetSynced: results.filter(r => r.outcome === 'gsheet_synced').length,
      errors: results.filter(r => r.outcome === 'error').length,
    }
    if (tally.changedNotified || tally.gsheetSynced || tally.errors) {
      console.log('[ai:detect-source-updates]', tally)
    }
    return { result: tally }
  },
})
