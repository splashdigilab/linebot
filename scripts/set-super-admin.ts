/**
 * 為 Firebase Auth 使用者設定 custom claim `superAdmin: true`（與 server/utils/workspace-auth 一致）。
 *
 * 執行：
 *   node --env-file=.env --experimental-strip-types scripts/set-super-admin.ts <uid>
 *
 * 撤銷（移除該 claim）：
 *   node --env-file=.env --experimental-strip-types scripts/set-super-admin.ts <uid> --revoke
 *
 * 或使用 npm：
 *   npm run set-super-admin -- <uid>
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const uid = process.argv[2]?.trim()
const revoke = process.argv.includes('--revoke')

if (!uid) {
  console.error('用法: node --env-file=.env --experimental-strip-types scripts/set-super-admin.ts <uid> [--revoke]')
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!projectId || !clientEmail || !privateKey) {
  console.error('缺少環境變數：FIREBASE_PROJECT_ID、FIREBASE_CLIENT_EMAIL、FIREBASE_PRIVATE_KEY')
  process.exit(1)
}

const serviceAccount: ServiceAccount = {
  projectId,
  clientEmail,
  privateKey: privateKey.replace(/\\n/g, '\n'),
}

initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()

if (revoke) {
  await auth.setCustomUserClaims(uid, { superAdmin: null } as Parameters<typeof auth.setCustomUserClaims>[1])
  console.log(`已撤銷 UID ${uid} 的 superAdmin claim。請使用者重新登入。`)
}
else {
  await auth.setCustomUserClaims(uid, { superAdmin: true })
  console.log(`已為 UID ${uid} 設定 superAdmin: true。請重新登入後台以取得新 ID Token。`)
}
