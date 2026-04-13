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

// Cache lifetime in milliseconds (e.g., 30 seconds to allow fast updates but cache burst traffic)
const CACHE_TTL_MS = 30 * 1000

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
}

// ── Helpers ───────────────────────────────────────────────────────

async function ensureUser(userId: string): Promise<void> {
  if (userCheckedCache.has(userId)) return

  const db = getDb()
  const ref = db.collection('users').doc(userId)
  const snap = await ref.get()
  
  if (!snap.exists) {
    const profile = await getUserProfile(userId)
    await ref.set({
      displayName: profile?.displayName ?? userId,
      pictureUrl: profile?.pictureUrl ?? '',
      createdAt: FieldValue.serverTimestamp(),
    } satisfies UserDoc)
  }
  // Record that we've checked this user, so we don't query Firestore again in this instance
  userCheckedCache.add(userId)
}

async function matchFlow(trigger: string): Promise<FlowDoc | null> {
  const cacheKey = `trigger:${trigger}`
  const cachedFlow = getCached(flowDocCache, cacheKey)
  if (cachedFlow !== undefined) return cachedFlow

  const db = getDb()

  // Step 1: Look in autoReplies collection for a matching keyword
  const autoReplySnap = await db
    .collection('autoReplies')
    .where('keyword', '==', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()

  if (!autoReplySnap.empty) {
    const rule = autoReplySnap.docs[0].data()
    const moduleSnap = await db.collection('flows').doc(rule.moduleId).get()
    if (moduleSnap.exists && moduleSnap.data()?.isActive) {
      const result = moduleSnap.data() as FlowDoc
      setCache(flowDocCache, cacheKey, result)
      return result
    }
  }

  // Legacy fallback: direct trigger match on flows collection (backward compatibility)
  const legacySnap = await db
    .collection('flows')
    .where('triggers', 'array-contains', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (!legacySnap.empty) {
    const result = legacySnap.docs[0].data() as FlowDoc
    setCache(flowDocCache, cacheKey, result)
    return result
  }

  const legacyStrSnap = await db
    .collection('flows')
    .where('trigger', '==', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (legacyStrSnap.empty) {
    setCache(flowDocCache, cacheKey, null)
    return null
  }
  const result = legacyStrSnap.docs[0].data() as FlowDoc
  setCache(flowDocCache, cacheKey, result)
  return result
}

// ── Main Event Handlers ───────────────────────────────────────────

function buildLineMessages(dbMessages: any[]): messagingApi.Message[] {
  if (!dbMessages) return []
  return dbMessages.flatMap((msg) => {
    // ── Text with buttons → Buttons Template ──
    if (msg.type === 'text' && msg.buttons && msg.buttons.length > 0) {
      return [{
        type: 'template',
        altText: msg.text.slice(0, 400),
        template: {
          type: 'buttons',
          text: (msg.text || '無內容').slice(0, 160),
          actions: msg.buttons.slice(0, 4).map((b: any) => {
            if (b.type === 'uri') {
              return { type: 'uri', label: (b.label || '開啟連結').slice(0, 20), uri: b.uri || 'https://google.com' }
            }
            return { type: 'message', label: (b.label || '點擊傳送').slice(0, 20), text: (b.text || b.label || '點擊傳送').slice(0, 300) }
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
            label: (action.label || '　').slice(0, 20),
            uri: action.uri || 'https://google.com',
          }
        }
        return {
          type: 'message',
          label: (action?.label || '　').slice(0, 20),
          text: (action?.text || action?.label || '　').slice(0, 300),
        }
      }

      const rawColumns = (msg.columns ?? []).map((col: any) => ({
        thumbnailImageUrl: col.thumbnailImageUrl || undefined,
        title: (col.title || '').slice(0, 80) || undefined,
        text: (col.text || '　').slice(0, 300),
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
        altText: (msg.altText || '輪播訊息').slice(0, 400),
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
            action = { type: 'uri', label: (col.action.label || '開啟').slice(0, 20), uri: col.action.uri || 'https://google.com' }
          } else if (actionType === 'message') {
            action = { type: 'message', label: (col.action.label || '傳送').slice(0, 20), text: (col.action.text || '').slice(0, 300) }
          } else {
            // LINE API requires an action for image_carousel. If 'none', use a silent postback.
            action = { type: 'postback', label: ' ', data: 'ignore' }
          }
          return { imageUrl: col.imageUrl, action }
        })
      if (!columns.length) return []
      return [{
        type: 'template',
        altText: (msg.altText || '圖片輪播').slice(0, 400),
        template: { type: 'image_carousel', columns },
      } as messagingApi.TemplateMessage]
    }

    // ── Default: plain text / image ──
    const { buttons, ...cleanMsg } = msg
    return [cleanMsg as messagingApi.Message]
  })
}


export async function handleMessageEvent(event: webhook.MessageEvent): Promise<void> {
  const userId = event.source?.userId
  if (!userId) return

  // Run ensureUser concurrently so we don't block the reply process
  const ensureUserTask = ensureUser(userId).catch(e => console.error('[ensureUser] Error:', e))

  // Auto reply: match keyword flows
  if (event.message.type === 'text') {
    const textContent = (event.message as webhook.TextMessageContent).text
    const flow = await matchFlow(textContent)
    if (flow && event.replyToken) {
      await replyMessage(event.replyToken, buildLineMessages(flow.messages))
    }
  }

  // Await the background task before returning
  await ensureUserTask
}

export async function handlePostbackEvent(event: webhook.PostbackEvent): Promise<void> {
  console.log('[handlePostbackEvent] event received:', JSON.stringify(event).slice(0, 300))
  const userId = event.source?.userId
  if (!userId) return

  // Run ensureUser concurrently so we don't block the reply process
  const ensureUserTask = ensureUser(userId).catch(e => console.error('[ensureUser] Error:', e))

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
      await ensureUserTask
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
    await ensureUserTask
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
        await replyMessage(event.replyToken, buildLineMessages(flow.messages))
      }
    } else {
      console.warn('[webhook] triggerModule target not found or inactive:', moduleId)
    }
    await ensureUserTask
    return
  }

  // Fallback: Match legacy postback data to an auto-reply keyword (if any)
  const flow = await matchFlow(data)
  if (flow && event.replyToken) {
    await replyMessage(event.replyToken, buildLineMessages(flow.messages))
  }

  await ensureUserTask
}

