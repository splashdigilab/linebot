import type { webhook } from '@line/bot-sdk'
import type { messagingApi } from '@line/bot-sdk'
import { getDb } from './firebase'
import { replyMessage, getUserProfile, linkRichMenuIdToUser } from './line'
import { FieldValue } from 'firebase-admin/firestore'

// ── In-Memory Caching to Reduce DB Latency ──────────────────────────
const userCheckedCache = new Set<string>()

interface CacheEntry<T> {
  data: T
  expires: number
}
const flowDocCache = new Map<string, CacheEntry<FlowDoc | null>>()

// Cache lifetime in milliseconds (increased to 60s for better hit rate)
const CACHE_TTL_MS = 60 * 1000

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const cached = map.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }
  return undefined
}

function setCache<T>(map: Map<string, CacheEntry<T>>, key: string, data: T) {
  map.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
}

// ── Type Definitions ──────────────────────────────────────────────

interface FlowDoc {
  trigger: string
  messages: messagingApi.Message[]
  isActive: boolean
}

interface UserDoc {
  displayName: string
  pictureUrl: string
  createdAt: FirebaseFirestore.FieldValue
  activeInput?: {
    moduleId: string
    attribute?: string
    expiresAt: number
  } | null
  attributes?: Record<string, string>
}

function renderWithAttributes(value: string, attributes: Record<string, string>): string {
  if (!value || !value.includes('{{')) return value
  return value.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
    return attributes[key] ?? ''
  })
}

function buildAttributeContext(userData: UserDoc | null): Record<string, string> {
  const context: Record<string, string> = { ...(userData?.attributes ?? {}) }
  if (userData?.displayName) {
    context.displayName = userData.displayName
  }
  return context
}

// ── Helpers ───────────────────────────────────────────────────────

async function ensureUser(userId: string): Promise<UserDoc | null> {
  const db = getDb()
  const ref = db.collection('users').doc(userId)
  const snap = await ref.get()
  
  if (!snap.exists) {
    const profile = await getUserProfile(userId)
    const newDoc: UserDoc = {
      displayName: profile?.displayName ?? userId,
      pictureUrl: profile?.pictureUrl ?? '',
      createdAt: FieldValue.serverTimestamp(),
    }
    await ref.set(newDoc)
    return newDoc
  }
  return snap.data() as UserDoc
}

async function dispatchPostReplyActions(userId: string, messages: any[]) {
  const userInputMsg = messages.find((m: any) => m.type === 'userInput')
  if (userInputMsg && userInputMsg.moduleId) {
    const db = getDb()
    await db.collection('users').doc(userId).update({
      activeInput: {
        moduleId: userInputMsg.moduleId,
        attribute: userInputMsg.attribute || null,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
      }
    })
  }
}

async function matchFlow(trigger: string): Promise<FlowDoc | null> {
  const cacheKey = `trigger:${trigger}`
  const cachedFlow = getCached(flowDocCache, cacheKey)
  if (cachedFlow !== undefined) return cachedFlow

  const db = getDb()

  // Execute all potential lookups concurrently to reduce latency
  const [autoReplySnap, legacySnap, legacyStrSnap] = await Promise.all([
    db.collection('autoReplies').where('keyword', '==', trigger).where('isActive', '==', true).limit(1).get(),
    db.collection('flows').where('triggers', 'array-contains', trigger).where('isActive', '==', true).limit(1).get(),
    db.collection('flows').where('trigger', '==', trigger).where('isActive', '==', true).limit(1).get()
  ])

  // 1: Match against autoReplies collection
  if (!autoReplySnap.empty) {
    const rule = autoReplySnap.docs[0].data()
    // try to get from cache first
    const moduleCacheKey = `flow:${rule.moduleId}`
    let moduleFlow = getCached(flowDocCache, moduleCacheKey)
    if (moduleFlow) {
      setCache(flowDocCache, cacheKey, moduleFlow)
      return moduleFlow
    }

    const moduleSnap = await db.collection('flows').doc(rule.moduleId).get()
    if (moduleSnap.exists && moduleSnap.data()?.isActive) {
      const result = moduleSnap.data() as FlowDoc
      setCache(flowDocCache, moduleCacheKey, result)
      setCache(flowDocCache, cacheKey, result)
      return result
    }
  }

  // 2: Legacy fallback (array form)
  if (!legacySnap.empty) {
    const result = legacySnap.docs[0].data() as FlowDoc
    setCache(flowDocCache, cacheKey, result)
    return result
  }

  // 3: Legacy fallback (string form)
  if (!legacyStrSnap.empty) {
    const result = legacyStrSnap.docs[0].data() as FlowDoc
    setCache(flowDocCache, cacheKey, result)
    return result
  }

  setCache(flowDocCache, cacheKey, null)
  return null
}

