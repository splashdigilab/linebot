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
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // 本機 dev 等環境；正式環境主要依 server/plugins/broadcast-scheduler.ts
      '* * * * *': ['broadcast:trigger-scheduled'],
      // 每 5 分鐘撿 failed / 卡住的知識卡重新索引
      '*/5 * * * *': ['ai:retry-stuck-chunks'],
      // 每 30 分鐘掃 URL 來源是否內容變動（每個 source 的實際偵測頻率由 refreshIntervalMinutes 決定）
      '*/30 * * * *': ['ai:detect-source-updates'],
      // 每小時清理過期的 webhook 冪等鎖（Firestore TTL 的程式內保底）
      '0 * * * *': ['webhook:cleanup-event-locks'],
    },
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
    '/liff/**': { ssr: false },
  },

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          // Vite 7 型別未收錄 sass-embedded 的 api 選項，但執行期支援
          api: 'modern-compiler',
          additionalData: `@use "~/assets/scss/element-variables.scss" as *;`,
        } as Record<string, unknown>,
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
    /** 對話訊息保留天數（超過天數會由 cleanup API 清掉） */
    conversationRetentionDays: process.env.CONVERSATION_RETENTION_DAYS ?? '180',
    /** 單次 cleanup 最多刪除幾筆舊訊息（Firestore batch 上限 500） */
    conversationCleanupBatchSize: process.env.CONVERSATION_CLEANUP_BATCH_SIZE ?? '400',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ?? '',
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? '',
    /** Google AI Studio API key（Gemini answer + embedding 共用）。申請：https://aistudio.google.com/apikey */
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',

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
