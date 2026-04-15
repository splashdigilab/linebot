import {
  normalizeUnifiedActions,
  validateUnifiedAction,
} from '~~/shared/action-schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const { name, layoutId, transparentBackground, altText, heroImageUrl, actions, isActive } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) {
    if (!String(name).trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
    updates.name = String(name).trim()
  }
  if (layoutId !== undefined) updates.layoutId = layoutId
  if (transparentBackground !== undefined) updates.transparentBackground = Boolean(transparentBackground)
  if (altText !== undefined) {
    if (!String(altText).trim()) throw createError({ statusCode: 400, statusMessage: 'altText is required' })
    updates.altText = String(altText).trim()
  }
  if (heroImageUrl !== undefined) {
    const nextHeroImageUrl = String(heroImageUrl || '').trim()
    if (!nextHeroImageUrl) throw createError({ statusCode: 400, statusMessage: 'heroImageUrl is required' })
    updates.heroImageUrl = nextHeroImageUrl
  }
  if (actions !== undefined) {
    const normalizedActions = normalizeUnifiedActions(actions)
    if (normalizedActions.length < 1) throw createError({ statusCode: 400, statusMessage: 'actions are required' })
    for (const action of normalizedActions) {
      const error = validateUnifiedAction(action)
      if (error) {
        throw createError({ statusCode: 400, statusMessage: `slot ${action.slot}: ${error}` })
      }
    }
    updates.actions = normalizedActions
  }
  if (isActive !== undefined) updates.isActive = isActive

  await updateDoc('richMessages', id, updates)
  return { id, ...updates }
})
