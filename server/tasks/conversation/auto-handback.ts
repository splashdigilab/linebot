/**
 * Nitro scheduled task：真人閒置自動交還機器人。
 *
 * 問題背景：session 進入 human_handling 後，所有機器人 / AI 自動回覆都會停用，
 * 唯一出口是手動「結束會話 / 交還機器人」或等 24h session 過期。真人回完忘記收尾時，
 * 客人後續的訊息會完全沒人理（黑洞）。
 *
 * 行為：
 *   1. 掃所有 status='human_handling' 的 session（equality 查詢，不需 composite index）
 *   2. 依該 workspace 的 aiSettings.handbackIdleMinutes（0 = 關閉，直接跳過）
 *   3. 真人最後回覆（humanLastRepliedAt，舊資料 fallback humanFirstRepliedAt）超過
 *      idle 門檻 → handBackSessionToBot，bot/AI 恢復接手
 *
 * 注意：
 *   - 判斷基準是「真人最後回覆」而非 lastActivityAt——客人持續傳訊會一直 bump
 *     lastActivityAt，若用它判斷，真人離開後黑洞永遠不會解除。
 *   - pending_human（真人還沒接手）不自動交還：已經跟客人說「為您安排專員」，
 *     默默丟回機器人會破壞預期；那條路靠通知 + 手動按鈕處理。
 */
import { getDb } from '~~/server/utils/firebase'
import { handBackSessionToBot } from '~~/server/utils/conversation-session'
import { getAiSettings } from '~~/server/utils/ai-settings'

const SCAN_LIMIT = 200

function tsToMs(raw: unknown): number {
  if (!raw) return 0
  const v = raw as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const sec = v.seconds ?? v._seconds
  return typeof sec === 'number' ? sec * 1000 : 0
}

export default defineTask({
  meta: {
    name: 'conversation:auto-handback',
    description: '真人處理中且閒置過久的會話自動交還機器人',
  },
  async run() {
    const db = getDb()
    const snap = await db.collection('conversationSessions')
      .where('status', '==', 'human_handling')
      .limit(SCAN_LIMIT)
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
    return { result: tally }
  },
})
