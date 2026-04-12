import type { webhook } from '@line/bot-sdk'
import type { messagingApi } from '@line/bot-sdk'
import { getDb } from './firebase'
import { replyMessage, getUserProfile, linkRichMenuIdToUser } from './line'
import { FieldValue } from 'firebase-admin/firestore'

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
}

async function matchFlow(trigger: string): Promise<FlowDoc | null> {
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
      return moduleSnap.data() as FlowDoc
    }
  }

  // Legacy fallback: direct trigger match on flows collection (backward compatibility)
  const legacySnap = await db
    .collection('flows')
    .where('triggers', 'array-contains', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (!legacySnap.empty) return legacySnap.docs[0].data() as FlowDoc

  const legacyStrSnap = await db
    .collection('flows')
    .where('trigger', '==', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (legacyStrSnap.empty) return null
  return legacyStrSnap.docs[0].data() as FlowDoc
}

// ── Main Event Handlers ───────────────────────────────────────────

function buildLineMessages(dbMessages: any[]): messagingApi.Message[] {
  if (!dbMessages) return []
  return dbMessages.map((msg) => {
    // Transform text with buttons to LINE's buttons template
    if (msg.type === 'text' && msg.buttons && msg.buttons.length > 0) {
      return {
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
      } as messagingApi.TemplateMessage
    }
    // Clean up internal keys before sending to LINE
    const { buttons, ...cleanMsg } = msg
    return cleanMsg as messagingApi.Message
  })
}

export async function handleMessageEvent(event: webhook.MessageEvent): Promise<void> {
  const userId = event.source?.userId
  if (!userId) return

  await ensureUser(userId)

  // Auto reply: match keyword flows
  if (event.message.type === 'text') {
    const textContent = (event.message as webhook.TextMessageContent).text
    const flow = await matchFlow(textContent)
    if (flow && event.replyToken) {
      await replyMessage(event.replyToken, buildLineMessages(flow.messages))
    }
  }
}

export async function handlePostbackEvent(event: webhook.PostbackEvent): Promise<void> {
  console.log('[handlePostbackEvent] event received:', JSON.stringify(event).slice(0, 300))
  const userId = event.source?.userId
  if (!userId) return

  await ensureUser(userId)

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
    return // Stop further processing
  }
  // Handle direct module trigger
  if (data.startsWith('triggerModule=')) {
    const moduleId = data.replace('triggerModule=', '')
    const db = getDb()
    const modSnap = await db.collection('flows').doc(moduleId).get()
    
    if (modSnap.exists && modSnap.data()?.isActive) {
      const flow = modSnap.data() as FlowDoc
      if (event.replyToken) {
        await replyMessage(event.replyToken, buildLineMessages(flow.messages))
      }
    } else {
      console.warn('[webhook] triggerModule target not found or inactive:', moduleId)
    }
    return
  }

  // Fallback: Match legacy postback data to an auto-reply keyword (if any)
  const flow = await matchFlow(data)
  if (flow && event.replyToken) {
    await replyMessage(event.replyToken, buildLineMessages(flow.messages))
  }
}

