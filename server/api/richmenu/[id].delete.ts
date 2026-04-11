export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const menu = await getDoc<{ richMenuId: string; aliasId?: string }>('richmenus', id)
  if (!menu) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  // Delete the Rich Menu Alias first (to free up the alias ID)
  if (menu.aliasId) {
    try {
      await deleteRichMenuAlias(menu.aliasId)
    } catch (e) {
      console.warn('[richmenu/delete] Failed to delete alias:', e)
    }
  }

  // Delete the Rich Menu from LINE
  try {
    await deleteLineRichMenu(menu.richMenuId)
  } catch (e) {
    console.warn('[richmenu/delete] LINE delete failed:', e)
  }

  await deleteDoc('richmenus', id)

  return { success: true }
})
