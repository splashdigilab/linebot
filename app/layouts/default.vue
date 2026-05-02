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

      <!-- Workspace switcher -->
      <div v-if="workspaceId" class="sidebar-workspace">
        <div class="sidebar-workspace-label">目前官方帳號</div>
        <div class="sidebar-workspace-name">{{ currentWorkspaceName }}</div>
        <NuxtLink to="/admin/workspaces" class="sidebar-workspace-switch">切換帳號 →</NuxtLink>
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

        <!-- Settings section (owner/admin only) -->
        <template v-if="canWrite">
          <div class="nav-section-label">設定</div>
          <NuxtLink :to="`/admin/${workspaceId}/settings/members`" class="nav-item" :class="{ active: route.path.includes('/settings/members') }">
            <span class="nav-icon">👥</span>
            <span>成員管理</span>
          </NuxtLink>
          <NuxtLink :to="`/admin/${workspaceId}/settings/organization`" class="nav-item" :class="{ active: route.path.includes('/settings/organization') }">
            <span class="nav-icon">🏢</span>
            <span>組織設定</span>
          </NuxtLink>
          <NuxtLink :to="`/admin/${workspaceId}/line-settings`" class="nav-item" :class="{ active: route.path === `/admin/${workspaceId}/line-settings` }">
            <span class="nav-icon">🔐</span>
            <span>LINE 連線</span>
          </NuxtLink>
        </template>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-footer-user">
          <div class="sidebar-footer-avatar">👤</div>
          <div class="sidebar-footer-user-meta">
            <div class="sidebar-footer-email truncate text-sm font-bold">
              {{ user?.email ?? '管理員' }}
            </div>
            <div class="text-xs text-muted">{{ currentRoleLabel }}</div>
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
const { workspaceId, currentRole, currentWorkspaceName, canWrite } = useWorkspace()

const ROLE_LABELS: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  agent: '客服',
  viewer: '觀察者',
}
const currentRoleLabel = computed(() => currentRole.value ? (ROLE_LABELS[currentRole.value] ?? currentRole.value) : 'Admin')

const navItems = computed(() => {
  const wid = workspaceId.value
  if (!wid) return []
  return [
    { to: `/admin/${wid}`, icon: '🏠', label: '儀表板' },
    { to: `/admin/${wid}/conversations`, icon: '💬', label: '對話' },
    { to: `/admin/${wid}/conversation-stats`, icon: '📊', label: '對話統計' },
    { to: `/admin/${wid}/flow`, icon: '🤖', label: '機器人模組' },
    { to: `/admin/${wid}/richmenu`, icon: '🗂️', label: '圖文選單' },
    { to: `/admin/${wid}/auto-reply`, icon: '⚡', label: '自動回覆' },
    { to: `/admin/${wid}/support-presets`, icon: '📦', label: '客服預存' },
    { to: `/admin/${wid}/tags`, icon: '🏷️', label: '標籤管理' },
    { to: `/admin/${wid}/campaigns`, icon: '📋', label: '活動標籤' },
    { to: `/admin/${wid}/broadcasts`, icon: '📣', label: '推播' },
    { to: `/admin/${wid}/users`, icon: '👥', label: '會員' },
  ]
})
</script>

<style scoped>
.sidebar-workspace {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  margin-bottom: 0.25rem;
}
.sidebar-workspace-label { font-size: 0.65rem; color: var(--color-text-muted, #9ca3af); text-transform: uppercase; letter-spacing: 0.05em; }
.sidebar-workspace-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text, #111); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-workspace-switch { font-size: 0.7rem; color: var(--color-primary, #409eff); text-decoration: none; }
.sidebar-workspace-switch:hover { text-decoration: underline; }
.nav-section-label { font-size: 0.65rem; color: var(--color-text-muted, #9ca3af); text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem 0.25rem; }
</style>
