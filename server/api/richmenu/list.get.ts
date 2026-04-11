export default defineEventHandler(async () => {
  const menus = await listDocs('richmenus', (ref) =>
    ref.orderBy('createdAt', 'desc'),
  )
  return menus
})
