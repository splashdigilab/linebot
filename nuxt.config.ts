// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  nitro: {
    preset: 'aws-amplify',
  },

  modules: [
    '@element-plus/nuxt'
  ],

  elementPlus: {
    importStyle: 'scss',
  },

  // Disable SSR for admin pages — they are behind auth and don't need SEO
  routeRules: {
    '/admin/**': { ssr: false },
  },

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: `@use "~/assets/scss/element-variables.scss" as *;`,
        },
      },
    },
  },

  css: ['~/assets/scss/main.scss'],

  runtimeConfig: {
    // Server-only (private)
    lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
    /** 公開 HTTPS 原點（無尾斜線），供 Imagemap 透明圖轉址；未設時「保留透明」仍走 Flex（透明會變白底） */
    lineImagemapBaseUrl: process.env.LINE_IMAGEMAP_BASE_URL ?? '',
    /** 推播點擊追蹤：與 Nitro 對外網址相同原點（無尾斜線）。未設時發送不包裝 /api/r，點擊數不會增加 */
    clickTrackingBaseUrl: process.env.CLICK_TRACKING_BASE_URL ?? process.env.LINE_IMAGEMAP_BASE_URL ?? '',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ?? '',
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? '',

    // Public (exposed to client)
    public: {
      firebaseApiKey: process.env.FIREBASE_API_KEY ?? '',
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? '',
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
      firebaseAppId: process.env.FIREBASE_APP_ID ?? '',
    },
  },
})
