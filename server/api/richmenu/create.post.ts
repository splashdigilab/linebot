import { v4 as uuidv4 } from 'uuid'
import { FieldValue } from 'firebase-admin/firestore'
import type { messagingApi } from '@line/bot-sdk'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, size, areas, chatBarText, selected, setAsDefault } = body

  const richMenuPayload: messagingApi.RichMenuRequest = {
    size: size ?? { width: 2500, height: 843 },
    selected: selected ?? true,
    name,
    chatBarText: chatBarText ?? '選單',
    areas,
  }

  let richMenuId: string
  try {
    richMenuId = await createRichMenu(richMenuPayload)
  } catch (err: any) {
    if (err.originalError?.response?.data) {
      throw createError({ statusCode: 400, statusMessage: JSON.stringify(err.originalError.response.data) })
    } else {
      throw createError({ statusCode: 400, statusMessage: err.message || 'Unknown LINE error' })
    }
  }

  if (setAsDefault) {
    await setDefaultRichMenu(richMenuId)
    const db = getDb()
    const prev = await db.collection('richmenus').where('isDefault', '==', true).get()
    const batch = db.batch()
    prev.docs.forEach((d) => batch.update(d.ref, { isDefault: false }))
    await batch.commit()
  }

  // Generate Firestore ID first so we can use it as alias
  const id = uuidv4()
  const aliasId = `menu-${id}`

  // Create Rich Menu Alias for instant richmenuswitch support
  try {
    await createRichMenuAlias(richMenuId, aliasId)
  } catch (e) {
    console.warn('[richmenu/create] Failed to create alias:', e)
  }

  const doc = await createDoc('richmenus', id, {
    name,
    richMenuId,
    aliasId,
    size: size ?? { width: 2500, height: 843 },
    areas,
    chatBarText: chatBarText ?? '選單',
    imageUrl: '',
    isDefault: setAsDefault ?? false,
    createdAt: FieldValue.serverTimestamp(),
  })

  return doc
})
