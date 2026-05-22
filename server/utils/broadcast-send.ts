import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import { wrapBroadcastMessagesForClickTracking } from './broadcast-click-track'
import { multicastMessage } from './line'
import { renderModuleToLineMessages } from './handler'
import { broadcastAggregationUnit } from '~~/shared/broadcast-insight'
import { parseTriggerModuleData } from '~~/shared/action-schema'
import { lineUserIdFromFirestoreDocId } from '~~/shared/line-workspace'
import { resolveAudienceUserIds } from './audience'
import { claimBroadcastForSend, type BroadcastSendSource } from './broadcast-claim'
import type { BroadcastDoc, BroadcastDeliveryDoc, AudienceFilter } from '~~/shared/types/tag-broadcast'

function extractTriggerModuleId(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length !== 1) return ''
  const first = messages[0] as Record<string, any>
  if (!first || first.type !== 'template') return ''
  const template = first.template as Record<string, any>
  if (!template || template.type !== 'buttons') return ''
  const actions = Array.isArray(template.actions) ? template.actions : []
  if (actions.length !== 1) return ''
  const action = actions[0] as Record<string, any>
  if (!action || action.type !== 'postback' || typeof action.data !== 'string') return ''
  return parseTriggerModuleData(action.data).moduleId
}

export type ExecuteBroadcastSendOptions = {
  /** manual：後台立即發送（僅 draft）；scheduler：Cron 到期排程 */
  source?: BroadcastSendSource
}

/**
 * 核心推播發送邏輯（共用於 /api/broadcast/:id/send 及排程觸發）
 */
export async function executeBroadcastSend(
  id: string,
  options: ExecuteBroadcastSendOptions = {},
): Promise<{
  success: boolean
  campaignId: string
  totalCount: number
  sentCount: number
  failedCount: number
}> {
  const source = options.source ?? 'manual'
  const runtimeConfig = useRuntimeConfig()
  const db = getDb()
  const ref = db.collection('broadcasts').doc(id)

  const data = await claimBroadcastForSend(id, source)
  const workspaceId = String(data.workspaceId || '').trim()
  if (!workspaceId) throw new Error('Broadcast missing workspaceId')

  if (!data.messages?.length) {
    throw new Error('No messages to send')
  }

  // ── 解析受眾 ──────────────────────────────────────────────────────
  let resolvedUserIds: string[] = []

  try {
    if (data.audienceSource.type === 'all') {
      let query = db.collection('users').select('isBlocked') as FirebaseFirestore.Query
      if (workspaceId) query = query.where('workspaceId', '==', workspaceId)
      const usersSnap = await query.get()
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
      resolvedUserIds = await resolveAudienceUserIds(filter, workspaceId)
    }
    else if (data.audienceSource.type === 'audience' && data.audienceSource.audienceId) {
      const audienceSnap = await db.collection('audiences').doc(data.audienceSource.audienceId).get()
      if (!audienceSnap.exists) throw new Error('Audience not found')
      if (String(audienceSnap.data()?.workspaceId || '') !== workspaceId) {
        throw new Error('Audience not found')
      }
      resolvedUserIds = await resolveAudienceUserIds(audienceSnap.data()!.filter as AudienceFilter, workspaceId)
    }
    else if (data.audienceSource.type === 'import') {
      resolvedUserIds = data.audienceSource.importedUserIds ?? []
    }

    if (!resolvedUserIds.length) {
      throw new Error('Resolved audience is empty')
    }

    // ── 寫入受眾快照（status 已在 claim 時改為 processing）────────────
    const snapshotAt = FieldValue.serverTimestamp()
    await ref.update({
      totalCount: resolvedUserIds.length,
      'audienceSnapshot.resolvedUserIds': resolvedUserIds,
      'audienceSnapshot.estimatedCount': resolvedUserIds.length,
      updatedAt: snapshotAt,
    })

    // ── 呼叫 LINE multicast API ──────────────────────────────────────
    const clickOrigin = String(runtimeConfig.clickTrackingBaseUrl || '').trim().replace(/\/$/, '')
    const triggerModuleId = extractTriggerModuleId(data.messages)
    let outboundMessages = data.messages
    if (triggerModuleId) {
      const rendered = await renderModuleToLineMessages(triggerModuleId, {
        workspaceId,
        requestOrigin: clickOrigin,
      })
      if (!rendered || rendered.lineMessages.length === 0) {
        throw new Error(`Broadcast module not found or empty: ${triggerModuleId}`)
      }
      outboundMessages = rendered.lineMessages as any[]
    }

    const messagesForLine = clickOrigin.startsWith('http')
      ? wrapBroadcastMessagesForClickTracking(outboundMessages, id, clickOrigin)
      : outboundMessages

    if (!clickOrigin.startsWith('http')) {
      console.warn('[broadcast/send] PUBLIC_BASE_URL（或舊名 LINE_IMAGEMAP_BASE_URL／CLICK_TRACKING_BASE_URL）未設定，推播 URI 點擊不會寫入 broadcastClickLogs')
    }

    const recipients = resolvedUserIds
      .map((docId) => ({
        docId,
        lineUserId: String(lineUserIdFromFirestoreDocId(docId, workspaceId) || '').trim(),
      }))
      .filter((r) => Boolean(r.lineUserId))
    const lineUserIds = recipients.map((r) => r.lineUserId)

    if (!lineUserIds.length) {
      throw new Error('No valid LINE user IDs in audience')
    }

    const lineUnit = broadcastAggregationUnit(id)
    const { successCount, failedIds, lineAggregationApplied } = await multicastMessage(
      lineUserIds,
      messagesForLine as any,
      workspaceId,
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

    for (const r of recipients) {
      const isFailed = failedSet.has(r.lineUserId)
      const deliveryDoc: BroadcastDeliveryDoc = {
        campaignId: id,
        userId: r.docId,
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
  catch (e) {
    const failedAt = FieldValue.serverTimestamp()
    await ref.update({
      status: 'failed',
      updatedAt: failedAt,
    }).catch(() => {})
    throw e
  }
}
