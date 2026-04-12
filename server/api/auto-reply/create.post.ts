import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { keyword, moduleId, isActive } = body

  if (!keyword || !moduleId) {
    throw createError({ statusCode: 400, statusMessage: 'keyword and moduleId are required' })
  }

  const id = uuidv4()
  const db = getDb()
  await db.collection('autoReplies').doc(id).set({
    keyword: keyword.trim(),
    moduleId,
    isActive: isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
  })

  return { id, keyword, moduleId, isActive: isActive ?? true }
})
