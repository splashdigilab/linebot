<template>
  <div class="layout-wrapper">
    <aside class="sidebar sa-sidebar">
      <div class="sidebar-scroll">
        <div class="sidebar-logo">
          <span class="logo-icon">⚙️</span>
          <div>
            <span class="logo-text">Super Admin</span>
            <span class="logo-sub">系統管理後台</span>
          </div>
        </div>

        <div class="sidebar-workspace">
          <div class="sidebar-workspace-label">目前官方帳號</div>
          <div class="sidebar-workspace-name">Super Admin</div>
          <div class="sidebar-workspace-actions">
            <NuxtLink to="/admin/workspaces" class="ws-sidebar-switch">
              <span class="ws-sidebar-switch__icon">💬</span>
              <span class="ws-sidebar-switch__main">
                <span class="ws-sidebar-switch__title">回到官方帳號</span>
                <span class="ws-sidebar-switch__sub">選擇要管理的官方帳號</span>
              </span>
              <span class="ws-sidebar-switch__arrow">→</span>
            </NuxtLink>
          </div>
        </div>

        <nav class="sidebar-nav">
          <NuxtLink to="/admin/super/organizations" class="nav-item" :class="{ active: route.path.startsWith('/admin/super/organizations') }">
            <span class="nav-icon">🏢</span>
            <span>組織管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/super/workspaces" class="nav-item" :class="{ active: route.path.startsWith('/admin/super/workspaces') }">
            <span class="nav-icon">💬</span>
            <span>官方帳號管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/super/users" class="nav-item" :class="{ active: route.path.startsWith('/admin/super/users') }">
            <span class="nav-icon">🛡️</span>
            <span>Super Admin 管理</span>
          </NuxtLink>
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-footer-user">
          <div class="sidebar-footer-avatar">👤</div>
          <div class="sidebar-footer-user-meta">
            <div class="sidebar-footer-email truncate text-sm font-bold">{{ user?.email ?? '管理員' }}</div>
            <div class="text-xs sa-role-badge">Super Admin</div>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm w-full" @click="logout">
          🚪 登出
        </button>
      </div>
    </aside>

    <main class="main-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { user, logout } = useAuth()
</script>
