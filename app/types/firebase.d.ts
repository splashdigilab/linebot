import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'

declare module '#app' {
  interface NuxtApp {
    $firebaseApp: FirebaseApp
    $auth: Auth
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $firebaseApp: FirebaseApp
    $auth: Auth
  }
}

export {}
