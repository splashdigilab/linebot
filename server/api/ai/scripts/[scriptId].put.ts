import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { embedTriggerExamples, invalidateScriptsCache, SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'
import { normalizeScriptInput, stripTriggerEmbeddings } from '~~/server/utils/ai-script-validation'
import { validateScriptDoc, type ScriptNode } from '~~/shared/types/ai-script'

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
  const existing = snap.data() as { workspaceId?: string; nodes?: ScriptNode[] }
  if (existing?.workspaceId !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'workspace mismatch' })
  }

  // 帶入舊 nodes 讓未變的範例沿用既有向量；Gemini 暫時故障時回可重試錯誤而非 500
  let nodes
  try {
    nodes = await embedTriggerExamples(input.nodes, existing.nodes)
  }
  catch (e) {
    console.error('[ai/scripts/put] embedTriggerExamples failed:', e)
    throw createError({ statusCode: 503, statusMessage: '語意範例的向量計算暫時失敗，請稍後再試一次' })
  }

  await ref.update({
    name: input.name,
    enabled: input.enabled,
    priority: input.priority,
    nodes,
    rootNodeId: input.rootNodeId,
    updatedAt: FieldValue.serverTimestamp(),
  })
  invalidateScriptsCache(workspaceId)
  return { id: scriptId, ...input, nodes: stripTriggerEmbeddings(nodes) }
})
