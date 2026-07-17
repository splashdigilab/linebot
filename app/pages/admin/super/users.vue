<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="Super Admin"
        title="🛡️ Super Admin 管理"
        caption="搜尋使用者並管理 Super Admin 權限。"
      />
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">目前的 Super Admin</span>
            </div>
            <span class="text-xs text-muted">共 {{ admins.length }} 筆</span>
          </div>
          <div class="card-section-stack">
            <el-table
              v-loading="loadingList"
              :data="admins"
              size="small"
              empty-text="尚無登記於清單的 Super Admin（可於下方搜尋後授予或補登記）"
            >
              <el-table-column label="使用者" min-width="220">
                <template #default="{ row }">
                  <div class="sa-user-info">
                    <div class="sa-name-row">
                      <span class="sa-user-name">{{ row.displayName || '（無顯示名稱）' }}</span>
                      <el-tag v-if="row.isSelf" type="info" size="small">你自己</el-tag>
                      <el-tag v-if="row.missing" type="info" size="small">帳號不存在</el-tag>
                      <el-tag v-else-if="!row.claimActive" type="warning" size="small">claim 未生效</el-tag>
                      <el-tag v-else-if="row.disabled" type="warning" size="small">帳號停用</el-tag>
                    </div>
                    <span class="sa-user-email">{{ row.email || '（無 Email）' }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" align="right">
                <template #default="{ row }">
                  <span v-if="row.isSelf" class="text-xs text-muted">目前登入帳號</span>
                  <el-button
                    v-else
                    size="small"
                    type="warning"
                    plain
                    :loading="acting"
                    @click="revokeByUid(row.uid, row.email)"
                  >
                    撤銷
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">查詢使用者</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="sa-search-bar">
              <el-input
                v-model="searchEmail"
                class="sa-search-input"
                placeholder="輸入 Email 搜尋"
                clearable
                @keyup.enter="search"
              />
              <el-button type="primary" :loading="searching" @click="search">搜尋</el-button>
            </div>

            <div v-if="searchError" class="text-sm sa-search-error">
              {{ searchError }}
            </div>

            <div v-if="foundUser" class="sa-user-result">
              <div class="sa-user-info">
                <span class="sa-user-name">{{ foundUser.displayName || '（無顯示名稱）' }}</span>
                <span class="sa-user-email">{{ foundUser.email }}</span>
                <span class="sa-user-uid">UID: {{ foundUser.uid }}</span>
              </div>
              <div class="sa-user-actions">
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
                <template v-else>
                  <el-button
                    v-if="!foundUser.inIndex"
                    size="small"
                    type="primary"
                    plain
                    :loading="acting"
                    @click="grantSuperAdmin"
                  >
                    補登記到清單
                  </el-button>
                  <el-button
                    size="small"
                    type="warning"
                    plain
                    :loading="acting"
                    @click="revokeByUid(foundUser.uid, foundUser.email)"
                  >
                    撤銷 Super Admin
                  </el-button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="admin-alert admin-alert--warn">
          <strong>注意：</strong>Super Admin 授予/撤銷後，該使用者需要重新登入才能生效（Firebase ID token 需刷新）。
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
definePageMeta({ middleware: ['auth', 'super-admin'], layout: 'super-admin' })
useHead({ title: 'Super Admin 管理 — Super Admin' })

const { apiFetch } = useSuperAdmin()
const { showToast } = useAdminToast()

const admins = ref<any[]>([])
const loadingList = ref(false)

const searchEmail = ref('')
const searching = ref(false)
const acting = ref(false)
const searchError = ref('')
const foundUser = ref<any>(null)

async function loadAdmins() {
  loadingList.value = true
  try {
    admins.value = await apiFetch<any[]>('/api/admin/super/users')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '載入清單失敗', 'error')
  } finally {
    loadingList.value = false
  }
}
onMounted(loadAdmins)

async function search() {
  const email = searchEmail.value.trim()
  if (!email) {
    searchError.value = '請輸入 Email'
    return
  }
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
  const already = foundUser.value.isSuperAdmin
  const msg = already
    ? `「${foundUser.value.email}」已是 Super Admin，補登記到清單？`
    : `確定授予「${foundUser.value.email}」Super Admin 權限？`
  try {
    await ElMessageBox.confirm(msg, '授予 Super Admin', {
      confirmButtonText: already ? '補登記' : '授予',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  }
  catch { return }
  acting.value = true
  try {
    await apiFetch(`/api/admin/super/users/${foundUser.value.uid}/super-admin`, { method: 'POST' })
    showToast(already ? '已補登記到清單' : '已授予 Super Admin', 'success')
    foundUser.value = { ...foundUser.value, isSuperAdmin: true, inIndex: true }
    await loadAdmins()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  } finally {
    acting.value = false
  }
}

async function revokeByUid(uid: string, email: string) {
  try {
    await ElMessageBox.confirm(`確定撤銷「${email || uid}」的 Super Admin 權限？`, '撤銷確認', {
      confirmButtonText: '撤銷',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  }
  catch { return }
  acting.value = true
  try {
    await apiFetch(`/api/admin/super/users/${uid}/super-admin`, { method: 'DELETE' })
    showToast('已撤銷 Super Admin', 'success')
    if (foundUser.value?.uid === uid) {
      foundUser.value = { ...foundUser.value, isSuperAdmin: false, inIndex: false }
    }
    await loadAdmins()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  } finally {
    acting.value = false
  }
}
</script>
