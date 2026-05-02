import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  normalizeSupportPreset,
  validateSupportPreset,
} from '~~/shared/support-preset'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const rawBody = await readBody(event)
  const body = normalizeSupportPreset(rawBody)
  const errorMessage = validateSupportPreset(body)
  if (errorMessage) {
    throw createError({ statusCode: 400, statusMessage: errorMessage })
  }

  const id = uuidv4()
  const moduleId = body.action.type === 'module' ? body.action.moduleId : ''
  const db = getDb()
  await db.collection('supportPresets').doc(id).set({
    name: body.name,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
    workspaceId,
    createdAt: FieldValue.serverTimestamp(),
  })

  return {
    id,
    name: body.name,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
  }
})
