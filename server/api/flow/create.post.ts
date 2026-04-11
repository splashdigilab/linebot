import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, triggers, messages, isActive } = body

  // Support legacy single trigger string too
  const normalizedTriggers: string[] = Array.isArray(triggers)
    ? triggers
    : (triggers ? [triggers] : [])

  if (!name || !normalizedTriggers.length || !messages?.length) {
    throw createError({ statusCode: 400, statusMessage: 'name, triggers (array), and messages are required' })
  }

  const id = uuidv4()
  const doc = await createDoc('flows', id, {
    name,
    triggers: normalizedTriggers,
    messages,
    isActive: isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
