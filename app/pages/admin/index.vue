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
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card-el">
          <div class="stat-card-el-inner">
            <div class="stat-icon orange">🗂️</div>
            <div>
              <div class="stat-label">Rich Menu</div>
              <div class="stat-value">{{ stats.richmenus }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
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
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card-el">
          <div class="stat-card-el-inner">
            <div class="stat-icon green">📰</div>
            <div>
              <div class="stat-label">圖文訊息</div>
              <div class="stat-value">{{ stats.richMessages }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Quick actions -->
    <el-card class="admin-mt-lg">
      <h3 class="admin-section-title">快速操作</h3>
      <el-row :gutter="20">
        <el-col :span="8">
          <NuxtLink to="/admin/richmenu" class="quick-action">
            <span class="quick-icon">🗂️</span>
            <span>設定 Rich Menu</span>
          </NuxtLink>
        </el-col>
        <el-col :span="8">
          <NuxtLink to="/admin/flow" class="quick-action">
            <span class="quick-icon">🤖</span>
            <span>對話流程管理</span>
          </NuxtLink>
        </el-col>
        <el-col :span="8">
          <NuxtLink to="/admin/rich-message" class="quick-action">
            <span class="quick-icon">📰</span>
            <span>圖文訊息管理</span>
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

const stats = ref({ richmenus: 0, flows: 0, richMessages: 0 })

async function loadStats() {
  const [menus, flows, richMessages] = await Promise.all([
    $fetch<any[]>('/api/richmenu/list').catch(() => []),
    $fetch<any[]>('/api/flow/list').catch(() => []),
    $fetch<any[]>('/api/rich-message/list').catch(() => []),
  ])
  stats.value = {
    richmenus: menus.length,
    flows: flows.length,
    richMessages: richMessages.length,
  }
}

onMounted(loadStats)
</script>


