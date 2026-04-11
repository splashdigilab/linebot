export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const { name, triggers, messages, isActive } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (triggers !== undefined) {
    // Support both array and legacy single string
    updates.triggers = Array.isArray(triggers) ? triggers : [triggers]
  }
  if (messages !== undefined) updates.messages = messages
  if (isActive !== undefined) updates.isActive = isActive

  await updateDoc('flows', id, updates)

  return { id, ...updates }
})