// ── Main Event Handlers ───────────────────────────────────────────

function buildLineMessages(dbMessages: any[], attributes: Record<string, string> = {}): messagingApi.Message[] {
  if (!dbMessages) return []
  return dbMessages.flatMap((msg) => {
    // ── Text with buttons → Buttons Template ──
    if (msg.type === 'text' && msg.buttons && msg.buttons.length > 0) {
      const renderedText = renderWithAttributes(msg.text || '', attributes)
      return [{
        type: 'template',
        altText: renderedText.slice(0, 400),
        template: {
          type: 'buttons',
          text: (renderedText || '無內容').slice(0, 160),
          actions: msg.buttons.slice(0, 4).map((b: any) => {
            if (b.type === 'uri') {
              return {
                type: 'uri',
                label: renderWithAttributes(b.label || '開啟連結', attributes).slice(0, 20),
                uri: renderWithAttributes(b.uri || 'https://google.com', attributes)
              }
            }
            if (b.type === 'module') {
              return {
                type: 'postback',
                label: renderWithAttributes(b.label || '觸發模組', attributes).slice(0, 20),
                data: `triggerModule=${b.moduleId}`
              }
            }
            return {
              type: 'message',
              label: renderWithAttributes(b.label || '點擊傳送', attributes).slice(0, 20),
              text: renderWithAttributes(b.text || b.label || '點擊傳送', attributes).slice(0, 300)
            }
          }),
        },
      } as messagingApi.TemplateMessage]
    }

    // ── Video ──
    if (msg.type === 'video') {
      if (!msg.originalContentUrl || !msg.previewImageUrl) return []
      return [{
        type: 'video',
        originalContentUrl: msg.originalContentUrl,
        previewImageUrl: msg.previewImageUrl,
      } as messagingApi.VideoMessage]
    }

    // ── Carousel ──
    if (msg.type === 'carousel') {
      const normalizeCarouselAction = (action: any) => {
        if (action?.type === 'uri') {
          return {
            type: 'uri',
            label: renderWithAttributes(action.label || '　', attributes).slice(0, 20),
            uri: renderWithAttributes(action.uri || 'https://google.com', attributes),
          }
        }
        if (action?.type === 'module') {
          return {
            type: 'postback',
            label: renderWithAttributes(action.label || '觸發模組', attributes).slice(0, 20),
            data: `triggerModule=${action.moduleId}`
          }
        }
        return {
          type: 'message',
          label: renderWithAttributes(action?.label || '　', attributes).slice(0, 20),
          text: renderWithAttributes(action?.text || action?.label || '　', attributes).slice(0, 300),
        }
      }

      const rawColumns = (msg.columns ?? []).map((col: any) => ({
        thumbnailImageUrl: col.thumbnailImageUrl || undefined,
        title: renderWithAttributes(col.title || '', attributes).slice(0, 80) || undefined,
        text: renderWithAttributes(col.text || '　', attributes).slice(0, 300),
        actions: (col.actions ?? []).slice(0, 3).map(normalizeCarouselAction),
      }))

      // LINE carousel requires every column to have the same action count (1~3).
      const targetActionCount = Math.max(1, ...rawColumns.map((col: any) => col.actions.length))
      const columns = rawColumns.map((col: any) => {
        const actions = [...col.actions]
        while (actions.length < targetActionCount) {
          actions.push({ type: 'message', label: '　', text: '　' })
        }
        return { ...col, actions }
      })
      if (!columns.length) return []
      return [{
        type: 'template',
        altText: renderWithAttributes(msg.altText || '輪播訊息', attributes).slice(0, 400),
        template: { type: 'carousel', columns },
      } as messagingApi.TemplateMessage]
    }

    // ── Image Carousel ──
    if (msg.type === 'imageCarousel') {
      const columns = (msg.columns ?? [])
        .filter((col: any) => col.imageUrl)
        .map((col: any) => {
          const actionType = col.action?.type
          let action: any
          if (actionType === 'uri') {
            action = {
              type: 'uri',
              label: renderWithAttributes(col.action.label || '開啟', attributes).slice(0, 20),
              uri: renderWithAttributes(col.action.uri || 'https://google.com', attributes)
            }
          } else if (actionType === 'module') {
            action = {
              type: 'postback',
              label: renderWithAttributes(col.action.label || '觸發模組', attributes).slice(0, 20),
              data: `triggerModule=${col.action.moduleId}`
            }
          } else if (actionType === 'message') {
            action = {
              type: 'message',
              label: renderWithAttributes(col.action.label || '傳送', attributes).slice(0, 20),
              text: renderWithAttributes(col.action.text || '', attributes).slice(0, 300)
            }
          } else {
            // LINE API requires an action for image_carousel. If 'none', use a silent postback without label.
            action = { type: 'postback', data: 'ignore' }
          }
          return { imageUrl: col.imageUrl, action }
        })
      if (!columns.length) return []
      return [{
        type: 'template',
        altText: renderWithAttributes(msg.altText || '圖片輪播', attributes).slice(0, 400),
        template: { type: 'image_carousel', columns },
      } as messagingApi.TemplateMessage]
    }

    // ── Quick Reply ──
    if (msg.type === 'quickReply') {
      const items = (msg.quickReplies || []).slice(0, 13).map((qr: any) => {
        let action: any
        const actionType = qr.action?.type
        if (actionType === 'uri') {
          action = {
            type: 'uri',
            label: renderWithAttributes(qr.action.label || '開啟', attributes).slice(0, 20),
            uri: renderWithAttributes(qr.action.uri || 'https://google.com', attributes)
          }
        } else if (actionType === 'module') {
          action = {
            type: 'postback',
            label: renderWithAttributes(qr.action.label || '觸發模組', attributes).slice(0, 20),
            data: `triggerModule=${qr.action.moduleId}`
          }
        } else {
          action = {
            type: 'message',
            label: renderWithAttributes(qr.action.label || '傳送', attributes).slice(0, 20),
            text: renderWithAttributes(qr.action.text || qr.action.label || '傳送', attributes).slice(0, 300)
          }
        }
        
        return {
          type: 'action',
          imageUrl: qr.imageUrl || undefined,
          action
        }
      })
      
      return [{
        type: 'text',
        text: renderWithAttributes(msg.text || '快速回覆', attributes).slice(0, 5000),
        quickReply: items.length > 0 ? { items } : undefined
      } as messagingApi.TextMessage]
    }

    // ── User Input ──
    if (msg.type === 'userInput') {
      return [{
        type: 'text',
        text: renderWithAttributes(msg.text || '請輸入內容：', attributes).slice(0, 5000)
      } as messagingApi.TextMessage]
    }

    if (msg.type === 'text') {
      return [{
        ...msg,
        text: renderWithAttributes(msg.text || '', attributes).slice(0, 5000)
      } as messagingApi.TextMessage]
    }

    // ── Default: plain text / image ──
    const { buttons, ...cleanMsg } = msg
    return [cleanMsg as messagingApi.Message]
  })
}


