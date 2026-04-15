import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, messages, isActive } = body

  if (!name || !messages?.length) {
    throw createError({ statusCode: 400, statusMessage: 'name and messages are required' })
  }

  const id = uuidv4()
  const doc = await createDoc('flows', id, {
    name,
    messages,
    isActive: isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
