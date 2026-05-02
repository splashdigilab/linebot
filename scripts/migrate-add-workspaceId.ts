/**
 * Migration: 為所有 Firestore 文件加上 workspaceId，並將 users collection 改為複合主鍵。
 *
 * 執行前：
 *   確認服務已停機（或無流量），避免寫入期間新資料沒有 workspaceId。
 *
 * 執行方式：
 *   node --env-file=.env --experimental-strip-types scripts/migrate-add-workspaceId.ts
 *
 * 可選 DRY_RUN=true 先預覽不實際寫入：
 *   DRY_RUN=true node --env-file=.env --experimental-strip-types scripts/migrate-add-workspaceId.ts
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// ── Init ─────────────────────────────────────────────────────────────

const serviceAccount: ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID!,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
}

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const DRY_RUN = process.env.DRY_RUN === 'true'
const WORKSPACE_ID = process.env.MIGRATE_WORKSPACE_ID || 'default'
const BATCH_SIZE = 400

// ── 需要加 workspaceId 的一般 collection（doc ID 不變）─────────────

const SIMPLE_COLLECTIONS = [
  'tags',
  'userTags',
  'tagLogs',
  'audiences',
  'broadcasts',
  'broadcastClickLogs',
  'flows',
  'autoReplies',
  'richMessages',
  'richmenus',
  'supportPresets',
  'conversationSessions',
  'conversationEvents',
  'leadCampaigns',
  'leadClaims',
]

async function backfillCollection(collectionName: string): Promise<number> {
  let total = 0
  let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null

  while (true) {
    let query = db.collection(collectionName)
      .where('workspaceId', '==', null)
      .limit(BATCH_SIZE) as FirebaseFirestore.Query

    // Firestore 不支援 'field does not exist' 直接查詢，
    // 改為全量掃描並在應用層過濾
    let fullQuery = db.collection(collectionName).limit(BATCH_SIZE) as FirebaseFirestore.Query
    if (lastDoc) fullQuery = fullQuery.startAfter(lastDoc)

    const snap = await fullQuery.get()
    if (snap.empty) break

    const toUpdate = snap.docs.filter(d => !d.data().workspaceId)

    if (toUpdate.length > 0) {
      const batch = db.batch()
      for (const doc of toUpdate) {
        batch.update(doc.ref, { workspaceId: WORKSPACE_ID })
      }
      if (!DRY_RUN) await batch.commit()
      total += toUpdate.length
      console.log(`  ${collectionName}: +${toUpdate.length} docs${DRY_RUN ? ' [DRY RUN]' : ''}`)
    }

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < BATCH_SIZE) break
  }

  return total
}

// ── users collection：doc ID 改為 `{workspaceId}_{lineUserId}` ───────

async function migrateUsers(): Promise<number> {
  let total = 0
  let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null

  while (true) {
    let query = db.collection('users').limit(BATCH_SIZE) as FirebaseFirestore.Query
    if (lastDoc) query = query.startAfter(lastDoc)

    const snap = await query.get()
    if (snap.empty) break

    const toMigrate = snap.docs.filter(d => !d.id.includes('_'))

    if (toMigrate.length > 0) {
      const batch = db.batch()
      for (const doc of toMigrate) {
        const lineUserId = doc.id
        const newDocId = `${WORKSPACE_ID}_${lineUserId}`
        const newRef = db.collection('users').doc(newDocId)
        batch.set(newRef, {
          ...doc.data(),
          workspaceId: WORKSPACE_ID,
          lineUserId,
        })
        batch.delete(doc.ref)
      }
      if (!DRY_RUN) await batch.commit()
      total += toMigrate.length
      console.log(`  users: migrated ${toMigrate.length} docs to composite key${DRY_RUN ? ' [DRY RUN]' : ''}`)
    }

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < BATCH_SIZE) break
  }

  return total
}

// ── conversations collection：doc ID 同 users，一併改 ────────────────

async function migrateConversations(): Promise<number> {
  let total = 0
  let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null

  while (true) {
    let query = db.collection('conversations').limit(BATCH_SIZE) as FirebaseFirestore.Query
    if (lastDoc) query = query.startAfter(lastDoc)

    const snap = await query.get()
    if (snap.empty) break

    const toMigrate = snap.docs.filter(d => !d.id.includes('_'))

    if (toMigrate.length > 0) {
      const batch = db.batch()
      for (const doc of toMigrate) {
        const lineUserId = doc.id
        const newDocId = `${WORKSPACE_ID}_${lineUserId}`
        const newRef = db.collection('conversations').doc(newDocId)
        batch.set(newRef, {
          ...doc.data(),
          workspaceId: WORKSPACE_ID,
          userId: lineUserId,
        })
        batch.delete(doc.ref)
      }
      if (!DRY_RUN) await batch.commit()
      total += toMigrate.length
      console.log(`  conversations: migrated ${toMigrate.length} docs${DRY_RUN ? ' [DRY RUN]' : ''}`)
    }

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < BATCH_SIZE) break
  }

  return total
}

// ── broadcasts sub-collection: deliveries ────────────────────────────
// deliveries 是 broadcasts/{id}/deliveries，workspaceId 從父層繼承，
// 這裡只補 workspaceId 欄位方便查詢。

async function migrateDeliveries(): Promise<number> {
  let total = 0
  const broadcastsSnap = await db.collection('broadcasts').limit(500).get()

  for (const broadcastDoc of broadcastsSnap.docs) {
    const workspaceId = broadcastDoc.data().workspaceId || WORKSPACE_ID
    let lastDeliveryDoc: FirebaseFirestore.DocumentSnapshot | null = null

    while (true) {
      let query = broadcastDoc.ref.collection('deliveries').limit(BATCH_SIZE) as FirebaseFirestore.Query
      if (lastDeliveryDoc) query = query.startAfter(lastDeliveryDoc)

      const snap = await query.get()
      if (snap.empty) break

      const toUpdate = snap.docs.filter(d => !d.data().workspaceId)
      if (toUpdate.length > 0) {
        const batch = db.batch()
        for (const d of toUpdate) batch.update(d.ref, { workspaceId })
        if (!DRY_RUN) await batch.commit()
        total += toUpdate.length
      }

      lastDeliveryDoc = snap.docs[snap.docs.length - 1]
      if (snap.docs.length < BATCH_SIZE) break
    }
  }

  if (total > 0) console.log(`  deliveries (sub): +${total} docs${DRY_RUN ? ' [DRY RUN]' : ''}`)
  return total
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Migration Start ===`)
  console.log(`Workspace ID: ${WORKSPACE_ID}`)
  console.log(`Dry run: ${DRY_RUN}\n`)

  let grandTotal = 0

  for (const col of SIMPLE_COLLECTIONS) {
    const count = await backfillCollection(col)
    grandTotal += count
  }

  grandTotal += await migrateUsers()
  grandTotal += await migrateConversations()
  grandTotal += await migrateDeliveries()

  console.log(`\n=== Done: ${grandTotal} docs updated ===\n`)
  process.exit(0)
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
