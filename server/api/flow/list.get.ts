export default defineEventHandler(async () => {
  const flows = await listDocs('flows', (ref) =>
    ref.orderBy('createdAt', 'desc'),
  )
  return flows
})
