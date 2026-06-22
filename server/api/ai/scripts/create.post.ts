import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import { embedTriggerExamples, invalidateScriptsCache, SCRIPTS_COLLECTION } from '~~/server/utils/ai-scripts'
import { normalizeScriptInput, stripTriggerEmbeddings, type ScriptInput } from '~~/server/utils/ai-script-validation'
import { validateScriptDoc } from '~~/shared/types/ai-script'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const input: ScriptInput = normalizeScriptInput(body)
  const err = validateScriptDoc({ name: input.name, nodes: input.nodes, rootNodeId: input.rootNodeId })
  if (err) throw createError({ statusCode: 400, statusMessage: err })

  // 語意觸發的範例 embedding 在 server 端計算後存檔；Gemini 暫時故障時回清楚的可重試錯誤，
  // 而非讓整筆存檔噴 500
  let nodes
  try {
    nodes = await embedTriggerExamples(input.nodes)
  }
  catch (e) {
    console.error('[ai/scripts/create] embedTriggerExamples failed:', e)
    throw createError({ statusCode: 503, statusMessage: '語意範例的向量計算暫時失敗，請稍後再試一次' })
  }

  const id = uuidv4()
  const now = FieldValue.serverTimestamp()
  await getDb().collection(SCRIPTS_COLLECTION).doc(id).set({
    workspaceId,
    name: input.name,
    enabled: input.enabled,
    priority: input.priority,
    nodes,
    rootNodeId: input.rootNodeId,
    createdAt: now,
    updatedAt: now,
  })
  invalidateScriptsCache(workspaceId)
  // 回傳給前端不夾帶肥大的 embedding 陣列
  return { id, ...input, nodes: stripTriggerEmbeddings(nodes) }
})
