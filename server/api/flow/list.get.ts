export default defineEventHandler(async () => {
  const flows = await listDocs('flows', (ref) =>
    ref.orderBy('createdAt', 'desc'),
  )
  return flows.map((flow: any) => {
    const { triggers, trigger, ...rest } = flow
    return rest
  })
})
