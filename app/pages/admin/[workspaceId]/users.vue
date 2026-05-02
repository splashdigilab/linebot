<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="會員"
        title="👥 好友與標籤"
        caption="管理 LINE 好友，查看與操作會員標籤"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button size="small" type="primary" :loading="syncingLine" @click="syncFromLine">
          從 LINE 同步好友
        </el-button>
        <el-button size="small" @click="loadData">重新整理</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div v-if="selectedIds.length" class="users-batch-bar">
          <span class="users-batch-info">已選 {{ selectedIds.length }} 位</span>
          <el-button size="small" type="primary" @click="openBatchTag('add')">＋ 批次加標</el-button>
          <el-button size="small" @click="openBatchTag('remove')">－ 批次移標</el-button>
          <el-button size="small" text @click="selectedIds = []">取消選取</el-button>
        </div>

        <div class="message-card users-page-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔎 篩選與表格</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="users-toolbar">
              <div class="users-toolbar__field users-toolbar__field--search">
                <AdminFieldLabel text="搜尋顯示名稱" tight />
                <el-input v-model="searchText" placeholder="輸入關鍵字…" clearable />
              </div>
              <div class="users-toolbar__field users-toolbar__field--tags">
                <AdminFieldLabel text="篩選標籤（符合任一）" tight />
                <el-select
                  v-model="filterTagIds"
                  multiple
                  collapse-tags
                  placeholder="選擇標籤"
                  clearable
                >
                  <el-option
                    v-for="tag in allTags"
                    :key="tag.id"
                    :label="tag.name"
                    :value="tag.id"
                  >
                    <AdminTagOptionRow :label="tag.name" :color="tag.color" />
                  </el-option>
                </el-select>
              </div>
              <span class="tags-count text-muted">共 {{ filteredUsers.length }} 位</span>
            </div>
            <p class="users-sync-hint text-muted">
              清單來自資料庫：若只有「曾傳訊／按鈕／加好友後有觸發 Webhook」的帳號，請按上方「從 LINE 同步好友」以拉取官方好友名單（Messaging API
              <code class="users-sync-hint__code">/v2/bot/followers/ids</code>）。大量好友時會自動分批，可連按數次直到完成。
            </p>

            <div v-if="loading" class="tags-loading">
              <div class="spinner" />
              <span>載入中…</span>
            </div>
            <div v-else-if="!filteredUsers.length" class="tags-empty">
              <span>{{ allUsers.length ? '無符合條件的會員' : '尚無好友資料' }}</span>
            </div>
            <div v-else class="table-wrap">
              <table class="users-table">
                <thead>
                  <tr>
                    <th class="users-table__th--check">
                      <input
                        type="checkbox"
                        :checked="isAllSelected"
                        :indeterminate="isIndeterminate"
                        @change="toggleSelectAll"
                      />
                    </th>
                    <th>會員</th>
                    <th>加入時間</th>
                    <th class="users-table__th--actions">標籤操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="user in filteredUsers" :key="user.id">
                    <td>
                      <input
                        type="checkbox"
                        :checked="selectedIds.includes(user.id)"
                        @change="toggleSelect(user.id)"
                      />
                    </td>
                    <td>
                      <div class="user-identity">
                        <img
                          v-if="user.pictureUrl"
                          :src="user.pictureUrl"
                          class="user-avatar"
                          :alt="user.displayName"
                        />
                        <span v-else class="user-avatar-placeholder">👤</span>
                        <span class="user-name">{{ user.displayName || user.id }}</span>
                      </div>
                    </td>
                    <td class="td-time">{{ formatZhDateOnly(user.createdAt) }}</td>
                    <td>
                      <div class="td-actions">
                        <el-button size="small" @click="openUserTagDialog(user)">
                          標籤（{{ user.tags.length }}）
                        </el-button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <el-dialog
    v-model="batchDialogVisible"
    :title="batchMode === 'add' ? `批次加標（${selectedIds.length} 位）` : `批次移標（${selectedIds.length} 位）`"
    width="420px"
  >
    <div class="admin-field-stack">
      <div class="admin-field-group">
        <AdminFieldLabel :text="batchMode === 'add' ? '選擇要加上的標籤' : '選擇要移除的標籤'" tight />
        <el-select
          v-model="batchTagIds"
          multiple
          placeholder="選擇標籤"
          class="users-dialog-select"
        >
          <el-option v-for="tag in allTags" :key="tag.id" :label="tag.name" :value="tag.id">
            <AdminTagOptionRow :label="tag.name" :color="tag.color" />
          </el-option>
        </el-select>
      </div>
      <div class="admin-alert admin-alert--warn">
        <span>此操作將影響 <strong>{{ selectedIds.length }}</strong> 位會員</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="batchDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="batchSaving"
        :disabled="!batchTagIds.length"
        @click="submitBatch"
      >
        {{ batchMode === 'add' ? '確認加標' : '確認移標' }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="userTagDialogVisible"
    :title="`管理標籤：${dialogUser?.displayName ?? ''}`"
    width="480px"
    class="users-tag-dialog"
  >
    <div v-if="dialogUser" class="admin-field-stack">
      <div class="admin-field-group">
        <AdminFieldLabel text="目前標籤" tight />
        <div v-if="dialogUser.tags.length" class="user-tags-row">
          <AdminTagTintChip
            v-for="tag in dialogUser.tags"
            :key="tag.id"
            :color="tag.color"
          >
            {{ tag.name }}
            <button type="button" class="tag-chip-remove" @click="removeUserTag(dialogUser.id, tag.id)">✕</button>
          </AdminTagTintChip>
        </div>
        <span v-else class="text-muted text-sm">尚無標籤</span>
      </div>

      <div class="admin-field-group">
        <AdminFieldLabel text="加入標籤" tight />
        <div class="users-add-tag-row">
          <el-select
            v-model="addTagIds"
            multiple
            placeholder="選擇要加的標籤"
            class="users-add-tag-row__select"
          >
            <el-option
              v-for="tag in availableTagsForDialog"
              :key="tag.id"
              :label="tag.name"
              :value="tag.id"
            >
              <AdminTagOptionRow :label="tag.name" :color="tag.color" />
            </el-option>
          </el-select>
          <el-button
            type="primary"
            :loading="userTagSaving"
            :disabled="!addTagIds.length"
            @click="addUserTags"
          >
            加入
          </el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="userTagDialogVisible = false">關閉</el-button>
    </template>
  </el-dialog>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
import { formatZhDateOnly } from '~~/shared/firestore-date'

definePageMeta({ middleware: 'auth', layout: 'default' })

const { workspaceId, apiFetch } = useWorkspace()

const { users: allUsers, loading: usersLoading, loadUsers } = useAdminUserList()
const { tags: allTags, loading: tagsLoading, loadTags: loadTagOptions } = useAdminTagList()
const loading = computed(() => usersLoading.value || tagsLoading.value)

const searchText = ref('')
const filterTagIds = ref<string[]>([])
const selectedIds = ref<string[]>([])
const { toasts, showToast } = useAdminToast()

const batchDialogVisible = ref(false)
const batchMode = ref<'add' | 'remove'>('add')
const batchTagIds = ref<string[]>([])
const batchSaving = ref(false)

const userTagDialogVisible = ref(false)
const dialogUser = ref<any>(null)
const addTagIds = ref<string[]>([])
const userTagSaving = ref(false)
const syncingLine = ref(false)

const filteredUsers = computed(() => {
  let list = [...allUsers.value]
  if (filterTagIds.value.length) {
    list = list.filter((u) =>
      filterTagIds.value.some((tid) => u.tagIds?.includes(tid)),
    )
  }
  if (searchText.value.trim()) {
    const kw = searchText.value.toLowerCase()
    list = list.filter((u) => (u.displayName ?? '').toLowerCase().includes(kw))
  }
  return list
})

const isAllSelected = computed(
  () => filteredUsers.value.length > 0 && filteredUsers.value.every((u) => selectedIds.value.includes(u.id)),
)
const isIndeterminate = computed(
  () => !isAllSelected.value && filteredUsers.value.some((u) => selectedIds.value.includes(u.id)),
)

const availableTagsForDialog = computed(() => {
  if (!dialogUser.value) return allTags.value
  return allTags.value.filter((t) => !dialogUser.value.tagIds?.includes(t.id))
})

function toggleSelect(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx > -1) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = []
  }
  else {
    selectedIds.value = filteredUsers.value.map((u) => u.id)
  }
}

