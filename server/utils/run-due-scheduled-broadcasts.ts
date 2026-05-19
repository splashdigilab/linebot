import { Timestamp } from 'firebase-admin/firestore'
import { executeBroadcastSend } from './broadcast-send'
import { getDb } from './firebase'

export type DueScheduledBroadcastResult = {
  id: string
  success: boolean
  error?: string
}

export type RunDueScheduledBroadcastsResponse = {
  triggered: number
  results: DueScheduledBroadcastResult[]
  /** 仍為 scheduled 但 scheduleAt 尚未到期（除錯用） */
  pendingFuture?: number
}

/**
 * 查詢 status=scheduled 且 scheduleAt <= 現在 的推播並發送。
 * 由 POST /api/broadcast/trigger-scheduled 與應用內建 Cron 共用。
 */
export async function runDueScheduledBroadcasts(
  opts?: { workspaceId?: string },
): Promise<RunDueScheduledBroadcastsResponse> {
  const db = getDb()
  const now = Timestamp.now()
  const workspaceId = String(opts?.workspaceId || '').trim()

  const snap = await db.collection('broadcasts')
    .where('status', '==', 'scheduled')
    .where('scheduleAt', '<=', now)
    .orderBy('scheduleAt', 'asc')
    .limit(20)
    .get()

  if (snap.empty) {
    let pendingFuture: number | undefined
    try {
      const pendingSnap = await db.collection('broadcasts')
        .where('status', '==', 'scheduled')
        .limit(1)
        .get()
      if (!pendingSnap.empty) {
        const futureSnap = await db.collection('broadcasts')
          .where('status', '==', 'scheduled')
          .where('scheduleAt', '>', now)
          .limit(1)
          .get()
        if (!futureSnap.empty) pendingFuture = 1
      }
    }
    catch {
      /* 略過除錯查詢 */
    }
    return { triggered: 0, results: [], pendingFuture }
  }

  console.log(`[broadcast-scheduler] 找到 ${snap.docs.length} 個到期排程推播`)

  const results: DueScheduledBroadcastResult[] = []
  let triggered = 0

  for (const doc of snap.docs) {
    if (workspaceId && String(doc.data().workspaceId || '') !== workspaceId) continue

    triggered++
    const id = doc.id
    try {
      const result = await executeBroadcastSend(id, { source: 'scheduler' })
      results.push({ id, success: result.success })
      console.log(`[broadcast-scheduler] ✓ ${id} sentCount=${result.sentCount}`)
    }
    catch (e: unknown) {
      const error = String(e instanceof Error ? e.message : e)
      results.push({ id, success: false, error })
      console.error(`[broadcast-scheduler] ✗ ${id}`, error)
    }
  }

  return {
    triggered,
    results,
  }
}
