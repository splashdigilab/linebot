<template>
  <div>
    <div class="page-header">
      <div>
        <h1>儀表板</h1>
        <p>歡迎回來，{{ user?.email }}</p>
      </div>
      <div class="flex gap-1">
        <span class="badge badge-green">● 系統運行中</span>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid-3">
      <div class="stat-card">
        <div class="stat-icon orange">🗂️</div>
        <div>
          <div class="stat-label">Rich Menu</div>
          <div class="stat-value">{{ stats.richmenus }}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">🤖</div>
        <div>
          <div class="stat-label">對話流程</div>
          <div class="stat-value">{{ stats.flows }}</div>
        </div>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="card">
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">快速操作</h3>
      <div class="grid-3">
        <NuxtLink to="/admin/richmenu" class="quick-action">
          <span class="quick-icon">🗂️</span>
          <span>設定 Rich Menu</span>
        </NuxtLink>
        <NuxtLink to="/admin/flow" class="quick-action">
          <span class="quick-icon">🤖</span>
          <span>對話流程管理</span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

useHead({
  title: '儀表板 — LINE Bot 管理系統'
})

const { user } = useAuth()

const stats = ref({ richmenus: 0, flows: 0 })

async function loadStats() {
  const [menus, flows] = await Promise.all([
    $fetch<any[]>('/api/richmenu/list').catch(() => []),
    $fetch<any[]>('/api/flow/list').catch(() => []),
  ])
  stats.value = {
    richmenus: menus.length,
    flows: flows.length,
  }
}

onMounted(loadStats)
</script>

<style scoped>
.quick-action {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all var(--t-fast);
  text-decoration: none;
}
.quick-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-active);
}
.quick-icon { font-size: 1.2rem; }
</style>