async function syncFromLine() {
  if (syncingLine.value) return
  syncingLine.value = true
  let offset = 0
  let totalProcessed = 0
  let lastRemaining = -1
  try {
    for (let round = 0; round < 25; round++) {
      const res = await apiFetch<{
        ok?: boolean
        lineFollowerTotal?: number
        offset?: number
        processed?: number
        remaining?: number
        profileFailures?: number
        created?: number
        updated?: number
        listTruncated?: boolean
      }>('/api/users/sync-from-line', {
        method: 'POST',
        body: { offset, maxFetchProfiles: 400 },
      })
      if (!res?.ok) {
        showToast('LINE 同步回傳異常', 'error')
        break
      }
      totalProcessed += res.processed ?? 0
      lastRemaining = res.remaining ?? 0
      offset += res.processed ?? 0
      if ((res.remaining ?? 0) <= 0) {
        const extra = (res.profileFailures ?? 0) > 0 ? `（${res.profileFailures} 位頭像／名稱未取得）` : ''
        showToast(
          `同步完成：官方好友 ${res.lineFollowerTotal ?? 0} 人，本次寫入 ${totalProcessed} 筆${extra}`,
          'success',
        )
        if (res.listTruncated) showToast('LINE 回傳的好友清單已達上限截斷，請洽開發者調高 maxIds', 'warning')
        await loadData()
        return
      }
    }
    if (lastRemaining > 0) {
      showToast(`已處理 ${totalProcessed} 筆，尚有約 ${lastRemaining} 位未寫入，請再按一次「從 LINE 同步好友」`, 'warning')
      await loadData()
    }
  }
  catch (e: any) {
    const msg = String(e?.data?.statusMessage || e?.message || e || '同步失敗')
    showToast(msg.length > 120 ? `${msg.slice(0, 120)}…` : msg, 'error')
  }
  finally {
    syncingLine.value = false
  }
}

