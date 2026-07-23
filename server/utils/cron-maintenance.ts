/**
 * 定時維護工作的實作本體（原本散在 server/tasks/* 的 defineTask run() 內）。
 *
 * 抽出來的原因：Amplify（aws-amplify preset）**不會把 Nitro tasks 打包進 compute
 * bundle**，scheduledTasks 與 runTask 在生產環境都不存在——所以這些工作上線以來
 * 從未執行過。改成一般函式後：
 *   - 生產：/api/cron/run-tasks（Cloud Scheduler 每 10 分鐘）呼叫
 *   - 本機 dev：server/tasks/* 仍為薄殼包裝，scheduledTasks 照常運作
 *
 * 所有函式都設計成可安全高頻呼叫：沒到期／沒東西就是便宜的空查詢，
 * 單筆失敗不中斷整批。
 */
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import {
  KNOWLEDGE_SOURCES_COLLECTION,
  markSourceOutdated,
} from './ai-knowledge-sources'
import { extractUrlText } from './ai-source-extractors'
import { syncGoogleSheetSource } from './gsheet-sync'
import { handBackSessionToBot } from './conversation-session'
import { getAiSettings } from './ai-settings'
import { notifyHandoffToStaff } from './ai-handoff-notify'
import { WEBHOOK_EVENT_LOCKS_COLLECTION } from './webhook-dedup'
import { lineUserFirestoreDocId } from '~~/shared/line-workspace'
import type { KnowledgeSourceDoc } from '~~/shared/types/ai-knowledge'

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

// ── URL / Google Sheet 來源變動偵測 ─────────────────────────────────────────

const SOURCE_SCAN_LIMIT = 50 // 單次跑最多幾張 source（避免一次塞太多 fetch）
const SOURCE_FETCH_CONCURRENCY = 3

/** 簡單 SHA-256 hash（不引入額外套件）— 用 Node 內建 crypto */
async function sha256(input: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(input).digest('hex')
}

interface SourceCheckResult {
  sourceId: string
  outcome: 'unchanged' | 'changed_notified' | 'changed_logged' | 'gsheet_synced' | 'error'
  message?: string
}

async function checkOneSource(
  db: Firestore,
  sourceId: string,
  data: KnowledgeSourceDoc,
): Promise<SourceCheckResult> {
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

/**
 * 對 type='url' 的 source 做變動偵測、type='gsheet' 做自動同步。
 * 每張 source 的實際頻率由自身 refreshIntervalMinutes 決定（含失敗退避），
 * 呼叫端頻率高於來源頻率時只是空查詢。
 */
export async function detectSourceUpdates(db: Firestore) {
  // 撈候選來源：refreshIntervalMinutes > 0（url 偵測 + gsheet 自動同步共用此排程）。
  // 只用單一不等式查詢（免複合索引），type 在 JS 端篩。
  // 進一步用 lastFetchedAt 過濾「到時間了」會比較準，但 Firestore 不易做時間區間查詢，
  // 一律撈出來後用 JS 過濾 — 工作區 source 通常不會多到爆。
  const snap = await db.collection(KNOWLEDGE_SOURCES_COLLECTION)
    .where('refreshIntervalMinutes', '>', 0)
    .limit(SOURCE_SCAN_LIMIT * 5) // 撈寬一點，過濾後再砍到 SCAN_LIMIT
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
    if (dueDocs.length >= SOURCE_SCAN_LIMIT) break
  }

  if (!dueDocs.length) return { scanned: 0 }

  // 用 concurrency pool 跑 check
  const results: SourceCheckResult[] = []
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
    Array.from({ length: Math.min(SOURCE_FETCH_CONCURRENCY, dueDocs.length) }, worker),
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
  return tally
}

// ── 真人閒置自動交還機器人 ─────────────────────────────────────────────────

const SESSION_SCAN_LIMIT = 200

/**
 * 掃 status='human_handling' 的會話，真人最後回覆超過該 workspace 的
 * handbackIdleMinutes（0 = 關閉）→ 自動交還機器人。
 * 判斷基準是「真人最後回覆」而非 lastActivityAt——客人持續傳訊會一直 bump
 * lastActivityAt，若用它判斷，真人離開後黑洞永遠不會解除。
 * pending_human（真人還沒接手）不自動交還：已經跟客人說「為您安排專員」，
 * 默默丟回機器人會破壞預期；那條路靠通知 + 手動按鈕處理。
 */
