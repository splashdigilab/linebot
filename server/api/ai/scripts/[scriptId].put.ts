import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { invalidateScriptsCache, SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'
import { normalizeScriptInput } from '~~/server/utils/ai-script-validation'
import { validateScriptDoc } from '~~/shared/types/ai-script'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const scriptId = String(getRouterParam(event, 'scriptId') ?? '').trim()
  if (!scriptId) throw createError({ statusCode: 400, statusMessage: 'scriptId required' })

  const body = await readBody(event)
  const input = normalizeScriptInput(body)
  const err = validateScriptDoc({ name: input.name, nodes: input.nodes, rootNodeId: input.rootNodeId })
  if (err) throw createError({ statusCode: 400, statusMessage: err })

  const db = getDb()
  const ref = db.collection(SCRIPTS_COLLECTION).doc(scriptId)
  const snap = await ref.get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: 'script not found' })
  if ((snap.data() as { workspaceId?: string })?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  await ref.update({
    name: input.name,
    enabled: input.enabled,
    priority: input.priority,
    nodes: input.nodes,
    rootNodeId: input.rootNodeId,
    updatedAt: FieldValue.serverTimestamp(),
  })
  invalidateScriptsCache(workspaceId)
  return { id: scriptId, ...input }
})
