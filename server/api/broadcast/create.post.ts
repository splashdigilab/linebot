import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { BroadcastDoc, BroadcastAudienceSource } from '~~/shared/types/tag-broadcast'

/**
 * POST /api/broadcast/create
 * 建立推播草稿
 *
 * Body:
 * {
 *   name: string
 *   audienceSource: BroadcastAudienceSource
 *   messages: any[]           // LINE messagingApi.Message[]
 *   scheduleAt?: string       // ISO 8601，省略則為草稿等待手動發送
 * }
 *
 * Response: BroadcastDoc & { id: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, audienceSource, messages, scheduleAt } = body

  if (!name || !audienceSource || !messages?.length) {
    throw createError({ statusCode: 400, statusMessage: 'name, audienceSource, messages are required' })
  }

  const validSourceTypes = ['all', 'tags', 'audience', 'import']
  if (!validSourceTypes.includes(audienceSource.type)) {
    throw createError({ statusCode: 400, statusMessage: `audienceSource.type must be one of: ${validSourceTypes.join(', ')}` })
  }

  const id = uuidv4()
  const now = FieldValue.serverTimestamp()

  const doc: BroadcastDoc = {
    name,
    status: scheduleAt ? 'scheduled' : 'draft',
    channel: 'line',
    audienceSource,
    audienceSnapshot: {
      filter: null,
      resolvedUserIds: [],
      estimatedCount: 0,
    },
    messages,
    scheduleAt: scheduleAt ? (new Date(scheduleAt) as any) : null,
    startedAt: null,
    completedAt: null,
    totalCount: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
  }

  const db = getDb()
  await db.collection('broadcasts').doc(id).set(doc)
  return { id, ...doc }
})
