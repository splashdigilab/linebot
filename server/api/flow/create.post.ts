import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import {
  assertValidFlowMessages,
  assertValidFlowName,
} from '~~/server/utils/flow-validator'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, messages, isActive } = body

  const validName = assertValidFlowName(name)
  assertValidFlowMessages(messages)

  const id = uuidv4()
  const doc = await createDoc('flows', id, {
    name: validName,
    messages,
    isActive: isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