async function loadData() {
  const [uOk, tOk] = await Promise.all([
    loadUsers({ limit: 500 }),
    loadTagOptions({ status: 'active' }),
  ])
  if (!uOk) showToast('載入會員失敗', 'error')
  if (!tOk) showToast('載入標籤失敗', 'error')
}

function openBatchTag(mode: 'add' | 'remove') {
  batchMode.value = mode
  batchTagIds.value = []
  batchDialogVisible.value = true
}

async function submitBatch() {
  if (!batchTagIds.value.length || !selectedIds.value.length) return
  batchSaving.value = true
  try {
    const endpoint = batchMode.value === 'add'
      ? '/api/user-tags/batch-add'
      : '/api/user-tags/batch-remove'

    const res = await apiFetch<{ added?: number; removed?: number }>(
      endpoint,
      { method: 'POST', body: { userIds: selectedIds.value, tagIds: batchTagIds.value } },
    )

    const count = res.added ?? res.removed ?? 0
    showToast(`完成！已影響 ${count} 筆紀錄 ✅`, 'success')
    batchDialogVisible.value = false
    selectedIds.value = []
    await loadData()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失敗', 'error')
  }
  finally {
    batchSaving.value = false
  }
}

function openUserTagDialog(user: any) {
  dialogUser.value = JSON.parse(JSON.stringify(user))
  addTagIds.value = []
  userTagDialogVisible.value = true
}

async function addUserTags() {
  if (!dialogUser.value || !addTagIds.value.length) return
  userTagSaving.value = true
  try {
    await apiFetch(`/api/users/${dialogUser.value.id}/tags`, {
      method: 'POST',
      body: { tagIds: addTagIds.value },
    })
    showToast('標籤已加入 ✅', 'success')
    addTagIds.value = []
    await loadData()
    const updated = allUsers.value.find((u) => u.id === dialogUser.value!.id)
    if (updated) dialogUser.value = JSON.parse(JSON.stringify(updated))
  }
  catch {
    showToast('加標失敗', 'error')
  }
  finally {
    userTagSaving.value = false
  }
}

async function removeUserTag(userId: string, tagId: string) {
  try {
    await apiFetch(`/api/users/${userId}/tags/${tagId}`, { method: 'DELETE' })
    showToast('標籤已移除', 'success')
    await loadData()
    const updated = allUsers.value.find((u) => u.id === userId)
    if (updated) dialogUser.value = JSON.parse(JSON.stringify(updated))
  }
  catch {
    showToast('移除失敗', 'error')
  }
}

onMounted(loadData)
</script>
