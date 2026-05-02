<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="標籤管理"
        title="🏷️ 標籤列表"
        caption="建立與管理會員標籤，用於分眾推播"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button type="primary" @click="openCreate">➕ 新增標籤</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card tags-page-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔎 篩選與表格</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="tags-toolbar">
              <div class="tags-toolbar__field tags-toolbar__field--search">
                <AdminFieldLabel text="搜尋（名稱或 code）" tight />
                <el-input v-model="searchText" placeholder="輸入關鍵字…" clearable />
              </div>
              <div class="tags-toolbar__field tags-toolbar__field--category">
                <AdminFieldLabel text="分類" tight />
                <el-select v-model="filterCategory" placeholder="全部" clearable>
                  <el-option
                    v-for="c in TAG_CATEGORY_OPTIONS"
                    :key="c.value"
                    :label="c.label"
                    :value="c.value"
                  />
                </el-select>
              </div>
              <div class="tags-toolbar__field tags-toolbar__field--status">
                <AdminFieldLabel text="狀態" tight />
                <el-select v-model="filterStatus" placeholder="全部" clearable>
                  <el-option label="啟用" value="active" />
                  <el-option label="停用" value="inactive" />
                </el-select>
              </div>
              <span class="tags-count text-muted">共 {{ filteredTags.length }} 筆</span>
            </div>

            <div v-if="loading" class="tags-loading">
              <div class="spinner" />
              <span>載入中…</span>
            </div>
            <div v-else-if="!filteredTags.length" class="tags-empty">
              <span>{{ tags.length ? '無符合的標籤' : '尚無任何標籤，請點擊右上角「新增標籤」開始' }}</span>
            </div>
            <div v-else class="table-wrap">
              <table class="tags-table">
                <thead>
                  <tr>
                    <th class="tags-table__th--swatch" />
                    <th>名稱</th>
                    <th>Code</th>
                    <th>分類</th>
                    <th>狀態</th>
                    <th>建立時間</th>
                    <th class="tags-table__th--actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tag in filteredTags" :key="tag.id">
                    <td>
                      <span class="tag-color-dot" :style="{ '--dot-bg': tag.color || '#6B7280' }" />
                    </td>
                    <td class="td-name">{{ tag.name }}</td>
                    <td class="td-code">{{ tag.code }}</td>
                    <td>
                      <span class="badge badge-gray">{{ tagCategoryLabel(tag.category) }}</span>
                    </td>
                    <td>
                      <span :class="tag.status === 'active' ? 'badge badge-green' : 'badge badge-gray'">
                        {{ tag.status === 'active' ? '啟用' : '停用' }}
                      </span>
                    </td>
                    <td class="td-time">{{ formatZhDateOnly(tag.createdAt) }}</td>
                    <td>
                      <div class="td-actions">
                        <el-button size="small" @click="openEdit(tag)">編輯</el-button>
                        <el-button
                          size="small"
                          :type="tag.status === 'active' ? 'danger' : 'default'"
                          @click="toggleStatus(tag)"
                        >
                          {{ tag.status === 'active' ? '停用' : '啟用' }}
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
    v-model="dialogVisible"
    :title="isEditing ? '編輯標籤' : '新增標籤'"
    width="480px"
    class="tags-dialog"
    :close-on-click-modal="false"
  >
    <el-form label-position="top" @submit.prevent>
      <div class="admin-field-stack">
        <div class="admin-field-group">
          <AdminFieldLabel text="Code（英文小寫+底線，建立後不可修改）" tight />
          <el-input
            v-model="form.code"
            :disabled="isEditing"
            placeholder="例如 interest_food、vip"
            maxlength="40"
          />
          <span class="tags-hint">只能使用英文小寫字母、數字、底線，並以英文開頭</span>
        </div>

        <div class="admin-field-group">
          <AdminFieldLabel text="顯示名稱（最多 30 字）" tight />
          <el-input v-model="form.name" placeholder="例如 美食愛好者" maxlength="30" />
        </div>

        <div class="admin-field-group">
          <AdminFieldLabel text="分類" tight />
          <el-select v-model="form.category" class="tags-dialog-select">
            <el-option
              v-for="c in TAG_CATEGORY_OPTIONS"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            />
          </el-select>
        </div>

        <div class="admin-field-group">
          <AdminFieldLabel text="標籤顏色" tight />
          <div class="tags-color-row">
            <button
              v-for="c in TAG_PRESET_COLORS"
              :key="c"
              type="button"
              class="tags-color-swatch"
              :class="{ active: form.color === c }"
              :style="{ '--swatch-bg': c }"
              @click="form.color = c"
            />
          </div>
        </div>

        <div class="admin-field-group">
          <AdminFieldLabel text="備註說明（選填）" tight />
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="供內部參考的補充說明"
            maxlength="200"
          />
        </div>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitForm">
        {{ isEditing ? '儲存變更' : '建立標籤' }}
      </el-button>
    </template>
  </el-dialog>

  <AdminToastStack :toasts="toasts" />
