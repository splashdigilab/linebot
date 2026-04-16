import {
  normalizeAutoReplyRule,
  validateAutoReplyRule,
} from '~~/shared/auto-reply-rule'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const rawBody = await readBody(event)
  const body = normalizeAutoReplyRule(rawBody)
  const errorMessage = validateAutoReplyRule(body)
  if (errorMessage) {
    throw createError({ statusCode: 400, statusMessage: errorMessage })
  }

  const moduleId = body.action.type === 'module' ? body.action.moduleId : ''
  const db = getDb()
  const updates = {
    name: body.name || (body.matchType === 'anyText' ? '輸入任何內容' : body.keyword || '自動回覆'),
    keyword: body.keyword,
    matchType: body.matchType,
    action: body.action,
    moduleId,
    isActive: body.isActive,
  }

  await db.collection('autoReplies').doc(id).update(updates)
  return { id, ...updates }
})
