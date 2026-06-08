import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { invalidateScriptsCache, SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'
import { normalizeScriptInput, type ScriptInput } from '~~/server/utils/ai-script-validation'
import { validateScriptDoc } from '~~/shared/types/ai-script'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const input: ScriptInput = normalizeScriptInput(body)
  const err = validateScriptDoc({ name: input.name, nodes: input.nodes, rootNodeId: input.rootNodeId })
  if (err) throw createError({ statusCode: 400, statusMessage: err })

  const id = uuidv4()
  const now = FieldValue.serverTimestamp()
  await getDb().collection(SCRIPTS_COLLECTION).doc(id).set({
    workspaceId,
    name: input.name,
    enabled: input.enabled,
    priority: input.priority,
    nodes: input.nodes,
    rootNodeId: input.rootNodeId,
    createdAt: now,
    updatedAt: now,
  })
  invalidateScriptsCache(workspaceId)
  return { id, ...input }
})
