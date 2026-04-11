import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'

declare module '#app' {
  interface NuxtApp {
    $firebaseApp: FirebaseApp
    $auth: Auth
    $firestore: Firestore
    $storage: FirebaseStorage
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $firebaseApp: FirebaseApp
    $auth: Auth
    $firestore: Firestore
    $storage: FirebaseStorage
  }
}

export {}
