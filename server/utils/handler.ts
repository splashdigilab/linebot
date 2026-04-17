import type { webhook } from '@line/bot-sdk'
import type { messagingApi } from '@line/bot-sdk'
import { getDb } from './firebase'
import { replyMessage, getUserProfile, linkRichMenuIdToUser } from './line'
import { FieldValue } from 'firebase-admin/firestore'
import { decodeTriggerModule, encodeTriggerModule } from '~~/shared/action-schema'
import {
  matchAutoReplyText,
  normalizeAutoReplyRule,
  type AutoReplyRuleShape,
} from '~~/shared/auto-reply-rule'
import { RICH_LAYOUT_PRESETS } from '~~/shared/rich-layout-presets'
import { normalizeRichMessageActions } from '~~/shared/rich-message-editor-helpers'
import { createImagemapImageToken } from './line-imagemap-image-token'

// ── In-Memory Caching to Reduce DB Latency ──────────────────────────
const userCheckedCache = new Set<string>()

interface CacheEntry<T> {
  data: T
  expires: number
}
const flowDocCache = new Map<string, CacheEntry<FlowDoc | null>>()
const richMessageCache = new Map<string, CacheEntry<any | null>>()
const autoReplyRuleCache = new Map<string, CacheEntry<AutoReplyRuleShape[]>>()

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
  isBlocked?: boolean
  blockedAt?: FirebaseFirestore.FieldValue | null
  unblockedAt?: FirebaseFirestore.FieldValue | null
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
      isBlocked: false,
    }
    await ref.set(newDoc)
    return newDoc
  }

  const data = snap.data() as UserDoc
  if (data.isBlocked) {
    await ref.update({ isBlocked: false, unblockedAt: FieldValue.serverTimestamp() })
  }
  return data
}

export async function handleFollowEvent(userId: string): Promise<void> {
  try {
    await ensureUser(userId)
    console.log('[webhook] follow ensureUser:', userId)
  }
  catch (e) {
    console.error('[webhook] handleFollowEvent error:', e)
  }
}

