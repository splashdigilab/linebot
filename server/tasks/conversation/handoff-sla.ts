/**
 * Nitro scheduled task：handoff SLA 提醒。
 *
 * 轉真人（pending_human）後超過 aiSettings.handoffNotify.slaRemindMinutes 仍無人回應
 * → 再推播提醒值班客服一次。每場會話只提醒一次（session.slaRemindedAt 標記），
 * 避免每個排程週期重複轟炸。
 *
 * 前置條件：handoffNotify.enabled 且 slaRemindMinutes > 0；關閉通知的工作區整批跳過。
 */
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { getAiSettings } from '~~/server/utils/ai-settings'
import { notifyHandoffToStaff } from '~~/server/utils/ai-handoff-notify'
import { lineUserFirestoreDocId } from '~~/shared/line-workspace'

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
    name: 'conversation:handoff-sla',
    description: '轉真人超時未回應的會話，再提醒值班客服一次',
  },
  async run() {
    const db = getDb()
    const snap = await db.collection('conversationSessions')
      .where('status', '==', 'pending_human')
      .limit(SCAN_LIMIT)
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
    return { result: tally }
  },
})
