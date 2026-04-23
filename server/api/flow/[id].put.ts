import {
  assertValidFlowMessages,
  assertValidFlowName,
} from '~~/server/utils/flow-validator'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const { name, messages, isActive } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = assertValidFlowName(name)
  if (messages !== undefined) {
    assertValidFlowMessages(messages)
    updates.messages = messages
  }
  if (isActive !== undefined) updates.isActive = isActive

  await updateDoc('flows', id, updates)

  return { id, ...updates }
})
