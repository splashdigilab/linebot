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
    // 產出 liff/lead.html（而非 liff/lead/index.html）：Amplify 靜態層才能以
    // 「路徑 + .html」解析無副檔名網址，讓活動入口頁不經 Lambda、免冷啟動直出
    prerender: {
      autoSubfolderIndex: false,
    },
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // 本機 dev 等環境；正式環境主要依 server/plugins/broadcast-scheduler.ts
      '* * * * *': ['broadcast:trigger-scheduled'],
      // 每 5 分鐘撿 failed / 卡住的知識卡重新索引
      '*/5 * * * *': ['ai:retry-stuck-chunks'],
      // 每 15 分鐘清掉過期的知識庫預覽 job（Firestore 文件 + Storage temp）
      '*/15 * * * *': ['ai:cleanup-preview-jobs'],
      // 每 30 分鐘掃 URL 來源是否內容變動（每個 source 的實際偵測頻率由 refreshIntervalMinutes 決定）
      '*/30 * * * *': ['ai:detect-source-updates'],
      // 每 10 分鐘掃「真人處理中但閒置過久」的會話自動交還機器人（handbackIdleMinutes=0 不動作）
      // + 「轉真人超時無人回應」的 SLA 提醒（每場會話一次）
      '*/10 * * * *': ['conversation:auto-handback', 'conversation:handoff-sla'],
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
    // 活動入口頁：build 時就產出 SPA 殼（scripts/patch-amplify-manifest.mjs 會把它
    // 註冊成 Amplify 靜態路由），第一屏 spinner 不用等 Lambda 冷啟動
    '/liff/lead': { ssr: false, prerender: true },
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

  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // 繁中主字型：Google Fonts 依 unicode-range 分片，只下載實際用到的字；native 字型為 fallback（display=swap 不擋首屏）
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap' },
      ],
    },
  },

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
    /**
     * 藍新金流 MPG 特店設定（每租戶各一組；private，勿放 public 以免金鑰外洩）。
     * 測試特店 API 用 ccore.newebpay.com、正式用 core.newebpay.com。
     */
    newebpayMerchantId: process.env.NEWEBPAY_MERCHANT_ID ?? '',
    newebpayHashKey: process.env.NEWEBPAY_HASH_KEY ?? '',
    newebpayHashIV: process.env.NEWEBPAY_HASH_IV ?? '',
    newebpayApiUrl: process.env.NEWEBPAY_API_URL ?? 'https://ccore.newebpay.com/MPG/mpg_gateway',
    /**
     * 信用卡定期定額（自動續訂）。與 MPG 共用同一組特店金鑰,只是換一支端點。
     * ⚠️ 定期定額是**申請制**——要先在藍新特店後台啟用「定期定額支付工具」才會通;
     *    未啟用時把 NEWEBPAY_PERIOD_ENABLED 留白,結帳會退回一次性付款,不會壞掉。
     */
    newebpayPeriodEnabled: process.env.NEWEBPAY_PERIOD_ENABLED === 'true',
    newebpayPeriodApiUrl: process.env.NEWEBPAY_PERIOD_API_URL ?? 'https://ccore.newebpay.com/MPG/period',
    newebpayPeriodAlterUrl: process.env.NEWEBPAY_PERIOD_ALTER_URL ?? 'https://ccore.newebpay.com/MPG/period/AlterStatus',
    /**
     * ezPay 電子發票（**獨立的商店帳號**，與金流那組金鑰不同，需另外申請）。
     * 未設定 → 收款照常，只是不開發票。
     *
     * ⚠️ apiUrl **刻意不給預設值**。若預設成測試站，正式環境只要忘了設這個環境變數，
     *    就會把真實交易的發票開到測試平台——客戶會拿到一個不存在的發票號碼，
     *    而且稅是真的沒報。四個值必須全設才會啟用開票（見 isInvoiceConfigured）。
     *    測試 https://cinv.ezpay.com.tw／正式 https://inv.ezpay.com.tw
     */
    ezpayInvoiceMerchantId: process.env.EZPAY_INVOICE_MERCHANT_ID ?? '',
    ezpayInvoiceHashKey: process.env.EZPAY_INVOICE_HASH_KEY ?? '',
    ezpayInvoiceHashIV: process.env.EZPAY_INVOICE_HASH_IV ?? '',
    ezpayInvoiceApiUrl: process.env.EZPAY_INVOICE_API_URL ?? '',
    /** 對外 HTTPS 原點（金流 Notify/Return 導回用）；與 clickTrackingBaseUrl 同源 */
    appBaseUrl: appPublicBaseUrl,
    /**
     * 交易通知信（AWS SES）。付款收據、扣款失敗、續扣提醒、額度用完會寄到客戶的帳務信箱。
     *
     * ⚠️ 三個都要設齊才會真的寄信（見 isEmailConfigured）：
     *   - EMAIL_FROM：寄件人（**必須是 SES 已驗證的網域／信箱**，否則 SES 會拒寄），
     *     可帶顯示名稱，例：`MYFEEL <noreply@yourdomain.com>`
     *   - AWS_SES_REGION：SES 所在區域（例 ap-northeast-1）
     *   憑證由 Amplify 執行角色 / 環境自動解析（SDK 預設鏈），不放這裡。
     *   未設定 → 全部寄信變 no-op（只 log），金流／排程流程照常不受影響。
     */
    emailFrom: process.env.EMAIL_FROM ?? '',
    emailReplyTo: process.env.EMAIL_REPLY_TO ?? '',
    awsSesRegion: process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? '',

    // Public (exposed to client)
    public: {
      firebaseApiKey: process.env.FIREBASE_API_KEY ?? '',
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? '',
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
      firebaseAppId: process.env.FIREBASE_APP_ID ?? '',
      /** 升級／加購的聯繫方式（email 或 https 連結）；顯示於「升級方案」對話框。未設則顯示通用引導文字。 */
      supportContact: process.env.PUBLIC_SUPPORT_CONTACT ?? '',
      /** 門面／登入頁顯示的品牌名（多租戶：各 deployment 可用 PUBLIC_BRAND_NAME 覆寫）。預設沿用 landing 的 MYFEEL。 */
      brandName: process.env.PUBLIC_BRAND_NAME ?? 'MYFEEL',
      /**
       * 線上付款是否已開通（藍新三把金鑰都設好才為 true）。
       * 只是布林值、不含任何金鑰內容；前端據此決定結帳鈕能不能按，
       * 避免金流未設定時按下去只拿到 500「金流尚未設定」。
       */
      paymentEnabled: Boolean(
        process.env.NEWEBPAY_MERCHANT_ID
        && process.env.NEWEBPAY_HASH_KEY
        && process.env.NEWEBPAY_HASH_IV,
      ),
      /**
       * 結帳是否走「自動續訂」（定期定額委託）而非一次性付款。
       * 前端據此決定確認文案（「每月自動扣款」vs「單次付款」）與是否顯示取消訂閱按鈕。
       */
      recurringEnabled: Boolean(
        process.env.NEWEBPAY_MERCHANT_ID
        && process.env.NEWEBPAY_HASH_KEY
        && process.env.NEWEBPAY_HASH_IV
        && process.env.NEWEBPAY_PERIOD_ENABLED === 'true',
      ),
      /** 電子發票是否已開通（前端據此顯示／隱藏「發票資訊」設定卡）。四個值缺一不可。 */
      invoiceEnabled: Boolean(
        process.env.EZPAY_INVOICE_MERCHANT_ID
        && process.env.EZPAY_INVOICE_HASH_KEY
        && process.env.EZPAY_INVOICE_HASH_IV
        && process.env.EZPAY_INVOICE_API_URL,
      ),
      /**
       * 官方 FAQ 範本的 Google Sheet 母本網址（開「知道連結者可檢視」）。
       * 設定後匯入對話框顯示「使用 FAQ 範本」按鈕（自動轉 /copy 一鍵建立副本）；
       * 未設則退回下載 public/templates/faq-sheet-template.xlsx。
       */
      faqTemplateSheetUrl: process.env.PUBLIC_FAQ_TEMPLATE_SHEET_URL ?? '',
    },
  },
})