export async function autoHandbackIdleSessions(db: Firestore) {
  const snap = await db.collection('conversationSessions')
    .where('status', '==', 'human_handling')
    .limit(SESSION_SCAN_LIMIT)
    .get()

  const now = Date.now()
  let handedBack = 0
  let skippedDisabled = 0
  let skippedFresh = 0

  for (const doc of snap.docs) {
    const data = doc.data() as any
    const workspaceId = String(data?.workspaceId ?? '')
    const userId = String(data?.userId ?? '')
    if (!workspaceId || !userId) continue

    try {
      // getAiSettings 有 60 秒 in-memory cache，同 workspace 多筆 session 不會重複讀
      const settings = await getAiSettings(workspaceId, db)
      const idleMinutes = settings.handbackIdleMinutes
      if (!idleMinutes) {
        skippedDisabled++
        continue
      }

      const lastHumanMs = tsToMs(data.humanLastRepliedAt) || tsToMs(data.humanFirstRepliedAt)
      if (!lastHumanMs) continue // 沒有真人回覆紀錄的不動（理論上 human_handling 必有）

      if (now - lastHumanMs < idleMinutes * 60_000) {
        skippedFresh++
        continue
      }

      const ok = await handBackSessionToBot(doc.id, userId)
      if (ok) handedBack++
    }
    catch (err) {
      // 單筆失敗不影響整批
      console.warn('[auto-handback] session check failed:', doc.id, err)
    }
  }

  const tally = { scanned: snap.size, handedBack, skippedDisabled, skippedFresh }
  if (handedBack) console.log('[conversation:auto-handback]', tally)
  return tally
}

// ── 轉真人逾時 SLA 提醒 ────────────────────────────────────────────────────

/**
 * pending_human 超過 aiSettings.handoffNotify.slaRemindMinutes 仍無人回應
 * → 再推播提醒值班客服一次。每場會話只提醒一次（session.slaRemindedAt 標記）。
 */
export async function remindOverdueHandoffs(db: Firestore) {
  const snap = await db.collection('conversationSessions')
    .where('status', '==', 'pending_human')
    .limit(SESSION_SCAN_LIMIT)
    .get()

  const now = Date.now()
  let reminded = 0
  let skipped = 0

  for (const doc of snap.docs) {
    const data = doc.data() as any
    const workspaceId = String(data?.workspaceId ?? '')
    const lineUserId = String(data?.userId ?? '')
    if (!workspaceId || !lineUserId) continue

    try {
      if (data.slaRemindedAt || data.humanFirstRepliedAt) {
        skipped++
        continue
      }
      const requestedMs = tsToMs(data.handoffRequestedAt)
      if (!requestedMs) continue

      // getAiSettings 有 60 秒 in-memory cache，同 workspace 多筆不重複讀
      const settings = await getAiSettings(workspaceId, db)
      const sla = settings.handoffNotify.slaRemindMinutes
      if (!settings.handoffNotify.enabled || !sla) {
        skipped++
        continue
      }
      if (now - requestedMs < sla * 60_000) {
        skipped++
        continue
      }

      // 撈 displayName 讓提醒訊息可讀（一場會話只發一次，這個讀取量可接受）
      const convSnap = await db.collection('conversations')
        .doc(lineUserFirestoreDocId(lineUserId, workspaceId))
        .get()
        .catch(() => null)
      const displayName = String(convSnap?.data()?.displayName ?? '') || lineUserId

      await notifyHandoffToStaff({
        workspaceId,
        customerLineUserId: lineUserId,
        customerName: displayName,
        customerMessage: '',
        reason: null,
        slaReminderMinutes: sla,
      })
      await doc.ref.update({ slaRemindedAt: FieldValue.serverTimestamp() })
      reminded++
    }
    catch (err) {
      console.warn('[handoff-sla] session check failed:', doc.id, err)
    }
  }

  const tally = { scanned: snap.size, reminded, skipped }
  if (reminded) console.log('[conversation:handoff-sla]', tally)
  return tally
}

// ── webhook 冪等鎖清理 ─────────────────────────────────────────────────────

/**
 * 刪除過期的 webhook 冪等鎖（expiresAt < now）。
 * Firestore TTL policy 也會清（splash 已設定），此函式作為不依賴 console 權限的保底。
 */
export async function cleanupExpiredWebhookEventLocks(db: Firestore) {
  let deleted = 0
  // 每輪最多清 5 批（2500 筆），避免單次跑太久；剩餘的留給下一輪
  for (let i = 0; i < 5; i++) {
    const snap = await db.collection(WEBHOOK_EVENT_LOCKS_COLLECTION)
      .where('expiresAt', '<', Timestamp.now())
      .limit(500)
      .get()
    if (snap.empty) break
    const batch = db.batch()
    snap.docs.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    deleted += snap.size
    if (snap.size < 500) break
  }
  if (deleted > 0) {
    console.log('[webhook:cleanup-event-locks] deleted', deleted, 'expired locks')
  }
  return { deleted }
}
