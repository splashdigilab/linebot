import {
  assertValidFlowMessages,
  assertValidFlowName,
} from '~~/server/utils/flow-validator'
import { getDoc } from '~~/server/utils/firebase'
import type { ModuleType } from '~~/shared/types/conversation-stats'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'

const VALID_MODULE_TYPES: ModuleType[] = ['welcome', 'bot_flow', 'system_notice', 'live_agent']

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const existing = await getDoc<{ isSystem?: boolean; moduleType?: ModuleType; workspaceId?: string }>('flows', id)
  if (!existing || existing.workspaceId !== workspaceId) throw createError({ statusCode: 404, statusMessage: '找不到此模組' })

  const body = await readBody(event)
  const { name, messages, isActive, moduleType } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = assertValidFlowName(name)
  if (messages !== undefined) {
    assertValidFlowMessages(messages)
    updates.messages = messages
  }
  if (isActive !== undefined) updates.isActive = isActive
  if (moduleType !== undefined && VALID_MODULE_TYPES.includes(moduleType)) {
    if (existing.isSystem) {
      if (
        existing.moduleType !== undefined
        && (moduleType as ModuleType) !== existing.moduleType
      ) {
        throw createError({ statusCode: 403, statusMessage: '系統模組不可變更模組類型' })
      }
    }
    else {
      updates.moduleType = moduleType as ModuleType
    }
  }

  await updateDoc('flows', id, updates)

  return { id, ...updates }
})
