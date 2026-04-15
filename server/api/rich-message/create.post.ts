import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  normalizeUnifiedActions,
  validateUnifiedAction,
} from '~~/shared/action-schema'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, layoutId, transparentBackground, altText, heroImageUrl, actions, isActive } = body

  if (!name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  if (!altText?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'altText is required' })
  }
  if (!heroImageUrl?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'heroImageUrl is required' })
  }
  const normalizedActions = normalizeUnifiedActions(actions)
  if (!Array.isArray(normalizedActions) || normalizedActions.length < 1) {
    throw createError({ statusCode: 400, statusMessage: 'actions are required' })
  }
  for (const action of normalizedActions) {
    const error = validateUnifiedAction(action)
    if (error) {
      throw createError({ statusCode: 400, statusMessage: `slot ${action.slot}: ${error}` })
    }
  }
  const id = uuidv4()
  const doc = await createDoc('richMessages', id, {
    name: String(name).trim(),
    layoutId: typeof layoutId === 'string' ? layoutId : 'custom',
    transparentBackground: Boolean(transparentBackground),
    altText: String(altText).trim(),
    heroImageUrl: typeof heroImageUrl === 'string' ? heroImageUrl.trim() : '',
    actions: normalizedActions,
    isActive: isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
