import { FieldValue, type Timestamp } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { broadcastScheduleAtToDate } from './broadcast-schedule'
import type { BroadcastDoc, BroadcastStatus } from '~~/shared/types/tag-broadcast'

export type BroadcastSendSource = 'manual' | 'scheduler'

const TERMINAL_STATUSES: BroadcastStatus[] = ['processing', 'completed', 'failed', 'cancelled']

/**
 * 以 transaction 將推播標記為 processing，避免 Cron 與手動重複發送。
 */
export async function claimBroadcastForSend(
  id: string,
  source: BroadcastSendSource,
): Promise<BroadcastDoc> {
  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error(`Broadcast not found: ${id}`)

    const data = snap.data() as BroadcastDoc

    if (TERMINAL_STATUSES.includes(data.status)) {
      throw new Error(`Cannot send broadcast with status: ${data.status}`)
    }

    if (source === 'manual') {
      if (data.status === 'scheduled') {
        throw new Error('此推播已排程，請等候自動發送，或先取消排程')
      }
      if (data.status !== 'draft') {
        throw new Error(`Cannot send broadcast with status: ${data.status}`)
      }
      const pendingAt = broadcastScheduleAtToDate(data.scheduleAt as Timestamp | Date | null)
      if (pendingAt && pendingAt.getTime() > Date.now()) {
        throw new Error('此推播已設定未來排程時間，請使用排程流程或先清除排程')
      }
    }
    else {
      if (data.status !== 'scheduled') {
        throw new Error(`Cannot send broadcast with status: ${data.status}`)
      }
      const at = broadcastScheduleAtToDate(data.scheduleAt as Timestamp | Date | null)
      if (!at) throw new Error('Scheduled broadcast missing scheduleAt')
      // 查詢已篩 scheduleAt <= now；保留 90 秒容差避免時鐘／寫入延遲
      if (at.getTime() > Date.now() + 90_000) {
        throw new Error('Broadcast scheduleAt is in the future')
      }
    }

    const startedAt = FieldValue.serverTimestamp()
    tx.update(ref, {
      status: 'processing',
      startedAt,
      updatedAt: startedAt,
    })

    return { ...data, status: 'processing' }
  })
}
