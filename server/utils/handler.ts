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
  // New format: triggers is an array
  const snap = await db
    .collection('flows')
    .where('triggers', 'array-contains', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (!snap.empty) return snap.docs[0].data() as FlowDoc

  // Legacy fallback: single trigger string
  const legacySnap = await db
    .collection('flows')
    .where('trigger', '==', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (legacySnap.empty) return null
  return legacySnap.docs[0].data() as FlowDoc
}

// ── Main Event Handlers ───────────────────────────────────────────

export async function handleMessageEvent(event: webhook.MessageEvent): Promise<void> {
  const userId = event.source?.userId
  if (!userId) return

  await ensureUser(userId)

  // Auto reply: match keyword flows
  if (event.message.type === 'text') {
    const textContent = (event.message as webhook.TextMessageContent).text
    const flow = await matchFlow(textContent)
    if (flow && event.replyToken) {
      await replyMessage(event.replyToken, flow.messages)
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
    const targetFirestoreId = data.replace('switchMenu=', '')
    console.log('[switchMenu] triggered, targetId:', targetFirestoreId, 'userId:', userId)
    const db = getDb()
    const targetDoc = await db.collection('richmenus').doc(targetFirestoreId).get()
    console.log('[switchMenu] doc exists:', targetDoc.exists, 'richMenuId:', targetDoc.data()?.richMenuId)
    
    if (targetDoc.exists && targetDoc.data()?.richMenuId) {
      const lineRichMenuId = targetDoc.data()!.richMenuId
      try {
        const result = await linkRichMenuIdToUser(userId, lineRichMenuId)
        console.log('[switchMenu] linkRichMenuIdToUser success:', result)
      } catch (e) {
        console.error('[webhook] Failed to link rich menu:', e)
      }
    } else {
      console.warn('[switchMenu] doc not found or missing richMenuId')
    }
    return // Stop further processing
  }

  // Match postback data to a flow
  const flow = await matchFlow(data)
  if (flow && event.replyToken) {
    await replyMessage(event.replyToken, flow.messages)
  }
}
