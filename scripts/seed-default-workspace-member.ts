/**
 * Seed：將指定 Firebase uid 設為 default workspace 的 owner。
 * 同時建立 organizations/default 作為預設組織。
 *
 * 執行方式：
 *   MEMBER_UID=<你的Firebase uid> node --env-file=.env --experimental-strip-types scripts/seed-default-workspace-member.ts
 *
 * 在 Firebase Console > Authentication 可找到你的 uid。
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const serviceAccount: ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID!,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
}

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const WORKSPACE_ID = process.env.MIGRATE_WORKSPACE_ID || 'default'
const UID = process.env.MEMBER_UID

async function main() {
  if (!UID) {
    console.error('Error: MEMBER_UID env var is required.')
    console.error('Usage: MEMBER_UID=<uid> node --env-file=.env --experimental-strip-types scripts/seed-default-workspace-member.ts')
    process.exit(1)
  }

  // 1. 建立 organizations/default
  const orgRef = db.collection('organizations').doc(WORKSPACE_ID)
  const orgSnap = await orgRef.get()
  if (!orgSnap.exists) {
    await orgRef.set({
      name: 'Default Organization',
      plan: 'free',
      ownerId: UID,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`✓ Created organizations/${WORKSPACE_ID}`)
  } else {
    console.log(`  organizations/${WORKSPACE_ID} already exists, skipped.`)
  }

  // 2. 更新 workspaces/default 的 organizationId
  await db.collection('workspaces').doc(WORKSPACE_ID).set(
    { organizationId: WORKSPACE_ID },
    { merge: true },
  )
  console.log(`✓ Updated workspaces/${WORKSPACE_ID}.organizationId`)

  // 3. 建立 workspaceMembers/{uid}_{workspaceId}
  const memberDocId = `${UID}_${WORKSPACE_ID}`
  const memberRef = db.collection('workspaceMembers').doc(memberDocId)
  const memberSnap = await memberRef.get()
  if (!memberSnap.exists) {
    await memberRef.set({
      uid: UID,
      workspaceId: WORKSPACE_ID,
      organizationId: WORKSPACE_ID,
      role: 'owner',
      invitedBy: null,
      invitedEmail: null,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
    console.log(`✓ Created workspaceMembers/${memberDocId} (role: owner)`)
  } else {
    console.log(`  workspaceMembers/${memberDocId} already exists, skipped.`)
  }

  console.log('\nDone.')
  process.exit(0)
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
