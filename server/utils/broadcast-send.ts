import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { wrapBroadcastMessagesForClickTracking } from './broadcast-click-track'
import { multicastMessage } from './line'
import { broadcastAggregationUnit } from '~~/shared/broadcast-insight'
import { resolveAudienceUserIds } from './audience'
import type { BroadcastDoc, BroadcastDeliveryDoc, AudienceFilter } from '~~/shared/types/tag-broadcast'

/**
 * 核心推播發送邏輯（共用於 /api/broadcast/:id/send 及排程觸發）
 */
export async function executeBroadcastSend(id: string): Promise<{
  success: boolean
  campaignId: string
  totalCount: number
  sentCount: number
  failedCount: number
}> {
  const runtimeConfig = useRuntimeConfig()
  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)
  const snap = await ref.get()

  if (!snap.exists) throw new Error(`Broadcast not found: ${id}`)

  const data = snap.data() as BroadcastDoc

  const blockStatuses = ['processing', 'completed', 'failed']
  if (blockStatuses.includes(data.status)) {
    throw new Error(`Cannot send broadcast with status: ${data.status}`)
  }

  if (!data.messages?.length) {
    throw new Error('No messages to send')
  }

  // ── 解析受眾 ──────────────────────────────────────────────────────
  let resolvedUserIds: string[] = []

  if (data.audienceSource.type === 'all') {
    const usersSnap = await db.collection('users').select('isBlocked').get()
    resolvedUserIds = usersSnap.docs
      .filter((d) => d.data().isBlocked !== true)
      .map((d) => d.id)
  }
  else if (data.audienceSource.type === 'tags' && data.audienceSource.tagIds?.length) {
    const filter: AudienceFilter = {
      conditions: [{ type: 'includeAny', tagIds: data.audienceSource.tagIds }],
      joinedAfter: null,
      joinedBefore: null,
      isBlocked: false,
    }
    resolvedUserIds = await resolveAudienceUserIds(filter)
  }
  else if (data.audienceSource.type === 'audience' && data.audienceSource.audienceId) {
    const audienceSnap = await db.collection('audiences').doc(data.audienceSource.audienceId).get()
    if (!audienceSnap.exists) throw new Error('Audience not found')
    resolvedUserIds = await resolveAudienceUserIds(audienceSnap.data()!.filter as AudienceFilter)
  }
  else if (data.audienceSource.type === 'import') {
    resolvedUserIds = data.audienceSource.importedUserIds ?? []
  }

  if (!resolvedUserIds.length) {
    throw new Error('Resolved audience is empty')
  }

  // ── 標記為 processing，寫入快照 ───────────────────────────────────
  const startedAt = FieldValue.serverTimestamp()
  await ref.update({
    status: 'processing',
    startedAt,
    totalCount: resolvedUserIds.length,
    'audienceSnapshot.resolvedUserIds': resolvedUserIds,
    'audienceSnapshot.estimatedCount': resolvedUserIds.length,
    updatedAt: startedAt,
  })

  // ── 呼叫 LINE multicast API ──────────────────────────────────────
  const clickOrigin = String(runtimeConfig.clickTrackingBaseUrl || '').trim().replace(/\/$/, '')
  const messagesForLine = clickOrigin.startsWith('http')
    ? wrapBroadcastMessagesForClickTracking(data.messages, id, clickOrigin)
    : data.messages

  if (!clickOrigin.startsWith('http')) {
    console.warn('[broadcast/send] PUBLIC_BASE_URL（或舊名 LINE_IMAGEMAP_BASE_URL／CLICK_TRACKING_BASE_URL）未設定，推播 URI 點擊不會寫入 broadcastClickLogs')
  }

  const lineUnit = broadcastAggregationUnit(id)
  const { successCount, failedIds, lineAggregationApplied } = await multicastMessage(
    resolvedUserIds,
    messagesForLine as any,
    { customAggregationUnits: [lineUnit] },
  )

  if (!lineAggregationApplied) {
    console.warn('[broadcast/send] LINE 未套用 customAggregationUnits，開封數將無法從 LINE Insight 取得')
  }

  // ── 寫入 deliveries 子集合 ────────────────────────────────────────
  const BATCH_LIMIT = 400
  let batch = db.batch()
  let opsInBatch = 0

  const flushBatch = async () => {
    if (opsInBatch > 0) {
      await batch.commit()
      batch = db.batch()
      opsInBatch = 0
    }
  }

  const failedSet = new Set(failedIds)
  const sentAt = FieldValue.serverTimestamp()

  for (const userId of resolvedUserIds) {
    const isFailed = failedSet.has(userId)
    const deliveryDoc: BroadcastDeliveryDoc = {
      campaignId: id,
      userId,
      deliveryStatus: isFailed ? 'failed' : 'sent',
      failureReason: isFailed ? 'LINE multicast failed' : null,
      sentAt: isFailed ? null : sentAt,
      createdAt: sentAt,
    }

    const deliveryRef = db.collection('broadcasts').doc(id).collection('deliveries').doc(uuidv4())
    batch.set(deliveryRef, deliveryDoc)
    opsInBatch++

    if (opsInBatch >= BATCH_LIMIT) await flushBatch()
  }

  await flushBatch()

  // ── 更新 campaign 最終統計 ────────────────────────────────────────
  const completedAt = FieldValue.serverTimestamp()
  await ref.update({
    status: failedIds.length === resolvedUserIds.length ? 'failed' : 'completed',
    sentCount: successCount,
    failedCount: failedIds.length,
    completedAt,
    updatedAt: completedAt,
    lineAggregationUnit: lineAggregationApplied ? lineUnit : null,
    lineInsightAggregationApplied: lineAggregationApplied,
  })

  return {
    success: true,
    campaignId: id,
    totalCount: resolvedUserIds.length,
    sentCount: successCount,
    failedCount: failedIds.length,
  }
}
