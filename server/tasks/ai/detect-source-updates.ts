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
  outcome: 'unchanged' | 'changed_notified' | 'changed_logged' | 'error'
  message?: string
}

async function checkOneSource(
  db: Firestore,
  sourceId: string,
  data: KnowledgeSourceDoc,
): Promise<CheckResult> {
  try {
    if (data.type !== 'url' || !data.url) {
      return { sourceId, outcome: 'unchanged' } // 不該被撈到，保險
    }

    const extracted = await extractUrlText(data.url)
    const newHash = await sha256(extracted.text)

    // 比對 contentHash
    if (data.contentHash && data.contentHash === newHash) {
      // 沒變 → 只更新 lastFetchedAt
      await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
        lastFetchedAt: FieldValue.serverTimestamp(),
      })
      return { sourceId, outcome: 'unchanged' }
    }

    // 變了：記錄新 hash + 依設定決定行為
    const behavior = data.onChangeBehavior === 'log_only' ? 'log_only' : 'notify'
    await db.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(sourceId).update({
      contentHash: newHash,
      lastFetchedAt: FieldValue.serverTimestamp(),
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
    // 失敗不要中斷整批；只 log
    const msg = String(err?.statusMessage || err?.message || 'unknown error').slice(0, 200)
    console.warn(`[detect-source-updates] ${sourceId} check failed: ${msg}`)
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
    // 撈候選來源：type='url' AND refreshIntervalMinutes > 0
    // 進一步用 lastFetchedAt 過濾「到時間了」會比較準，但 Firestore 不易做時間區間查詢，
    // 一律撈出來後用 JS 過濾 — 工作區 source 通常不會多到爆。
    const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
      .where('type', '==', 'url')
      .where('refreshIntervalMinutes', '>', 0)
      .limit(SCAN_LIMIT * 5) // 撈寬一點，過濾後再砍到 SCAN_LIMIT
      .get()

    const now = Date.now()
    const dueDocs: Array<{ id: string; data: KnowledgeSourceDoc }> = []
    for (const d of snap.docs) {
      const data = d.data() as KnowledgeSourceDoc
      const lastMs = tsToMs(data.lastFetchedAt)
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
      errors: results.filter(r => r.outcome === 'error').length,
    }
    if (tally.changedNotified || tally.errors) {
      console.log('[ai:detect-source-updates]', tally)
    }
    return { result: tally }
  },
})
