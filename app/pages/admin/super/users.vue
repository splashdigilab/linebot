<template>
  <div class="sa-page">
    <div class="sa-page-header">
      <div>
        <h1 class="sa-page-title">🛡️ Super Admin 管理</h1>
        <p class="sa-page-caption">搜尋使用者並管理 Super Admin 權限。</p>
      </div>
    </div>

    <!-- Search -->
    <div class="sa-card">
      <div class="sa-card-header">
        <span class="sa-card-title">查詢使用者</span>
      </div>
      <div class="sa-card-body">
        <div class="sa-search-bar">
          <el-input
            v-model="searchEmail"
            placeholder="輸入 Email 搜尋"
            style="max-width: 360px"
            clearable
            @keyup.enter="search"
          />
          <el-button type="primary" :loading="searching" @click="search">搜尋</el-button>
        </div>

        <div v-if="searchError" class="mt-2 text-sm" style="color: var(--color-error)">
          {{ searchError }}
        </div>

        <div v-if="foundUser" class="sa-user-result mt-2">
          <div class="sa-user-info">
            <span class="sa-user-name">{{ foundUser.displayName || '（無顯示名稱）' }}</span>
            <span class="sa-user-email">{{ foundUser.email }}</span>
            <span class="sa-user-uid">UID: {{ foundUser.uid }}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap">
            <el-tag :type="foundUser.isSuperAdmin ? 'danger' : 'info'" size="small">
              {{ foundUser.isSuperAdmin ? 'Super Admin' : '一般使用者' }}
            </el-tag>
            <el-tag v-if="foundUser.disabled" type="warning" size="small">帳號停用</el-tag>
            <el-button
              v-if="!foundUser.isSuperAdmin"
              size="small"
              type="danger"
              plain
              :loading="acting"
              @click="grantSuperAdmin"
            >
              授予 Super Admin
            </el-button>
            <el-button
              v-else
              size="small"
              type="warning"
              plain
              :loading="acting"
              @click="revokeSuperAdmin"
            >
              撤銷 Super Admin
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- Note -->
    <div class="admin-alert admin-alert--warn">
      <strong>注意：</strong>Super Admin 授予/撤銷後，該使用者需要重新登入才能生效（Firebase ID token 需刷新）。
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'super-admin'], layout: 'super-admin' })
useHead({ title: 'Super Admin 管理 — Super Admin' })

const { apiFetch } = useSuperAdmin()
const { showToast } = useAdminToast()

const searchEmail = ref('')
const searching = ref(false)
const acting = ref(false)
const searchError = ref('')
const foundUser = ref<any>(null)

async function search() {
  const email = searchEmail.value.trim()
  if (!email) return
  searching.value = true
  searchError.value = ''
  foundUser.value = null
  try {
    foundUser.value = await apiFetch<any>(`/api/admin/super/users/search?email=${encodeURIComponent(email)}`)
  } catch (e: any) {
    searchError.value = e?.data?.statusMessage || '查無此使用者'
  } finally {
    searching.value = false
  }
}

async function grantSuperAdmin() {
  if (!foundUser.value) return
  if (!confirm(`確定授予「${foundUser.value.email}」Super Admin 權限？`)) return
  acting.value = true
  try {
    await apiFetch(`/api/admin/super/users/${foundUser.value.uid}/super-admin`, { method: 'POST' })
    showToast('已授予 Super Admin', 'success')
    foundUser.value = { ...foundUser.value, isSuperAdmin: true }
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  } finally {
    acting.value = false
  }
}

async function revokeSuperAdmin() {
  if (!foundUser.value) return
  if (!confirm(`確定撤銷「${foundUser.value.email}」的 Super Admin 權限？`)) return
  acting.value = true
  try {
    await apiFetch(`/api/admin/super/users/${foundUser.value.uid}/super-admin`, { method: 'DELETE' })
    showToast('已撤銷 Super Admin', 'success')
    foundUser.value = { ...foundUser.value, isSuperAdmin: false }
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  } finally {
    acting.value = false
  }
}
</script>
