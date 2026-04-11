import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  let app: FirebaseApp
  if (getApps().length === 0) {
    app = initializeApp({
      apiKey: config.public.firebaseApiKey,
      authDomain: config.public.firebaseAuthDomain,
      projectId: config.public.firebaseProjectId,
      storageBucket: config.public.firebaseStorageBucket,
      messagingSenderId: config.public.firebaseMessagingSenderId,
      appId: config.public.firebaseAppId,
    })
  }
  else {
    app = getApps()[0]
  }

  const auth = getAuth(app)
  const firestore = getFirestore(app)
  const storage = getStorage(app)

  return {
    provide: {
      firebaseApp: app,
      auth,
      firestore,
      storage,
    },
  }
})
