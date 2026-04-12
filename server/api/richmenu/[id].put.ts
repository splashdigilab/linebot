import type { messagingApi } from '@line/bot-sdk'

export default defineEventHandler(async (event) => {
  const firestoreId = getRouterParam(event, 'id')
  if (!firestoreId) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const { name, size, areas, chatBarText, selected, setAsDefault, imageBase64, contentType } = body

  // Get existing doc to get the old richMenuId and old imageUrl
  const oldDoc = await getDoc<any>('richmenus', firestoreId)
  if (!oldDoc) throw createError({ statusCode: 404, statusMessage: 'Rich Menu not found' })

  // The alias ID stays the same (based on firestoreId), only richMenuId changes
  // Use stored aliasId or derive in pure alphanumeric format (no hyphens — LINE requirement)
  const aliasId = oldDoc.aliasId ?? `rm${firestoreId.replace(/-/g, '')}`

  // 1. Create NEW Rich Menu on LINE
  const richMenuPayload: messagingApi.RichMenuRequest = {
    size: size ?? { width: 2500, height: 843 },
    selected: selected ?? true,
    name,
    chatBarText: chatBarText ?? '選單',
    areas,
  }

  let newRichMenuId: string
  try {
    newRichMenuId = await createRichMenu(richMenuPayload)
  } catch (err: any) {
    // Try to read LINE's actual error body from the Response cause
    let lineDetail = ''
    try {
      const resp = err.cause ?? err.originalError?.response
      if (resp && typeof resp.json === 'function') {
        const body = await resp.json()
        lineDetail = JSON.stringify(body)
      }
    } catch {}
    console.error('[richmenu/put] LINE createRichMenu error:', lineDetail || err.message)
    throw createError({ statusCode: 400, statusMessage: lineDetail || err.message || 'Unknown LINE error' })
  }


  // 2. Upload Image to NEW Rich Menu
  let imageBuffer: Buffer
  let finalContentType = contentType ?? 'image/png'

  if (imageBase64) {
    imageBuffer = Buffer.from(imageBase64, 'base64')
  } else if (oldDoc.imageUrl) {
    try {
      const response = await fetch(oldDoc.imageUrl)
      const arrayBuffer = await response.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
      finalContentType = response.headers.get('content-type') || 'image/png'
    } catch (e) {
      await deleteLineRichMenu(newRichMenuId)
      throw createError({ statusCode: 500, statusMessage: 'Failed to fetch existing image from storage' })
    }
  } else {
    await deleteLineRichMenu(newRichMenuId)
    throw createError({ statusCode: 400, statusMessage: 'No image provided and no existing image found' })
  }

  await uploadRichMenuImage(newRichMenuId, imageBuffer, finalContentType)

  // 3. Update Alias to point to the NEW richMenuId (delete old → recreate same aliasId)
  try {
    await updateRichMenuAlias(newRichMenuId, aliasId)
  } catch (e) {
    console.warn('[richmenu/put] Failed to update alias:', e)
  }

  // 4. Handle default setting
  if (setAsDefault) {
    await setDefaultRichMenu(newRichMenuId)
    const db = getDb()
    const prev = await db.collection('richmenus').where('isDefault', '==', true).get()
    const batch = db.batch()
    prev.docs.forEach((d) => {
      if (d.id !== firestoreId) batch.update(d.ref, { isDefault: false })
    })
    await batch.commit()
  }

  // 5. Delete old Rich Menu from LINE
  if (oldDoc.richMenuId) {
    try {
      await deleteLineRichMenu(oldDoc.richMenuId)
    } catch (e) {
      console.warn('[richmenu] Failed to delete old LINE rich menu:', e)
    }
  }

  // 6. Update Firestore record
  let finalImageUrl = oldDoc.imageUrl
  if (imageBase64) {
    const storage = getStorage()
    const bucket = storage.bucket()
    const ext = finalContentType.includes('jpeg') ? 'jpg' : 'png'
    const fileName = `richmenus/${newRichMenuId}.${ext}`
    const file = bucket.file(fileName)
    await file.save(imageBuffer, { contentType: finalContentType })
    await file.makePublic()
    finalImageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`
  }

  await updateDoc('richmenus', firestoreId, {
    richMenuId: newRichMenuId,
    aliasId,
    name,
    size: size ?? { width: 2500, height: 843 },
    chatBarText: chatBarText ?? '選單',
    areas,
    isDefault: setAsDefault ?? false,
    imageUrl: finalImageUrl,
  })

  return { success: true, richMenuId: newRichMenuId, aliasId, imageUrl: finalImageUrl }
})
