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

// 提前建立 TCP+TLS 連線到 LINE，縮短 liff.init() 的等待時間
useHead({
  link: [
    { rel: 'preconnect', href: 'https://api.line.me' },
    { rel: 'preconnect', href: 'https://access.line.me' },
    { rel: 'dns-prefetch', href: 'https://api.line.me' },
    { rel: 'dns-prefetch', href: 'https://access.line.me' },
  ],
})

const route = useRoute()
const phase = ref<'loading' | 'need-login' | 'done' | 'error'>('loading')
const errorText = ref('')
const doneMessage = ref('')
const debugInfo = ref('')
const needAddFriend = ref(false)
const addFriendUrl = ref('')

// ── localStorage: claim params (survives LINE OAuth redirect) ────────────
const LEAD_KEY = 'liff_lead_params'
const LEAD_TTL = 10 * 60 * 1000 // 10 min

function saveLeadParams(p: { ct: string; campaignCode: string; liffId: string }) {
  if (typeof localStorage === 'undefined' || (!p.ct && !p.liffId)) return
  try { localStorage.setItem(LEAD_KEY, JSON.stringify({ ...p, savedAt: Date.now() })) } catch {}
}
function loadLeadParams(): { ct: string; campaignCode: string; liffId: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LEAD_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (Date.now() - (d.savedAt || 0) > LEAD_TTL) { localStorage.removeItem(LEAD_KEY); return null }
    return { ct: String(d.ct || ''), campaignCode: String(d.campaignCode || ''), liffId: String(d.liffId || '') }
  } catch { return null }
}
function clearLeadParams() {
  if (typeof localStorage !== 'undefined') try { localStorage.removeItem(LEAD_KEY) } catch {}
}

// ── localStorage: config cache (avoids API round-trip on repeat visits) ─
const CFG_KEY = 'liff_config_cache'
const CFG_TTL = 60 * 60 * 1000 // 1 hour

function loadConfigCache(): { liffId: string; lineOaBasicId: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (Date.now() - (d.cachedAt || 0) > CFG_TTL) { localStorage.removeItem(CFG_KEY); return null }
    return { liffId: String(d.liffId || ''), lineOaBasicId: String(d.lineOaBasicId || '') }
  } catch { return null }
}
function saveConfigCache(cfg: { liffId: string; lineOaBasicId: string }) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(CFG_KEY, JSON.stringify({ ...cfg, cachedAt: Date.now() })) } catch {}
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
  if (typeof window === 'undefined') return { ct: '', campaignCode: '', liffId: '' }
  let result = { ct: '', campaignCode: '', liffId: '' }
  const url = new URL(window.location.href)
  result = mergeParsedLead(result, parseLeadClaimFromQuery(Object.fromEntries(url.searchParams.entries())))
  const hashRaw = String(url.hash || '').replace(/^#/, '')
  if (hashRaw) {
    const qs = hashRaw.includes('?') ? hashRaw.slice(hashRaw.indexOf('?') + 1) : hashRaw
    result = mergeParsedLead(result, parseLeadClaimFromQuery(Object.fromEntries(new URLSearchParams(qs).entries())))
  }
  result = mergeParsedLead(result, parseLeadClaimFromQuery({ 'liff.state': encodeURIComponent(window.location.href) }))
  return result
}

function buildDebugInfo(extra: Record<string, unknown>) {
  try {
    const routeQuery = route.query as Record<string, unknown>
    const loc = typeof window === 'undefined' ? {} : { href: window.location.href, search: window.location.search, hash: window.location.hash }
    return JSON.stringify({ routeQuery, parsedFromRoute: parseLeadClaimFromQuery(routeQuery), parsedFromLocation: parseLeadFromBrowserLocation(), ...loc, ...extra }, null, 2)
  } catch (e) { return `buildDebugInfo failed: ${String(e)}` }
}

