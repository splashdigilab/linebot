<template>
  <div class="liff-lead">
    <p v-if="phase === 'loading'" class="liff-lead-msg">載入中…</p>
    <p v-else-if="phase === 'need-login'" class="liff-lead-msg">正在前往 LINE 登入…</p>
    <template v-else-if="phase === 'done'">
      <p class="liff-lead-title">綁定完成</p>
      <p class="liff-lead-msg">{{ doneMessage }}</p>
      <p class="liff-lead-hint">請加入官方帳號為好友，加好友後系統會自動完成活動貼標。</p>
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
import { parseLeadClaimFromQuery } from '~~/shared/liff-lead-query'

definePageMeta({ layout: false, ssr: false })

const route = useRoute()
const phase = ref<'loading' | 'need-login' | 'done' | 'error'>('loading')
const errorText = ref('')
const doneMessage = ref('')
const debugInfo = ref('')

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

async function runClaim(ct: string, liffId: string) {
  const liffMod = await import('@line/liff')
  const liff = liffMod.default
  await liff.init({ liffId, withLoginOnExternalBrowser: true })

  if (!liff.isLoggedIn()) {
    phase.value = 'need-login'
    liff.login({ redirectUri: window.location.href })
    return
  }

  const profile = await liff.getProfile()
  const res = await $fetch<{ ok?: boolean; alreadyApplied?: boolean; campaignCode?: string }>(
    '/api/liff/claim',
    {
      method: 'POST',
      body: { rawToken: ct, lineUserId: profile.userId },
    },
  )

  phase.value = 'done'
  if (res.alreadyApplied)
    doneMessage.value = '此活動先前已完成貼標。'
  else
    doneMessage.value = '已將你的 LINE 與活動綁定。'
}

onMounted(async () => {
  let parsed = parseLeadClaimFromQuery(route.query as Record<string, unknown>)
  if (!parsed.ct || !parsed.liffId) {
    parsed = mergeParsedLead(parsed, parseLeadFromBrowserLocation())
  }
  const { ct, liffId } = parsed
  if (!ct) {
    phase.value = 'error'
    const malformedCtOnly = typeof window !== 'undefined' && window.location.search === '?ct'
    errorText.value = malformedCtOnly
      ? '目前收到的是「/liff/lead?ct」：ct 參數只有名稱、沒有值。這通常是把 LIFF Endpoint 網址當成活動網址，或連結在傳遞時被截斷。請回後台重新複製「活動進入網址（liff.line.me 開頭）」再測試。'
      : '連結缺少必要參數。請使用活動提供的完整網址，並確認 LINE Developers 中此 LIFF 的 Endpoint URL 為「你的網域/liff/lead」，勿與 Webhook（/webhook）相同。'
    debugInfo.value = buildDebugInfo({ reason: 'missing_ct', mergedParsed: parsed })
    return
  }
  if (!liffId) {
    phase.value = 'error'
    errorText.value = '連結缺少 LIFF 識別。請回後台重新儲存活動以產生新連結，再重新開啟。'
    debugInfo.value = buildDebugInfo({ reason: 'missing_liff_id', mergedParsed: parsed })
    return
  }

  try {
    await runClaim(ct, liffId)
    if (phase.value === 'need-login')
      return
  }
  catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    phase.value = 'error'
    errorText.value = err?.data?.statusMessage || err?.message || '發生錯誤，請稍後再試。'
    debugInfo.value = buildDebugInfo({
      reason: 'run_claim_failed',
      mergedParsed: parsed,
      errorMessage: err?.data?.statusMessage || err?.message || 'unknown',
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
  margin: 0;
  font-size: 0.875rem;
  color: #9aa0a6;
  line-height: 1.5;
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
