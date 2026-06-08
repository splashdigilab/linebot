import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { invalidateScriptsCache, SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const scriptId = String(getRouterParam(event, 'scriptId') ?? '').trim()
  if (!scriptId) throw createError({ statusCode: 400, statusMessage: 'scriptId required' })

  const db = getDb()
  const ref = db.collection(SCRIPTS_COLLECTION).doc(scriptId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: true }
  if ((snap.data() as { workspaceId?: string })?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }
  await ref.delete()
  invalidateScriptsCache(workspaceId)
  return { ok: true }
})