export async function handleUnfollowEvent(userId: string): Promise<void> {
  try {
    const db = getDb()
    const ref = db.collection('users').doc(userId)
    const snap = await ref.get()
    if (snap.exists) {
      await ref.update({ isBlocked: true, blockedAt: FieldValue.serverTimestamp() })
    }
    console.log('[webhook] unfollow/block marked:', userId)
  }
  catch (e) {
    console.error('[webhook] handleUnfollowEvent error:', e)
  }
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

async function getFlowByModuleId(moduleId: string): Promise<FlowDoc | null> {
  const id = String(moduleId || '').trim()
  if (!id) return null
  const cacheKey = `flow:${id}`
  const cached = getCached(flowDocCache, cacheKey)
  if (cached !== undefined) return cached

  const db = getDb()
  const snap = await db.collection('flows').doc(id).get()
  const flow = (snap.exists && snap.data()?.isActive) ? (snap.data() as FlowDoc) : null
  setCache(flowDocCache, cacheKey, flow)
  return flow
}

async function loadActiveAutoReplyRules(): Promise<AutoReplyRuleShape[]> {
  const cacheKey = 'active:autoReplies'
  const cached = getCached(autoReplyRuleCache, cacheKey)
  if (cached !== undefined) return cached

  const db = getDb()
  const snap = await db.collection('autoReplies')
    .where('isActive', '==', true)
    .orderBy('createdAt', 'desc')
    .get()

  const rules = snap.docs
    .map((doc) => normalizeAutoReplyRule({ id: doc.id, ...doc.data() }))
    .filter((rule) => rule.isActive)
  setCache(autoReplyRuleCache, cacheKey, rules)
  return rules
}

async function matchAutoReplyRule(
  inputText: string,
  options: { allowAnyText: boolean } = { allowAnyText: true },
): Promise<AutoReplyRuleShape | null> {
  const rules = await loadActiveAutoReplyRules()
  for (const rule of rules) {
    if (!options.allowAnyText && rule.matchType === 'anyText') continue
    if (matchAutoReplyText(rule, inputText)) return rule
  }
  return null
}

function buildAutoReplyActionMessages(
  action: AutoReplyRuleShape['action'],
  attributes: Record<string, string>,
): messagingApi.Message[] {
  if (action.type === 'message') {
    return [{
      type: 'text',
      text: renderWithAttributes(action.text || '', attributes).slice(0, 5000),
    } as messagingApi.TextMessage]
  }

  if (action.type === 'uri') {
    const targetUrl = renderWithAttributes(action.uri || '', attributes)
    return [{
      type: 'template',
      altText: '開啟網址',
      template: {
        type: 'buttons',
        text: '請點擊下方連結',
        actions: [{
          type: 'uri',
          label: '開啟網址',
          uri: targetUrl,
        }],
      },
    } as messagingApi.TemplateMessage]
  }

  return []
}

function buildRichMessageSnapshot(item: any) {
  const actions = Array.isArray(item?.actions)
    ? item.actions
    : Array.isArray(item?.buttons)
      ? item.buttons
      : []
  return {
    layoutId: item?.layoutId || 'custom',
    transparentBackground: Boolean(item?.transparentBackground),
    altText: item?.altText || '',
    heroImageUrl: item?.heroImageUrl || '',
    actions: actions.map((action: any, index: number) => ({
      slot: action?.slot || String.fromCharCode(65 + index),
      type: action?.type === 'message' || action?.type === 'module' ? action.type : 'uri',
      uri: action?.uri || '',
      text: action?.text || '',
      moduleId: action?.moduleId || '',
      ...(action?.bounds && typeof action.bounds === 'object' ? { bounds: action.bounds } : {}),
    })),
  }
}

async function loadRichMessageSnapshot(id: string): Promise<any | null> {
  if (!id) return null
  const cacheKey = `richMessage:${id}`
  const cached = getCached(richMessageCache, cacheKey)
  if (cached !== undefined) return cached

  const db = getDb()
  const snap = await db.collection('richMessages').doc(id).get()
  if (!snap.exists) {
    setCache(richMessageCache, cacheKey, null)
    return null
  }
  const payload = buildRichMessageSnapshot(snap.data())
  setCache(richMessageCache, cacheKey, payload)
  return payload
}

async function hydrateRichMessageRefs(messages: any[]): Promise<any[]> {
  if (!Array.isArray(messages) || messages.length === 0) return []
  const hydrated = [...messages]
  const ids = Array.from(new Set(hydrated
    .filter((msg: any) => msg?.type === 'richMessageRef' && msg?.richMessageId)
    .map((msg: any) => String(msg.richMessageId))))
  if (ids.length === 0) return hydrated

  const snapshots = await Promise.all(ids.map((id) => loadRichMessageSnapshot(id)))
  const snapshotMap = new Map<string, any | null>()
  ids.forEach((id, index) => snapshotMap.set(id, snapshots[index] ?? null))

  return hydrated.map((msg: any) => {
    if (msg?.type !== 'richMessageRef') return msg
    const latest = msg?.richMessageId ? snapshotMap.get(String(msg.richMessageId)) : null
    if (latest) return { ...msg, payload: latest }
    return msg
  })
}

const RICH_MESSAGE_LINE_CANVAS = 1040

function resolveRichMessageLayoutId(raw: unknown): string {
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : 'single'
  return RICH_LAYOUT_PRESETS.some((p) => p.id === id) ? id : 'single'
}

function normalizePublicBase(raw: string): string {
  const cleaned = String(raw || '').trim().replace(/\/$/, '')
  if (!cleaned) return ''
  if (!/^https?:\/\//i.test(cleaned)) return ''
  return cleaned
}

function resolveLineImagemapPublicBase(fallbackOrigin = ''): string {
  try {
    const c = useRuntimeConfig()
    const configured = normalizePublicBase(String((c as { lineImagemapBaseUrl?: string }).lineImagemapBaseUrl || ''))
    if (configured) return configured
  }
  catch {
    /* useRuntimeConfig 在非 Nitro 內容下可能不可用 */
  }

  const envCandidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.LINE_IMAGEMAP_BASE_URL,
    process.env.CLICK_TRACKING_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.SITE_URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.URL,
  ]
  for (const value of envCandidates) {
    const normalized = normalizePublicBase(String(value || ''))
    if (normalized) return normalized
  }

  return normalizePublicBase(fallbackOrigin)
}

function clampImagemapArea(bounds: { x: number; y: number; width: number; height: number }) {
  const max = RICH_MESSAGE_LINE_CANVAS
  const x = Math.max(0, Math.min(max, Math.floor(Number(bounds.x) || 0)))
  const y = Math.max(0, Math.min(max, Math.floor(Number(bounds.y) || 0)))
  const w = Math.max(1, Math.min(max - x, Math.floor(Number(bounds.width) || 0)))
  const h = Math.max(1, Math.min(max - y, Math.floor(Number(bounds.height) || 0)))
  return { x, y, width: w, height: h }
}

/**
 * 圖文訊息：預設 Flex（可 postback 觸發模組）。
 * 「保留 PNG 透明」且僅 uri/message 區塊時改送 Imagemap（全螢幕預覽也較能維持透明）；需設定 lineImagemapBaseUrl。
 * 若有「觸發模組」區塊則只能用 Flex，底圖需為 image 設透明底色才不易出現白底。
 */
function buildRichMessageLineMessage(input: {
  altText: string
  heroImageUrl: string
  layoutId: unknown
  actions: any[]
  attributes: Record<string, string>
  transparentBackground: boolean
  publicBaseOverride?: string
}): messagingApi.Message {
  const layoutId = resolveRichMessageLayoutId(input.layoutId)
  const normalized = normalizeRichMessageActions(layoutId, input.actions)
  const hasModule = normalized.some((a: any) => a?.type === 'module')
  const publicBase = resolveLineImagemapPublicBase(input.publicBaseOverride || '')
  let channelSecret = ''
  try {
    channelSecret = String(useRuntimeConfig().lineChannelSecret || '')
  }
  catch {
    channelSecret = String(process.env.LINE_CHANNEL_SECRET || '')
  }

  const tryImagemap =
    Boolean(input.transparentBackground)
    && !hasModule
    && Boolean(publicBase && channelSecret)
    && normalized.some((a: any) => a?.type)

  if (tryImagemap) {
    const renderedUrl = renderWithAttributes(input.heroImageUrl, input.attributes)
    const token = createImagemapImageToken(renderedUrl, channelSecret)
    const baseUrl = `${publicBase}/api/line-imagemap-img/${encodeURIComponent(token)}`
    if (baseUrl.length <= 1900) {
      const actions = normalized
        .filter((a: any) => a?.type === 'uri' || a?.type === 'message')
        .map((a: any) => {
          const b = a.bounds
          if (!b) return null
          const area = clampImagemapArea(b)
          if (a.type === 'uri') {
            return {
              type: 'uri',
              linkUri: renderWithAttributes(a.uri || 'https://google.com', input.attributes),
              area,
            }
          }
          return {
            type: 'message',
            text: renderWithAttributes(a.text || a.slot || ' ', input.attributes).slice(0, 300),
            area,
          }
        })
        .filter(Boolean)

      if (actions.length > 0) {
        return {
          type: 'imagemap',
          baseUrl,
          altText: renderWithAttributes(input.altText, input.attributes).slice(0, 400),
          baseSize: { width: RICH_MESSAGE_LINE_CANVAS, height: RICH_MESSAGE_LINE_CANVAS },
          actions,
        } as messagingApi.Message
      }
    }
  }

  return buildRichMessageFlexMessage({
    altText: input.altText,
    heroImageUrl: input.heroImageUrl,
    layoutId: input.layoutId,
    actions: input.actions,
    attributes: input.attributes,
    transparentBackground: input.transparentBackground,
  })
}

/** Flex：底圖 + 依編輯器座標疊透明點擊區（類似圖文選單），可保留 postback 觸發模組 */
function buildRichMessageFlexMessage(input: {
  altText: string
  heroImageUrl: string
  layoutId: unknown
  actions: any[]
  attributes: Record<string, string>
  transparentBackground?: boolean
}): messagingApi.FlexMessage {
  const layoutId = resolveRichMessageLayoutId(input.layoutId)
  const normalized = normalizeRichMessageActions(layoutId, input.actions)
  const imageUrl = renderWithAttributes(input.heroImageUrl, input.attributes)
  const c = RICH_MESSAGE_LINE_CANVAS
  const pct = (px: number) => `${(px / c) * 100}%`
  const transparent = Boolean(input.transparentBackground)

  const overlayBoxes = normalized
    .filter((action: any) => action?.type)
    .map((action: any) => {
      const b = action.bounds
      if (!b) return null
      let flexAction: Record<string, unknown>
      if (action.type === 'uri') {
        flexAction = {
          type: 'uri',
          label: ' ',
          uri: renderWithAttributes(action.uri || 'https://google.com', input.attributes),
        }
      }
      else if (action.type === 'module') {
        flexAction = {
          type: 'postback',
          label: ' ',
          data: encodeTriggerModule(action.moduleId || ''),
        }
      }
      else {
        flexAction = {
          type: 'message',
          label: ' ',
          text: renderWithAttributes(action.text || action.slot || ' ', input.attributes).slice(0, 300),
        }
      }
      return {
        type: 'box',
        layout: 'vertical',
        position: 'absolute',
        offsetTop: pct(b.y),
        offsetStart: pct(b.x),
        width: pct(b.width),
        height: pct(b.height),
        action: flexAction,
        ...(transparent ? { backgroundColor: '#00000000' } : {}),
        contents: [{ type: 'filler', flex: 1 }],
      }
    })
    .filter(Boolean)

  const bodyBox: Record<string, unknown> = {
    type: 'box',
    layout: 'vertical',
    position: 'relative',
    paddingAll: '0px',
    ...(transparent ? { backgroundColor: '#00000000' } : {}),
    contents: [
      {
        type: 'image',
        url: imageUrl,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover',
        gravity: 'center',
        // Flex 圖片預設會在 PNG 透明處疊白底；設為全透明才會透出聊天室背景（與 Imagemap 行為較接近）
        ...(transparent ? { backgroundColor: '#00000000' } : {}),
      },
      ...overlayBoxes,
    ],
  }

  return {
    type: 'flex',
    altText: renderWithAttributes(input.altText, input.attributes).slice(0, 400),
    contents: {
      type: 'bubble',
      ...(transparent
        ? {
            styles: {
              body: { backgroundColor: '#00000000' },
            },
          }
        : {}),
      body: bodyBox,
    },
  } as messagingApi.FlexMessage
}

// ── Main Event Handlers ───────────────────────────────────────────

function buildLineMessages(
  dbMessages: any[],
  attributes: Record<string, string> = {},
  publicBaseOverride = '',
): messagingApi.Message[] {
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
                data: encodeTriggerModule(b.moduleId)
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
            data: encodeTriggerModule(action.moduleId)
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
              data: encodeTriggerModule(col.action.moduleId)
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

    // ── Rich Message Inline（底圖 + 疊在圖上的點擊區，類似圖文選單）──
    if (msg.type === 'richMessage') {
      if (!msg.altText) return []
      if (!msg.heroImageUrl) return []
      const actions = Array.isArray(msg.actions) ? msg.actions : []
      return [
        buildRichMessageLineMessage({
          altText: msg.altText,
          heroImageUrl: msg.heroImageUrl,
          layoutId: msg.layoutId,
          actions,
          attributes,
          transparentBackground: Boolean(msg.transparentBackground),
          publicBaseOverride,
        }),
      ]
    }

    // ── Rich Message Reference（同上）──
    if (msg.type === 'richMessageRef') {
      const payload = msg.payload
      if (!payload?.altText) return []
      if (!payload?.heroImageUrl) return []
      const actions = Array.isArray(payload?.actions)
        ? payload.actions
        : Array.isArray(payload?.buttons)
          ? payload.buttons.map((btn: any, index: number) => ({
              slot: String.fromCharCode(65 + index),
              type: btn?.type === 'message' || btn?.type === 'module' ? btn.type : 'uri',
              uri: btn?.uri || '',
              text: btn?.text || '',
              moduleId: btn?.moduleId || '',
            }))
          : []
      return [
        buildRichMessageLineMessage({
          altText: payload.altText,
          heroImageUrl: payload.heroImageUrl,
          layoutId: payload.layoutId,
          actions,
          attributes,
          transparentBackground: Boolean(payload.transparentBackground),
          publicBaseOverride,
        }),
      ]
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
            data: encodeTriggerModule(qr.action.moduleId)
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


export async function handleMessageEvent(
  event: webhook.MessageEvent,
  options: { requestOrigin?: string } = {},
): Promise<void> {
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
      
      const flow = await getFlowByModuleId(moduleId)
      
      if (flow && event.replyToken) {
        const hydratedMessages = await hydrateRichMessageRefs(flow.messages as any[])
        await replyMessage(
          event.replyToken,
          buildLineMessages(hydratedMessages, userAttributes, options.requestOrigin || ''),
        )
        await dispatchPostReplyActions(userId, flow.messages)
      }
      handledByInput = true
    }

    if (!handledByInput) {
      const rule = await matchAutoReplyRule(textContent)
      if (rule && event.replyToken) {
        if (rule.action.type === 'module') {
          const flow = await getFlowByModuleId(rule.action.moduleId)
          if (flow) {
            const hydratedMessages = await hydrateRichMessageRefs(flow.messages as any[])
            await replyMessage(
              event.replyToken,
              buildLineMessages(hydratedMessages, userAttributes, options.requestOrigin || ''),
            )
            await dispatchPostReplyActions(userId, flow.messages)
          }
        } else {
          const actionMessages = buildAutoReplyActionMessages(rule.action, userAttributes)
          if (actionMessages.length > 0) {
            await replyMessage(event.replyToken, actionMessages)
          }
        }
      }
    }
  } else {
    // For non-text events, just ensure the user exists asynchronously if we want to log it
    ensureUser(userId).catch(e => console.error('[ensureUser] Error:', e))
  }
}

export async function handlePostbackEvent(
  event: webhook.PostbackEvent,
  options: { requestOrigin?: string } = {},
): Promise<void> {
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
  const directModuleId = decodeTriggerModule(data)
  if (directModuleId) {
    const moduleId = directModuleId
    const flow = await getFlowByModuleId(moduleId)

    if (flow) {
      if (event.replyToken) {
        const userAttributes = buildAttributeContext(await userDataTask)
        const hydratedMessages = await hydrateRichMessageRefs(flow.messages as any[])
        await replyMessage(
          event.replyToken,
          buildLineMessages(hydratedMessages, userAttributes, options.requestOrigin || ''),
        )
        await dispatchPostReplyActions(userId, flow.messages)
      }
    } else {
      console.warn('[webhook] triggerModule target not found or inactive:', moduleId)
    }
    await userDataTask
    return
  }

  // Fallback: Match legacy postback data to an auto-reply keyword (if any)
  const rule = await matchAutoReplyRule(data, { allowAnyText: false })
  if (rule && event.replyToken) {
    const userAttributes = buildAttributeContext(await userDataTask)
    if (rule.action.type === 'module') {
      const flow = await getFlowByModuleId(rule.action.moduleId)
      if (flow) {
        const hydratedMessages = await hydrateRichMessageRefs(flow.messages as any[])
        await replyMessage(
          event.replyToken,
          buildLineMessages(hydratedMessages, userAttributes, options.requestOrigin || ''),
        )
        await dispatchPostReplyActions(userId, flow.messages)
      }
    } else {
      const actionMessages = buildAutoReplyActionMessages(rule.action, userAttributes)
      if (actionMessages.length > 0) {
        await replyMessage(event.replyToken, actionMessages)
      }
    }
  }

  await userDataTask
}

