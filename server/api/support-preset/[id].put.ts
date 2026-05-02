import {
  normalizeSupportPreset,
  validateSupportPreset,
} from '~~/shared/support-preset'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')!
  const rawBody = await readBody(event)
  const body = normalizeSupportPreset(rawBody)
  const errorMessage = validateSupportPreset(body)
  if (errorMessage) {
    throw createError({ statusCode: 400, statusMessage: errorMessage })
  }

  const db = getDb()
  const existing = await db.collection('supportPresets').doc(id).get()
  if (!existing.exists || existing.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const moduleId = body.action.type === 'module' ? body.action.moduleId : ''
  const updates = {
    name: body.name,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
  }

  await db.collection('supportPresets').doc(id).update(updates)
  return { id, ...updates }
})
