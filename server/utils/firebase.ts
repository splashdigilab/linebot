import { initializeApp, cert } from 'firebase-admin/app'
import type { App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore, CollectionReference, Query, UpdateData } from 'firebase-admin/firestore'
import { getStorage as getAdminStorage } from 'firebase-admin/storage'

let app: App

export function getFirebaseAdmin(): App {
  if (!app) {
    const config = useRuntimeConfig()

    app = initializeApp({
      credential: cert({
        projectId: config.firebaseProjectId,
        clientEmail: config.firebaseClientEmail,
        privateKey: config.firebasePrivateKey.replace(/\\n/g, '\n'),
      }),
      storageBucket: config.firebaseStorageBucket,
    })
  }
  return app
}

export function getDb(): Firestore {
  // Ensure app is initialized
  getFirebaseAdmin()
  return getFirestore()
}

export function getStorage() {
  getFirebaseAdmin()
  return getAdminStorage()
}

// ── Generic CRUD helpers ──────────────────────────────────────────

export async function getDoc<T>(
  collection: string,
  id: string,
): Promise<(T & { id: string }) | null> {
  const db = getDb()
  const snap = await db.collection(collection).doc(id).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as T) }
}

export async function listDocs<T>(
  collection: string,
  queryFn?: (ref: CollectionReference) => Query,

): Promise<(T & { id: string })[]> {
  const db = getDb()
  const ref = db.collection(collection)
  const query = queryFn ? queryFn(ref) : ref
  const snap = await query.get()
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))
}

export async function createDoc<T extends object>(
  collection: string,
  id: string,
  data: T,
): Promise<T & { id: string }> {
  const db = getDb()
  await db.collection(collection).doc(id).set(data)
  return { id, ...data }
}

export async function updateDoc<T extends object>(
  collection: string,
  id: string,
  data: Partial<T>,
): Promise<void> {
  const db = getDb()
  await db.collection(collection).doc(id).update(data as UpdateData<T>)
}

export async function deleteDoc(collection: string, id: string): Promise<void> {
  const db = getDb()
  await db.collection(collection).doc(id).delete()
}
