<template>
  <div class="layout-wrapper">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-icon">💬</span>
        <div>
          <span class="logo-text">LINE Bot</span>
          <span class="logo-sub">管理系統</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path === item.to }"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-footer-user">
          <div class="sidebar-footer-avatar">
            👤
          </div>
          <div class="sidebar-footer-user-meta">
            <div class="sidebar-footer-email truncate text-sm font-bold">
              {{ user?.email ?? '管理員' }}
            </div>
            <div class="text-xs text-muted">Admin</div>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm w-full" @click="logout">
          🚪 登出
        </button>
      </div>
    </aside>

    <!-- Page Content -->
    <main class="main-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { user, logout } = useAuth()

const navItems = [
  { to: '/admin', icon: '🏠', label: '儀表板' },
  { to: '/admin/line-settings', icon: '🔐', label: 'LINE 連線' },
  { to: '/admin/richmenu', icon: '🗂️', label: 'Rich Menu' },
  { to: '/admin/flow', icon: '🤖', label: '機器人模組' },
  { to: '/admin/auto-reply', icon: '⚡', label: '自動回覆' },
  { to: '/admin/support-presets', icon: '📦', label: '客服預存' },
  { to: '/admin/tags', icon: '🏷️', label: '標籤管理' },
  { to: '/admin/campaigns', icon: '📋', label: '活動貼標' },
  { to: '/admin/users', icon: '👥', label: '會員' },
  { to: '/admin/conversations', icon: '💬', label: '對話' },
  { to: '/admin/broadcasts', icon: '📣', label: '推播' },
]
</script>
