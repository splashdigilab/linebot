<template>
  <div class="liff-lead">
    <p v-if="phase === 'loading'" class="liff-lead-msg">載入中…</p>
    <p v-else-if="phase === 'need-login'" class="liff-lead-msg">正在前往 LINE 登入…</p>
    <template v-else-if="phase === 'done'">
      <p class="liff-lead-title">綁定完成</p>
      <p class="liff-lead-msg">{{ doneMessage }}</p>
      <template v-if="needAddFriend">
        <p class="liff-lead-hint">請加入官方帳號為好友，加好友後系統會自動完成活動貼標。</p>
        <a
          v-if="addFriendUrl"
          :href="addFriendUrl"
          class="liff-lead-btn"
          target="_blank"
          rel="noopener noreferrer"
        >加入官方帳號好友</a>
      </template>
      <p v-else class="liff-lead-hint">貼標與活動訊息已即時套用，請至 LINE 查收。</p>
    </template>
    <template v-else-if="phase === 'error'">
      <p class="liff-lead-title">無法完成綁定</p>
      <p class="liff-lead-msg liff-lead-err">{{ errorText }}</p>
      <div v-if="debugInfo" class="liff-lead-debug">
        <p class="liff-lead-debug-title">診斷資訊（請截圖提供給工程）</p>
        <pre class="liff-lead-debug-body">{{ debugInfo }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { $fetch } from 'ofetch'
import { parseLeadClaimFromQuery } from '~~/shared/liff-lead-query'

definePageMeta({ layout: false, ssr: false })

const route = useRoute()
const phase = ref<'loading' | 'need-login' | 'done' | 'error'>('loading')
const errorText = ref('')
const doneMessage = ref('')
const debugInfo = ref('')
const needAddFriend = ref(false)
const addFriendUrl = ref('')

// ── localStorage helpers for surviving the LINE OAuth redirect ──────────
// When liff.init({ withLoginOnExternalBrowser: true }) redirects to LINE OAuth,
// LINE redirects back with ?code=...&state=...&liffClientId=... but strips all
// original query params (claimToken, c, liffId). We persist them in localStorage
// before the redirect so we can restore them afterwards.
const STORAGE_KEY = 'liff_lead_params'
const STORAGE_TTL = 10 * 60 * 1000 // 10 minutes

function saveLeadParams(params: { ct: string; campaignCode: string; liffId: string }) {
  if (typeof localStorage === 'undefined') return
  if (!params.ct && !params.liffId) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params, savedAt: Date.now() }))
  }
  catch {}
}

function loadLeadParams(): { ct: string; campaignCode: string; liffId: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (Date.now() - (data.savedAt || 0) > STORAGE_TTL) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { ct: String(data.ct || ''), campaignCode: String(data.campaignCode || ''), liffId: String(data.liffId || '') }
  }
  catch { return null }
}

function clearLeadParams() {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(STORAGE_KEY) }
  catch {}
}

// ── URL parsing helpers ──────────────────────────────────────────────────

function mergeParsedLead(
  base: { ct: string; campaignCode: string; liffId: string },
  next: { ct: string; campaignCode: string; liffId: string },
) {
  return {
    ct: base.ct || next.ct,
    campaignCode: base.campaignCode || next.campaignCode,
    liffId: base.liffId || next.liffId,
  }
}

