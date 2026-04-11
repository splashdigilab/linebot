import type { messagingApi } from '@line/bot-sdk'

export default defineEventHandler(async (event) => {
  const firestoreId = getRouterParam(event, 'id')
  if (!firestoreId) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const { name, size, areas, chatBarText, selected, setAsDefault, imageBase64, contentType } = body

  // Get existing doc to get the old richMenuId and old imageUrl
  const oldDoc = await getDoc<any>('richmenus', firestoreId)
  if (!oldDoc) throw createError({ statusCode: 404, statusMessage: 'Rich Menu not found' })

  // 1. Create NEW Rich Menu on LINE
  const richMenuPayload: messagingApi.RichMenuRequest = {
    size: size ?? { width: 2500, height: 843 },
    selected: selected ?? true,
    name,
    chatBarText: chatBarText ?? '選單',
    areas,
  }

  console.log('[richmenu/put] payload areas:', JSON.stringify(richMenuPayload.areas, null, 2))

  let newRichMenuId: string
  try {
    newRichMenuId = await createRichMenu(richMenuPayload)
  } catch (err: any) {
    if (err.originalError?.response?.data) {
      throw createError({ statusCode: 400, statusMessage: JSON.stringify(err.originalError.response.data) })
    } else {
      throw createError({ statusCode: 400, statusMessage: err.message || 'Unknown LINE error' })
    }
  }

  // 2. Upload Image to NEW Rich Menu
  let imageBuffer: Buffer
  let finalContentType = contentType ?? 'image/png'

  if (imageBase64) {
    // Has new image uploaded during edit
    imageBuffer = Buffer.from(imageBase64, 'base64')
  } else if (oldDoc.imageUrl) {
    // Inherit old image
    try {
      const response = await fetch(oldDoc.imageUrl)
      const arrayBuffer = await response.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
      finalContentType = response.headers.get('content-type') || 'image/png'
    } catch (e) {
      // If fetching old image fails, we might still want to proceed or throw
      // In this case we throw since LINE requires an image to activate it.
      await deleteLineRichMenu(newRichMenuId)
      throw createError({ statusCode: 500, statusMessage: 'Failed to fetch existing image from storage' })
    }
  } else {
    // Failsafe
    await deleteLineRichMenu(newRichMenuId)
    throw createError({ statusCode: 400, statusMessage: 'No image provided and no existing image found' })
  }

  // Actually upload to LINE
  await uploadRichMenuImage(newRichMenuId, imageBuffer, finalContentType)

  // 3. Handle default setting
  if (setAsDefault) {
    await setDefaultRichMenu(newRichMenuId)
    // Clear others
    const db = getDb()
    const prev = await db.collection('richmenus').where('isDefault', '==', true).get()
    const batch = db.batch()
    prev.docs.forEach((d) => {
      if (d.id !== firestoreId) batch.update(d.ref, { isDefault: false })
    })
    await batch.commit()
  } else if (oldDoc.isDefault) {
    // If it was default and user un-checked the box...
    // LINE doesn't have "remove default", it just stays default until replaced.
    // However we update firestore to reflect intention.
  }

  // 4. Delete old Rich Menu from LINE
  if (oldDoc.richMenuId) {
    try {
      await deleteLineRichMenu(oldDoc.richMenuId)
    } catch (e) {
      console.warn('[richmenu] Failed to delete old LINE rich menu:', e)
    }
  }

  // 5. Update Firestore record
  // Note: we update the existing doc (which preserves createdAt and id)
  // We keep the old imageUrl if imageBase64 is empty, otherwise we'd need to re-upload to Cloud Storage.
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
    name,
    size: size ?? { width: 2500, height: 843 },
    chatBarText: chatBarText ?? '選單',
    areas,
    isDefault: setAsDefault ?? false,
    imageUrl: finalImageUrl
  })

  return { success: true, richMenuId: newRichMenuId, imageUrl: finalImageUrl }
})