export async function handleMessageEvent(event: webhook.MessageEvent): Promise<void> {
  const userId = event.source?.userId
  if (!userId) return

  // Auto reply: match keyword flows
  if (event.message.type === 'text') {
    const textContent = (event.message as webhook.TextMessageContent).text
    
    // Check user activeInput state and fetch context synchronously
    const userData = await ensureUser(userId)
    const userAttributes = buildAttributeContext(userData)
    let handledByInput = false
    
    if (userData && userData.activeInput && userData.activeInput.expiresAt > Date.now()) {
      const { moduleId, attribute } = userData.activeInput
      const db = getDb()
      const updates: any = { activeInput: FieldValue.delete() }
      if (attribute) {
        updates[`attributes.${attribute}`] = textContent
        userAttributes[attribute] = textContent
      }
      await db.collection('users').doc(userId).update(updates)
      
      const cacheKey = `flow:${moduleId}`
      let flow = getCached(flowDocCache, cacheKey)
      if (!flow) {
        const modSnap = await db.collection('flows').doc(moduleId).get()
        if (modSnap.exists && modSnap.data()?.isActive) {
          flow = modSnap.data() as FlowDoc
          setCache(flowDocCache, cacheKey, flow)
        }
      }
      
      if (flow && event.replyToken) {
        await replyMessage(event.replyToken, buildLineMessages(flow.messages, userAttributes))
        await dispatchPostReplyActions(userId, flow.messages)
      }
      handledByInput = true
    }

    if (!handledByInput) {
      const flow = await matchFlow(textContent)
      if (flow && event.replyToken) {
        await replyMessage(event.replyToken, buildLineMessages(flow.messages, userAttributes))
        await dispatchPostReplyActions(userId, flow.messages)
      }
    }
  } else {
    // For non-text events, just ensure the user exists asynchronously if we want to log it
    ensureUser(userId).catch(e => console.error('[ensureUser] Error:', e))
  }
}

