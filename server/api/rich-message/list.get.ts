export default defineEventHandler(async () => {
  const items = await listDocs('richMessages', (ref) =>
    ref.orderBy('createdAt', 'desc'),
  )
  return items
})
