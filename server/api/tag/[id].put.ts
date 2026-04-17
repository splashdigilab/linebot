import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import type { TagCategory, TagStatus } from '~~/shared/types/tag-broadcast'

/**
 * PUT /api/tag/:id
 *
 * Body（所有欄位皆為可選，只傳要更新的）:
 * {
 *   name?: string
 *   category?: TagCategory
 *   color?: string
 *   description?: string
 *   status?: 'active' | 'inactive'
 * }
 *
 * Note: code 不允許修改
 *
 * Response: { id: string, ...updatedFields }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const ref = db.collection('tags').doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
  }

  const body = await readBody(event)
  const allowed: (keyof Pick<any, 'name' | 'category' | 'color' | 'description' | 'status'>)[] =
    ['name', 'category', 'color', 'description', 'status']

  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  await ref.update(updates)
  return { id, ...snap.data(), ...updates }
})