export async function handlePostbackEvent(event: webhook.PostbackEvent): Promise<void> {
  console.log('[handlePostbackEvent] event received:', JSON.stringify(event).slice(0, 300))
  const userId = event.source?.userId
  if (!userId) return

  // Fetch user synchronously if needed, but for postback usually background is fine unless updating state
  const userDataTask = ensureUser(userId).catch(e => {
    console.error('[ensureUser] Error:', e)
    return null
  })

  const data = event.postback.data

  // Handle Switch Menu command
  if (data.startsWith('switchMenu=')) {
    // 檢查是否為 LINE 原生瞬間切換（richmenuswitch）觸發的事件
    // @ts-ignore: LINE Node SDK's Event type might not perfectly reflect params yet
    const params = (event.postback as any).params
    const isRichMenuSwitch = params && params.newRichMenuAliasId

    if (isRichMenuSwitch) {
      // 若為瞬間切換，LINE App 端已自動更新選單完成，
      // 若伺服器再重複打一次 link API 反而會造成選單「閃屏重新載入」一次。
      // 所以此處直接 return 略過即可。
      console.log('[switchMenu] Handled by native richmenuswitch instantly, skipping redundant link API.')
      await userDataTask
      return
    }

    // 針對舊版 postback (沒有 aliasId) 的相容性回退處理
    const targetFirestoreId = data.replace('switchMenu=', '')
    console.log('[switchMenu] Fallback to server link API, targetId:', targetFirestoreId, 'userId:', userId)
    const db = getDb()
    const targetDoc = await db.collection('richmenus').doc(targetFirestoreId).get()
    
    if (targetDoc.exists && targetDoc.data()?.richMenuId) {
      const lineRichMenuId = targetDoc.data()!.richMenuId
      try {
        await linkRichMenuIdToUser(userId, lineRichMenuId)
        console.log('[switchMenu] Fallback linkRichMenuIdToUser success')
      } catch (e) {
        console.error('[webhook] Failed to link rich menu:', e)
      }
    } else {
      console.warn('[switchMenu] doc not found or missing richMenuId')
    }
    await userDataTask
    return // Stop further processing
  }
  // Handle direct module trigger
  if (data.startsWith('triggerModule=')) {
    const moduleId = data.replace('triggerModule=', '')
    const cacheKey = `flow:${moduleId}`
    
    let flow: FlowDoc | null = undefined
    const cachedFlow = getCached(flowDocCache, cacheKey)
    if (cachedFlow !== undefined) {
      flow = cachedFlow
    } else {
      const db = getDb()
      const modSnap = await db.collection('flows').doc(moduleId).get()
      if (modSnap.exists && modSnap.data()?.isActive) {
        flow = modSnap.data() as FlowDoc
      } else {
        flow = null
      }
      setCache(flowDocCache, cacheKey, flow)
    }

    if (flow) {
      if (event.replyToken) {
        const userAttributes = buildAttributeContext(await userDataTask)
        await replyMessage(event.replyToken, buildLineMessages(flow.messages, userAttributes))
        await dispatchPostReplyActions(userId, flow.messages)
      }
    } else {
      console.warn('[webhook] triggerModule target not found or inactive:', moduleId)
    }
    await userDataTask
    return
  }

  // Fallback: Match legacy postback data to an auto-reply keyword (if any)
  const flow = await matchFlow(data)
  if (flow && event.replyToken) {
    const userAttributes = buildAttributeContext(await userDataTask)
    await replyMessage(event.replyToken, buildLineMessages(flow.messages, userAttributes))
    await dispatchPostReplyActions(userId, flow.messages)
  }

  await userDataTask
}

