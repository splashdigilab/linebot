import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  assertValidFlowMessages,
  assertValidFlowName,
} from '~~/server/utils/flow-validator'
import type { ModuleType } from '~~/shared/types/conversation-stats'

const VALID_MODULE_TYPES: ModuleType[] = ['welcome', 'bot_flow', 'system_notice', 'live_agent']

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, messages, isActive, moduleType } = body

  const validName = assertValidFlowName(name)
  assertValidFlowMessages(messages)

  const resolvedModuleType: ModuleType = VALID_MODULE_TYPES.includes(moduleType)
    ? moduleType
    : 'bot_flow'

  const id = uuidv4()
  const doc = await createDoc('flows', id, {
    name: validName,
    messages,
    isActive: isActive ?? true,
    moduleType: resolvedModuleType,
    isSystem: false,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
