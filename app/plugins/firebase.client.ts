import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

// 前端只用 Firebase Auth（登入 + ID token）；資料一律走後端 API（firebase-admin）。
// 不要在 client 端引入 firebase/firestore、firebase/storage——既沒有使用情境
// （Security Rules 為 deny-all），也會白白增加 bundle 體積。
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
    app = getApps()[0]!
  }

  const auth = getAuth(app)

  return {
    provide: {
      firebaseApp: app,
      auth,
    },
  }
})
