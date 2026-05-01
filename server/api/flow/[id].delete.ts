import { getDoc } from '~~/server/utils/firebase'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const flow = await getDoc<{ isSystem?: boolean }>('flows', id)
  if (flow?.isSystem) {
    throw createError({ statusCode: 403, statusMessage: '系統模組不可刪除' })
  }

  await deleteDoc('flows', id)

  return { success: true }
})
