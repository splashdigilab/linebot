import { getFirebaseAdmin, getDb } from '../utils/firebase'
import { getLineWorkspaceCredentials } from '../utils/line-workspace-credentials'

/**
 * Eagerly initialize Firebase and warm up critical caches at server startup.
 *
 * Without this, the first webhook after a server restart triggers gRPC connection
 * establishment (~1-3s) + Firestore auth handshake on top of normal processing.
 * By running these at startup, the first real user request already has a warm connection.
 */
export default defineNitroPlugin(async () => {
  try {
    // 1. Establish gRPC channel and authenticate with Firestore
    const db = getDb()
    // Trigger an actual Firestore round-trip so the gRPC channel is fully negotiated
    await db.collection('workspaces').doc('default').get()
    console.log('[warmup] Firestore connection ready')

    // 2. Cache LINE workspace credentials (channelAccessToken, channelSecret)
    await getLineWorkspaceCredentials()
    console.log('[warmup] LINE credentials cached')
  }
  catch (e) {
    // Non-fatal: warmup failure should never block the server from starting
    console.warn('[warmup] startup warmup failed (non-fatal):', e)
  }
})
