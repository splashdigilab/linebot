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
        <span v-if="loading" class="spinner" style="border-color:#ddd;border-top-color:#333;" />
        <svg v-else width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        使用 Google 登入
      </button>

      <p class="login-hint">僅限授權管理員帳號登入</p>
    </div>

    <!-- Background decorations -->
    <div class="bg-glow bg-glow-1" />
    <div class="bg-glow bg-glow-2" />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const { loginWithGoogle, isLoggedIn } = useAuth()
const loading = ref(false)
const errorMsg = ref('')

// Redirect if already logged in
watchEffect(() => {
  if (isLoggedIn.value) navigateTo('/admin')
})

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await loginWithGoogle()
    await navigateTo('/admin')
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

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  position: relative;
  overflow: hidden;
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
}
.bg-glow-1 {
  width: 400px; height: 400px;
  top: -100px; left: -100px;
  background: rgba(6,199,85,0.08);
}
.bg-glow-2 {
  width: 300px; height: 300px;
  bottom: -80px; right: -80px;
  background: rgba(59,130,246,0.06);
}

.login-card {
  position: relative;
  z-index: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 3rem 2.5rem;
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  box-shadow: var(--shadow-lg);
}

.login-logo {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.logo-circle {
  width: 64px; height: 64px;
  background: linear-gradient(135deg, var(--color-line), var(--color-line-dark));
  border-radius: var(--radius-lg);
  display: grid;
  place-items: center;
  font-size: 1.8rem;
  box-shadow: var(--shadow-green);
}

.login-logo h1 { font-size: 1.4rem; font-weight: 700; }
.login-logo p { color: var(--text-muted); font-size: 0.875rem; }

.login-error {
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: var(--color-error);
}

.btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.85rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--t-fast);
}
.btn-google:hover { background: var(--bg-hover); border-color: rgba(255,255,255,0.15); }
.btn-google:disabled { opacity: 0.6; cursor: not-allowed; }

.login-hint {
  text-align: center;
  font-size: 0.78rem;
  color: var(--text-muted);
}
</style>