</template>

<script setup lang="ts">
import { formatZhDateOnly } from '~~/shared/firestore-date'
import { TAG_CATEGORY_OPTIONS, TAG_PRESET_COLORS, tagCategoryLabel } from '~~/shared/tag-admin'

definePageMeta({ middleware: 'auth', layout: 'default' })

const { workspaceId, apiFetch } = useWorkspace()
const { tags, loading, loadTags } = useAdminTagList()
const { toasts, showToast } = useAdminToast()

const saving = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const searchText = ref('')
const filterCategory = ref('')
const filterStatus = ref('')

const defaultForm = () => ({
  id: '',
  code: '',
  name: '',
  category: 'custom' as const,
  color: '#6B7280',
  description: '',
})
const form = ref(defaultForm())

const filteredTags = computed(() => {
  let list = [...tags.value]
  if (filterStatus.value) list = list.filter((t) => t.status === filterStatus.value)
  if (filterCategory.value) list = list.filter((t) => t.category === filterCategory.value)
  if (searchText.value.trim()) {
    const kw = searchText.value.toLowerCase()
    list = list.filter((t) => t.name?.toLowerCase().includes(kw) || t.code?.toLowerCase().includes(kw))
  }
  return list
})

async function refreshTags() {
  const ok = await loadTags(workspaceId.value)
  if (!ok) showToast('載入標籤失敗', 'error')
}

function openCreate() {
  isEditing.value = false
  form.value = defaultForm()
  dialogVisible.value = true
}

function openEdit(tag: any) {
  isEditing.value = true
  form.value = {
    id: tag.id,
    code: tag.code,
    name: tag.name,
    category: (tag.category ?? 'custom') as any,
    color: tag.color ?? '#6B7280',
    description: tag.description ?? '',
  }
  dialogVisible.value = true
}

async function toggleStatus(tag: any) {
  const next = tag.status === 'active' ? 'inactive' : 'active'
  const label = next === 'inactive' ? '停用' : '啟用'
  if (!confirm(`確定要${label}「${tag.name}」標籤嗎？`)) return
  try {
    await apiFetch(`/api/tag/${tag.id}`, { method: 'PUT', body: { status: next } })
    showToast(`已${label}標籤`, 'success')
    await refreshTags()
  }
  catch {
    showToast(`${label}失敗`, 'error')
  }
}

function validateForm(): string | null {
  if (!form.value.code.trim()) return '請填寫 Code'
  if (!/^[a-z][a-z0-9_]*$/.test(form.value.code)) return 'Code 格式錯誤（英文小寫開頭，可含數字與底線）'
  if (!form.value.name.trim()) return '請填寫顯示名稱'
  if (!form.value.category) return '請選擇分類'
  return null
}

async function submitForm() {
  const err = validateForm()
  if (err) return showToast(err, 'error')
  saving.value = true
  try {
    if (isEditing.value) {
      await apiFetch(`/api/tag/${form.value.id}`, {
        method: 'PUT',
        body: {
          name: form.value.name.trim(),
          category: form.value.category,
          color: form.value.color,
          description: form.value.description.trim(),
        },
      })
      showToast('標籤已更新 ✅', 'success')
    }
    else {
      await apiFetch('/api/tag/create', {
        method: 'POST',
        body: {
          code: form.value.code.trim(),
          name: form.value.name.trim(),
          category: form.value.category,
          color: form.value.color,
          description: form.value.description.trim(),
        },
      })
      showToast('標籤已建立 ✅', 'success')
    }
    dialogVisible.value = false
    await refreshTags()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

onMounted(refreshTags)
</script>
