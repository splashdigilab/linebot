export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const { name, keyword, moduleId, isActive } = body

  const db = getDb()
  const updates: Record<string, any> = {}
  if (name !== undefined) updates.name = name
  if (keyword !== undefined) updates.keyword = keyword.trim()
  if (moduleId !== undefined) updates.moduleId = moduleId
  if (isActive !== undefined) updates.isActive = isActive

  await db.collection('autoReplies').doc(id).update(updates)
  return { id, ...updates }
})
