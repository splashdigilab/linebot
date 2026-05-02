import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const menu = await getDoc<{ richMenuId: string; aliasId?: string; workspaceId?: string }>('richmenus', id)
  if (!menu || menu.workspaceId !== workspaceId) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  // 先刪除圖文選單別名（釋出 alias ID）
  if (menu.aliasId) {
    try {
      await deleteRichMenuAlias(menu.aliasId)
    } catch (e) {
      console.warn('[richmenu/delete] Failed to delete alias:', e)
    }
  }

  // 從 LINE 刪除圖文選單
  try {
    await deleteLineRichMenu(menu.richMenuId)
  } catch (e) {
    console.warn('[richmenu/delete] LINE delete failed:', e)
  }

  await deleteDoc('richmenus', id)

  return { success: true }
})
