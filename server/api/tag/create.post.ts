import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { TagDoc, TagCategory } from '~~/shared/types/tag-broadcast'

const VALID_CATEGORIES: TagCategory[] = ['member_status', 'interest', 'behavior', 'activity', 'custom']

/**
 * POST /api/tag/create
 *
 * Body:
 * {
 *   code: string        // 唯一碼，英文小寫加底線，例如 interest_food
 *   name: string        // 顯示名稱
 *   category: TagCategory
 *   color?: string      // hex，預設 #6B7280
 *   description?: string
 * }
 *
 * Response: TagDoc & { id: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { code, name, category, color = '#6B7280', description = '' } = body

  if (!code || !name || !category) {
    throw createError({ statusCode: 400, statusMessage: 'code, name, category are required' })
  }

  if (!/^[a-z][a-z0-9_]*$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'code must be lowercase letters, numbers and underscores' })
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
  }

  // 檢查 code 唯一性
  const db = getDb()
  const existing = await db.collection('tags').where('code', '==', code).limit(1).get()
  if (!existing.empty) {
    throw createError({ statusCode: 409, statusMessage: `Tag code "${code}" already exists` })
  }

  const id = uuidv4()
  const now = FieldValue.serverTimestamp()

  const doc: TagDoc = {
    code,
    name,
    category,
    color,
    description,
    status: 'active',
    createdBy: '',
    createdAt: now,
    updatedAt: now,
  }

  await db.collection('tags').doc(id).set(doc)
  return { id, ...doc }
})
