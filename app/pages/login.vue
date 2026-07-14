<template>
  <div class="login-page">
    <div class="login-card">
      <!-- Logo -->
      <div class="login-logo">
        <div class="logo-circle">💬</div>
        <h1>LINE Bot 管理系統</h1>
        <p>使用 Google 帳號登入以繼續</p>
      </div>

      <!-- Error -->
      <div v-if="errorMsg" class="login-error">
        ⚠️ {{ errorMsg }}
      </div>

      <!-- Login Button -->
      <button
        class="btn-google"
        :disabled="loading"
        @click="handleLogin"
      >
        <span v-if="loading" class="spinner" />
        <svg v-else width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        使用 Google 登入
      </button>

      <!--
        講清楚「這是邀請制」。原本只寫「僅限授權管理員帳號登入」，語意是「你沒被授權」，
        但沒說「要怎樣才會被授權」——結果潛在客戶照樣點下去，然後撞上一堵牆。
        先說明制度，再給他一個不用登入也能走的出口。
      -->
      <p class="login-hint">目前採邀請制。若你的團隊已在使用，請管理員先邀請你的 Google 信箱。</p>
      <p v-if="contactHref" class="login-hint">
        還不是客戶？<a :href="contactHref" target="_blank" rel="noopener" class="login-contact">聯繫我們 / 預約 Demo →</a>
      </p>
    </div>

    <!-- Background decorations -->
    <div class="bg-glow bg-glow-1" />
    <div class="bg-glow bg-glow-2" />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const { loginWithGoogle, isLoggedIn, waitForAuthReady } = useAuth()

// 不是客戶的人也會走到登入頁 → 給他一個不用登入就能走的出口
const config = useRuntimeConfig()
const contact = String(config.public.supportContact ?? '').trim()
const contactHref = contact
  ? (contact.startsWith('http') ? contact : `mailto:${contact}`)
  : ''
const loading = ref(false)
const errorMsg = ref('')

function loginRedirectTarget(): string {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/admin')) {
    return redirect
  }
  return '/admin/workspaces'
}

// 已登入時離開登入頁（等 auth 就緒，避免重整流程誤觸）
onMounted(async () => {
  await waitForAuthReady()
  if (isLoggedIn.value) await navigateTo(loginRedirectTarget())
})

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await loginWithGoogle()
    await navigateTo(loginRedirectTarget())
  }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '登入失敗，請重試'
    errorMsg.value = msg
  }
  finally {
    loading.value = false
  }
}
</script>