function parseLeadFromBrowserLocation() {
  if (typeof window === 'undefined') {
    return { ct: '', campaignCode: '', liffId: '' }
  }

  let result = { ct: '', campaignCode: '', liffId: '' }
  const url = new URL(window.location.href)
  const searchQuery = Object.fromEntries(url.searchParams.entries())
  result = mergeParsedLead(result, parseLeadClaimFromQuery(searchQuery))

  // LINE 有時會把參數塞在 hash（例如 #ct=... 或 #/liff/lead?ct=...）
  const hashRaw = String(url.hash || '').replace(/^#/, '')
  if (hashRaw) {
    const hashQueryString = hashRaw.includes('?')
      ? hashRaw.slice(hashRaw.indexOf('?') + 1)
      : hashRaw
    const hashParams = new URLSearchParams(hashQueryString)
    const hashQuery = Object.fromEntries(hashParams.entries())
    result = mergeParsedLead(result, parseLeadClaimFromQuery(hashQuery))
  }

  // 再保險：將完整 href 當成 liff.state 來源解析一次
  result = mergeParsedLead(result, parseLeadClaimFromQuery({
    'liff.state': encodeURIComponent(window.location.href),
  }))

  return result
}

function buildDebugInfo(extra: Record<string, unknown>) {
  try {
    const routeQuery = route.query as Record<string, unknown>
    const locationData = typeof window === 'undefined'
      ? {}
      : {
        href: window.location.href,
        search: window.location.search,
        hash: window.location.hash,
      }
    return JSON.stringify({
      routeQuery,
      parsedFromRoute: parseLeadClaimFromQuery(routeQuery),
      parsedFromLocation: parseLeadFromBrowserLocation(),
      ...locationData,
      ...extra,
    }, null, 2)
  }
  catch (e) {
    return `buildDebugInfo failed: ${String(e)}`
  }
}

onMounted(async () => {
  // Diagnostic context accumulated across steps — visible in every error's debugInfo.
  const ctx: Record<string, unknown> = { v: 5 }

  // --- Step 1: Parse whatever params are already in the URL ---
  let parsed = parseLeadClaimFromQuery(route.query as Record<string, unknown>)
  if (!parsed.ct || !parsed.liffId) {
    parsed = mergeParsedLead(parsed, parseLeadFromBrowserLocation())
  }
  ctx.step1Parsed = { ...parsed }

  // --- Step 1b: localStorage persistence across LINE OAuth redirect ---
  // If we have real params, save them now (so they survive the OAuth redirect).
  // If URL has only OAuth callback params (code/state/liffClientId), restore from storage.
  const isOAuthCallback = !parsed.ct && !parsed.liffId
    && typeof route.query.code === 'string'
    && typeof route.query.liffClientId === 'string'

  if (parsed.ct || parsed.liffId) {
    saveLeadParams(parsed)
    ctx.storageSaved = true
  }
  else if (isOAuthCallback) {
    const stored = loadLeadParams()
    if (stored) {
      parsed = mergeParsedLead(parsed, stored)
      ctx.storedParams = { ...stored }
      ctx.restoredFromStorage = true
    }
  }
  ctx.step1bParsed = { ...parsed }

  // --- Step 2: Fetch config (liffId fallback + lineOaBasicId for add-friend link) ---
  let liffId = parsed.liffId
  try {
    const cfg = await $fetch<{ liffId: string; lineOaBasicId: string }>('/api/liff/config')
    if (!liffId) {
      liffId = cfg?.liffId || ''
      ctx.liffIdSource = 'api'
    }
    else {
      ctx.liffIdSource = 'storage_or_url'
    }
    const basicId = String(cfg?.lineOaBasicId || '').trim()
    if (basicId) {
      addFriendUrl.value = `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`
    }
    ctx.lineOaBasicId = basicId
  }
  catch (e) {
    if (!liffId) {
      ctx.liffIdSource = 'api_failed'
      ctx.liffIdApiError = String(e)
    }
    else {
      ctx.liffIdSource = 'storage_or_url'
    }
  }
  ctx.liffId = liffId

  if (!liffId) {
    phase.value = 'error'
    errorText.value = '連結缺少 LIFF 識別。請回後台重新儲存活動以產生新連結，再重新開啟。'
    debugInfo.value = buildDebugInfo({ reason: 'missing_liff_id', mergedParsed: parsed, ...ctx })
    return
  }

  // --- Step 3: Init LIFF (always before reading params / checking login) ---
  const liffMod = await import('@line/liff')
  const liff = liffMod.default

  ctx.preInitUrl = typeof window !== 'undefined' ? window.location.href : ''
  try {
    await liff.init({ liffId, withLoginOnExternalBrowser: true })
    ctx.initOk = true
  }
  catch (e: unknown) {
    const err = e as { message?: string }
    ctx.initOk = false
    ctx.initError = err?.message || String(e)
    phase.value = 'error'
    errorText.value = `LIFF 初始化失敗：${err?.message || '未知錯誤'}`
    debugInfo.value = buildDebugInfo({ reason: 'liff_init_failed', mergedParsed: parsed, ...ctx })
    return
  }
  ctx.postInitUrl = typeof window !== 'undefined' ? window.location.href : ''
  ctx.isLoggedIn = liff.isLoggedIn()

  // --- Step 4: Re-read params after init (URL may have changed via history.replaceState) ---
  if (!parsed.ct) {
    const postInit = parseLeadFromBrowserLocation()
    parsed = mergeParsedLead(parsed, postInit)
    ctx.step4Parsed = { ...parsed }
  }
  const ct = parsed.ct

  // --- Step 5: Handle login ---
  if (!liff.isLoggedIn()) {
    // Save params before redirect so they survive the OAuth round-trip
    saveLeadParams(parsed)
    phase.value = 'need-login'
    liff.login({ redirectUri: window.location.href })
    return
  }

  // --- Step 6: Validate ct ---
  if (!ct) {
    phase.value = 'error'
    const malformedCtOnly = typeof window !== 'undefined' && window.location.search === '?ct'
    errorText.value = malformedCtOnly
      ? '目前收到的是「/liff/lead?ct」：ct 參數只有名稱、沒有值。這通常是把 LIFF Endpoint 網址當成活動網址，或連結在傳遞時被截斷。請回後台重新複製「活動進入網址（直接網址，非 liff.line.me 開頭）」再測試。'
      : '連結缺少必要參數。請回後台重新儲存活動以取得最新連結，再重新開啟。'
    debugInfo.value = buildDebugInfo({ reason: 'missing_ct', mergedParsed: parsed, ...ctx })
    return
  }

  // --- Step 7: Claim ---
  try {
    const profile = await liff.getProfile()
    const res = await $fetch<{ ok?: boolean; immediatelyApplied?: boolean; campaignCode?: string; redirectUrl?: string }>(
      '/api/liff/claim',
      {
        method: 'POST',
        body: { rawToken: ct, lineUserId: profile.userId },
      },
    )
    clearLeadParams()

    // 有設定轉址網址 → 直接跳轉，不顯示成功畫面
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl
      return
    }

    phase.value = 'done'
    if (res.immediatelyApplied) {
      doneMessage.value = '已將你的 LINE 與活動綁定。'
      needAddFriend.value = false
      // 在 LINE 內開啟時，自動關閉 LIFF 視窗回到聊天室
      if (liff.isInClient()) {
        setTimeout(() => liff.closeWindow(), 2000)
      }
    }
    else {
      doneMessage.value = '已將你的 LINE 與活動綁定。'
      needAddFriend.value = true
    }
  }
  catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    phase.value = 'error'
    errorText.value = err?.data?.statusMessage || err?.message || '發生錯誤，請稍後再試。'
    debugInfo.value = buildDebugInfo({
      reason: 'run_claim_failed',
      mergedParsed: parsed,
      errorMessage: err?.data?.statusMessage || err?.message || 'unknown',
      ...ctx,
    })
  }
})
</script>

<style scoped>
.liff-lead {
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 1.5rem;
  font-family: system-ui, sans-serif;
  background: #0f1419;
  color: #e8eaed;
}
.liff-lead-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
}
.liff-lead-msg {
  margin: 0 0 0.75rem;
  line-height: 1.5;
}
.liff-lead-hint {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: #9aa0a6;
  line-height: 1.5;
}
.liff-lead-btn {
  display: inline-block;
  padding: 0.625rem 1.25rem;
  background: #06c755;
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 600;
  border-radius: 0.5rem;
  text-decoration: none;
}
.liff-lead-btn:active {
  opacity: 0.85;
}
.liff-lead-err {
  color: #f28b82;
}
.liff-lead-debug {
  margin-top: 1rem;
  border: 1px solid #3c4043;
  border-radius: 0.5rem;
  background: #111827;
  padding: 0.75rem;
}
.liff-lead-debug-title {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: #9aa0a6;
}
.liff-lead-debug-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #cfd8dc;
}
</style>
