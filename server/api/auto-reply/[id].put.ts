import {
  normalizeAutoReplyRule,
  validateAutoReplyRule,
} from '~~/shared/auto-reply-rule'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')!
  const rawBody = await readBody(event)
  const body = normalizeAutoReplyRule(rawBody)
  const errorMessage = validateAutoReplyRule(body)
  if (errorMessage) {
    throw createError({ statusCode: 400, statusMessage: errorMessage })
  }

  const db = getDb()
  const existing = await db.collection('autoReplies').doc(id).get()
  if (!existing.exists || existing.data()?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const moduleId = body.action.type === 'module' ? body.action.moduleId : ''
  const updates = {
    name: body.name || (body.matchType === 'anyText' ? '輸入任何內容' : body.keyword || '自動回覆'),
    keyword: body.keyword,
    matchType: body.matchType,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
  }

  await db.collection('autoReplies').doc(id).update(updates)
  return { id, ...updates }
})
