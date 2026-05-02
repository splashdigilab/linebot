import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { requireWorkspaceAccess, isSuperAdmin } from '~~/server/utils/workspace-auth'
import { getFirebaseAuth } from '~~/server/utils/firebase'

/**
 * POST /api/admin/organizations
 * Super admin only：建立新組織。
 *
 * Body: { name: string, plan?: OrganizationPlan, ownerUid: string }
 */
export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const decoded = await getFirebaseAuth().verifyIdToken(token).catch(() => {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  })

  if (!isSuperAdmin(decoded)) {
    throw createError({ statusCode: 403, statusMessage: 'Super admin only' })
  }

  const body = await readBody(event)
  const { name, plan = 'free', ownerUid } = body

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  if (!ownerUid?.trim()) throw createError({ statusCode: 400, statusMessage: 'ownerUid is required' })

  const id = uuidv4()
  const db = getDb()
  await db.collection('organizations').doc(id).set({
    name: String(name).trim(),
    plan,
    ownerId: ownerUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id, name, plan, ownerId: ownerUid }
})
