<template>
  <div>
    <div class="page-header">
      <div>
        <h1>儀表板</h1>
        <p>歡迎回來，{{ user?.email }}</p>
      </div>
      <div class="flex gap-1">
        <el-tag type="success">● 系統運行中</el-tag>
      </div>
    </div>

    <!-- Stats -->
    <el-row :gutter="20">
      <el-col :span="12">
        <el-card shadow="hover" class="stat-card-el">
          <div class="stat-card-el-inner">
            <div class="stat-icon orange">🗂️</div>
            <div>
              <div class="stat-label">圖文選單</div>
              <div class="stat-value">{{ stats.richmenus }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover" class="stat-card-el">
          <div class="stat-card-el-inner">
            <div class="stat-icon blue">🤖</div>
            <div>
              <div class="stat-label">對話流程</div>
              <div class="stat-value">{{ stats.flows }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Quick actions -->
    <el-card class="admin-mt-lg">
      <h3 class="admin-section-title">快速操作</h3>
      <el-row :gutter="20">
        <el-col :span="12">
          <NuxtLink :to="`/admin/${workspaceId}/richmenu`" class="quick-action">
            <span class="quick-icon">🗂️</span>
            <span>設定圖文選單</span>
          </NuxtLink>
        </el-col>
        <el-col :span="12">
          <NuxtLink :to="`/admin/${workspaceId}/flow`" class="quick-action">
            <span class="quick-icon">🤖</span>
            <span>對話流程管理</span>
          </NuxtLink>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

useHead({
  title: '儀表板 — LINE Bot 管理系統'
})

const { user } = useAuth()
const { workspaceId, apiFetch } = useWorkspace()

const stats = ref({ richmenus: 0, flows: 0 })

async function loadStats() {
  const [menus, flows] = await Promise.all([
    apiFetch<any[]>('/api/richmenu/list').catch(() => []),
    apiFetch<any[]>('/api/flow/list').catch(() => []),
  ])
  stats.value = {
    richmenus: menus.length,
    flows: flows.length,
  }
}

onMounted(loadStats)
</script>
