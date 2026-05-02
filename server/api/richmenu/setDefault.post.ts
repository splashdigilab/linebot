import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const { richMenuId, firestoreId } = body

  if (!richMenuId) {
    throw createError({ statusCode: 400, statusMessage: 'richMenuId is required' })
  }

  if (firestoreId) {
    const menu = await getDoc<{ workspaceId?: string }>('richmenus', firestoreId)
    if (!menu || menu.workspaceId !== workspaceId) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }
  }

  await setDefaultRichMenu(richMenuId)

  const db = getDb()
  const prev = await db.collection('richmenus').where('isDefault', '==', true).get()
  const batch = db.batch()
  prev.docs.forEach((d) => batch.update(d.ref, { isDefault: false }))
  await batch.commit()

  if (firestoreId) {
    await updateDoc('richmenus', firestoreId, { isDefault: true })
  }

  return { success: true }
})
