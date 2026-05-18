import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const orderedIds = body?.orderedIds

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds is required' })
  }

  const ids = orderedIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
  if (ids.length !== orderedIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds 格式錯誤' })
  }

  const allFlows = await listDocs<{ isSystem?: boolean; workspaceId?: string }>('flows', (ref) =>
    ref.where('workspaceId', '==', workspaceId),
  )

  const regularFlows = allFlows.filter((f) => !f.isSystem)
  const regularIdSet = new Set(regularFlows.map((f) => f.id))

  if (ids.length !== regularFlows.length) {
    throw createError({ statusCode: 400, statusMessage: '排序列表與可排序模組數量不符' })
  }

  for (const id of ids) {
    if (!regularIdSet.has(id)) {
      throw createError({ statusCode: 400, statusMessage: '含有無效或不可排序的模組' })
    }
  }

  const db = getDb()
  const batch = db.batch()
  ids.forEach((id, index) => {
    batch.update(db.collection('flows').doc(id), { sortOrder: index })
  })
  await batch.commit()

  return { success: true }
})
