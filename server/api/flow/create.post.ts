import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  assertValidFlowMessages,
  assertValidFlowName,
} from '~~/server/utils/flow-validator'
import { WORKSPACE_FLOW_MODULE_TYPES, type ModuleType } from '~~/shared/types/conversation-stats'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const body = await readBody(event)
  const { name, messages, isActive, moduleType } = body

  const validName = assertValidFlowName(name)
  assertValidFlowMessages(messages)

  const resolvedModuleType: ModuleType = WORKSPACE_FLOW_MODULE_TYPES.includes(moduleType)
    ? moduleType
    : 'bot_flow'

  const id = uuidv4()
  const doc = await createDoc('flows', id, {
    name: validName,
    messages,
    isActive: isActive ?? true,
    moduleType: resolvedModuleType,
    isSystem: false,
    workspaceId,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
