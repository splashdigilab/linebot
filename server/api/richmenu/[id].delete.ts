export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const menu = await getDoc<{ richMenuId: string }>('richmenus', id)
  if (!menu) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  try {
    await deleteLineRichMenu(menu.richMenuId)
  }
  catch (e) {
    console.warn('[richmenu/delete] LINE delete failed:', e)
  }

  await deleteDoc('richmenus', id)

  return { success: true }
})