onMounted(async () => {
  const ctx: Record<string, unknown> = { v: 6 }

  // ── 最先啟動：LIFF SDK 動態載入（與其他步驟並行執行）──────────────────
  // @line/liff 是最重的資源，越早開始載入越好。
  const liffImportPromise = import('@line/liff')

  // --- Step 1: Parse URL params ---
  let parsed = parseLeadClaimFromQuery(route.query as Record<string, unknown>)
  if (!parsed.ct || !parsed.liffId) parsed = mergeParsedLead(parsed, parseLeadFromBrowserLocation())
  ctx.step1Parsed = { ...parsed }

  // --- Step 1b: Restore params from localStorage after LINE OAuth redirect ---
  const isOAuthCallback = !parsed.ct && !parsed.liffId
    && typeof route.query.code === 'string'
    && typeof route.query.liffClientId === 'string'

  if (parsed.ct || parsed.liffId) {
    saveLeadParams(parsed)
    ctx.storageSaved = true
  }
  else if (isOAuthCallback) {
    const stored = loadLeadParams()
    if (stored) { parsed = mergeParsedLead(parsed, stored); ctx.storedParams = { ...stored }; ctx.restoredFromStorage = true }
  }
  ctx.step1bParsed = { ...parsed }

  // --- Step 2: Resolve liffId — localStorage cache → URL params → API ---
  // API fetch runs in parallel with liffImportPromise when liffId already known.
  let liffId = parsed.liffId

  // Try config cache first (instant, no network)
  const cachedCfg = loadConfigCache()
  if (cachedCfg) {
    if (!liffId) liffId = cachedCfg.liffId
    if (cachedCfg.lineOaBasicId) addFriendUrl.value = `https://line.me/R/ti/p/${encodeURIComponent(cachedCfg.lineOaBasicId)}`
    ctx.liffIdSource = liffId === cachedCfg.liffId ? 'cache' : 'url_or_params'
  }

  if (!liffId) {
    // Must fetch API before proceeding — but liffImportPromise is already loading in parallel
    try {
      const cfg = await $fetch<{ liffId: string; lineOaBasicId: string }>('/api/liff/config')
      liffId = cfg?.liffId || ''
      if (cfg) saveConfigCache(cfg)
      if (cfg?.lineOaBasicId) addFriendUrl.value = `https://line.me/R/ti/p/${encodeURIComponent(cfg.lineOaBasicId)}`
      ctx.liffIdSource = 'api'
    }
    catch (e) {
      ctx.liffIdSource = 'api_failed'
      ctx.liffIdApiError = String(e)
    }
  }
  else if (!cachedCfg || Date.now() - (loadConfigCache() as any)?.cachedAt > CFG_TTL / 2) {
    // Have liffId — refresh config cache in background without blocking
    $fetch<{ liffId: string; lineOaBasicId: string }>('/api/liff/config').then((cfg) => {
      if (cfg) saveConfigCache(cfg)
      if (cfg?.lineOaBasicId && !addFriendUrl.value) addFriendUrl.value = `https://line.me/R/ti/p/${encodeURIComponent(cfg.lineOaBasicId)}`
    }).catch(() => {})
    ctx.liffIdSource = ctx.liffIdSource || 'url_or_params'
  }
  ctx.liffId = liffId

  if (!liffId) {
    phase.value = 'error'
    errorText.value = '連結缺少 LIFF 識別。請回後台重新儲存活動以產生新連結，再重新開啟。'
    debugInfo.value = buildDebugInfo({ reason: 'missing_liff_id', mergedParsed: parsed, ...ctx })
    return
  }

  // --- Step 3: Await LIFF SDK (已與 Step 2 並行載入) ---
  const liffMod = await liffImportPromise
  const liff = liffMod.default

  ctx.preInitUrl = typeof window !== 'undefined' ? window.location.href : ''
  try {
    await liff.init({ liffId, withLoginOnExternalBrowser: true })
    ctx.initOk = true
  }
  catch (e: unknown) {
    const err = e as { message?: string }
    ctx.initOk = false; ctx.initError = err?.message || String(e)
    phase.value = 'error'
    errorText.value = `LIFF 初始化失敗：${err?.message || '未知錯誤'}`
    debugInfo.value = buildDebugInfo({ reason: 'liff_init_failed', mergedParsed: parsed, ...ctx })
    return
  }
  ctx.postInitUrl = typeof window !== 'undefined' ? window.location.href : ''
  ctx.isLoggedIn = liff.isLoggedIn()

  // --- Step 4: Re-read params after init (history.replaceState may have changed URL) ---
  if (!parsed.ct) {
    parsed = mergeParsedLead(parsed, parseLeadFromBrowserLocation())
    ctx.step4Parsed = { ...parsed }
  }
  const ct = parsed.ct

  // --- Step 5: Handle login ---
  if (!liff.isLoggedIn()) {
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
      { method: 'POST', body: { rawToken: ct, lineUserId: profile.userId } },
    )
    clearLeadParams()

    if (res.redirectUrl) {
      window.location.href = res.redirectUrl
      return
    }

    phase.value = 'done'
    if (res.immediatelyApplied) {
      doneMessage.value = '已將你的 LINE 與活動綁定。'
      needAddFriend.value = false
      if (liff.isInClient()) setTimeout(() => liff.closeWindow(), 2000)
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
    debugInfo.value = buildDebugInfo({ reason: 'run_claim_failed', mergedParsed: parsed, errorMessage: err?.data?.statusMessage || err?.message || 'unknown', ...ctx })
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
