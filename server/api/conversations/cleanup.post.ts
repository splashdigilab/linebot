import { Timestamp } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

/**
 * POST /api/conversations/cleanup
 *
 * 由 Cron Job / Cloud Scheduler 定期呼叫（建議每日 1 次，資料量大可每小時）。
 * 清除超過保留天數的對話訊息，並同步修正 conversations summary。
 *
 * 保護機制：Header 必須帶 X-Cron-Secret，值需等於 CRON_SECRET。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const cronSecret = String(config.cronSecret || '').trim()
  const headerSecret = String(getHeader(event, 'x-cron-secret') || '').trim()
  if (!cronSecret || headerSecret !== cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const retentionDays = parsePositiveInt(config.conversationRetentionDays, 180)
  const batchSize = Math.min(parsePositiveInt(config.conversationCleanupBatchSize, 400), 500)

  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const cutoffTimestamp = Timestamp.fromDate(cutoffDate)

  const db = getDb()
  const oldMessagesSnap = await db
    .collectionGroup('messages')
    .where('timestamp', '<=', cutoffTimestamp)
    .orderBy('timestamp', 'asc')
    .limit(batchSize)
    .get()

  if (oldMessagesSnap.empty) {
    return {
      ok: true,
      retentionDays,
      batchSize,
      cutoffAt: cutoffDate.toISOString(),
      deletedMessages: 0,
      touchedConversations: 0,
      refreshedConversations: 0,
      deletedConversations: 0,
      hasMore: false,
    }
  }

  const touchedUserIds = new Set<string>()
  const batch = db.batch()
  for (const doc of oldMessagesSnap.docs) {
    batch.delete(doc.ref)
    const userId = doc.ref.parent.parent?.id
    if (userId) touchedUserIds.add(userId)
  }
  await batch.commit()

  let refreshedConversations = 0
  let deletedConversations = 0

  for (const userId of touchedUserIds) {
    const conversationRef = db.collection('conversations').doc(userId)
    const latestSnap = await conversationRef
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get()

    if (latestSnap.empty) {
      await conversationRef.delete()
      deletedConversations += 1
      continue
    }

    const latest = latestSnap.docs[0].data()
    await conversationRef.set(
      {
        lastMessage: latest.text ?? '',
        lastDirection: latest.direction ?? 'incoming',
        lastMessageAt: latest.timestamp ?? null,
      },
      { merge: true },
    )
    refreshedConversations += 1
  }

  return {
    ok: true,
    retentionDays,
    batchSize,
    cutoffAt: cutoffDate.toISOString(),
    deletedMessages: oldMessagesSnap.size,
    touchedConversations: touchedUserIds.size,
    refreshedConversations,
    deletedConversations,
    hasMore: oldMessagesSnap.size >= batchSize,
  }
})
