import { getFirebaseAdmin, getDb } from '../utils/firebase'

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
    await db.listCollections()
    console.log('[warmup] Firestore connection ready')
  }
  catch (e) {
    // Non-fatal: warmup failure should never block the server from starting
    console.warn('[warmup] startup warmup failed (non-fatal):', e)
  }
})
