import {
  collection,
  doc as firestoreDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  type Firestore,
  type QueryConstraint,
  type DocumentData,
} from 'firebase/firestore'

/**
 * Subscribe to a Firestore collection with realtime updates.
 * Returns a reactive ref that auto-updates and a cleanup function.
 */
export function useCollection<T = DocumentData>(
  collectionName: string,
  constraints: QueryConstraint[] = [],
) {
  const { $firestore } = useNuxtApp()
  const db = $firestore as Firestore

  const docs = ref<(T & { id: string })[]>([])
  const loading = ref(true)
  const error = ref<Error | null>(null)

  const col = collection(db, collectionName)
  const q = constraints.length ? query(col, ...constraints) : query(col)

  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      docs.value = snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))
      loading.value = false
    },
    (err) => {
      error.value = err
      loading.value = false
    },
  )

  onUnmounted(unsubscribe)

  return { docs, loading, error, unsubscribe }
}

/** Subscribe to a single Firestore document */
export function useDocument<T = DocumentData>(
  collectionName: string,
  docId: string,
) {
  const { $firestore } = useNuxtApp()
  const db = $firestore as Firestore

  const data = ref<(T & { id: string }) | null>(null)
  const loading = ref(true)
  const error = ref<Error | null>(null)

  const docRef = firestoreDoc(db, collectionName, docId)

  const unsubscribe = onSnapshot(
    docRef,
    (snap) => {
      data.value = snap.exists() ? { id: snap.id, ...(snap.data() as T) } : null
      loading.value = false
    },
    (err) => {
      error.value = err
      loading.value = false
    },
  )

  onUnmounted(unsubscribe)

  return { data, loading, error, unsubscribe }
}

// Re-export useful query helpers
export { where, orderBy }
