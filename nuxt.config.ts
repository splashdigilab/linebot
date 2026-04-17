// https://nuxt.com/docs/api/configuration/nuxt-config

/** 對外 HTTPS 原點（無尾斜線）：圖文 Imagemap、推播 /api/r 點擊追蹤共用。建議只設 PUBLIC_BASE_URL；舊名 LINE_IMAGEMAP_BASE_URL、CLICK_TRACKING_BASE_URL 仍相容。 */
const appPublicBaseUrl = String(
  process.env.PUBLIC_BASE_URL
    || process.env.LINE_IMAGEMAP_BASE_URL
    || process.env.CLICK_TRACKING_BASE_URL
    || '',
).trim()

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
    /** 與 clickTrackingBaseUrl 同源，皆來自 PUBLIC_BASE_URL（或舊環境變數 fallback） */
    lineImagemapBaseUrl: appPublicBaseUrl,
    clickTrackingBaseUrl: appPublicBaseUrl,
    /** 排程推播自動觸發保護密鑰；由 Cron Job 帶在 X-Cron-Secret header */
    cronSecret: process.env.CRON_SECRET ?? '',
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
