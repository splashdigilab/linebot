import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  normalizeAutoReplyRule,
  validateAutoReplyRule,
} from '~~/shared/auto-reply-rule'

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const body = normalizeAutoReplyRule(rawBody)
  const errorMessage = validateAutoReplyRule(body)
  if (errorMessage) {
    throw createError({ statusCode: 400, statusMessage: errorMessage })
  }

  const id = uuidv4()
  const moduleId = body.action.type === 'module' ? body.action.moduleId : ''
  const defaultName = body.matchType === 'anyText'
    ? '輸入任何內容'
    : (body.keyword || '自動回覆')
  const db = getDb()
  await db.collection('autoReplies').doc(id).set({
    name: body.name || defaultName,
    keyword: body.keyword,
    matchType: body.matchType,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
    createdAt: FieldValue.serverTimestamp(),
  })

  return {
    id,
    name: body.name || defaultName,
    keyword: body.keyword,
    matchType: body.matchType,
    action: body.action,
    moduleId,
    isActive: body.isActive,
    tagging: body.tagging,
  }
})
