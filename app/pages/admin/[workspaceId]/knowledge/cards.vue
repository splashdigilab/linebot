<template>
  <AdminSplitLayout :is-empty="!selectedChunk && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">📚 卡片管理</span>
      <div class="flex gap-1">
        <el-button size="small" plain @click="goSources">📁 來源</el-button>
        <el-button size="small" plain @click="goImport">📥 匯入</el-button>
        <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
      </div>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div class="kb-sidebar-filter">
        <el-input
          v-model="searchInput"
          size="small"
          placeholder="🔍 搜尋標題 / 內容 / 標籤"
          clearable
        />
        <div class="kb-sidebar-filter-row">
          <el-select v-model="filterStatus" size="small" placeholder="全部狀態" clearable @change="reloadList">
            <el-option label="全部狀態" value="" />
            <el-option label="可用" value="indexed" />
            <el-option label="處理中" value="pending" />
            <el-option label="失敗" value="failed" />
          </el-select>
          <el-select v-model="filterSourceId" size="small" placeholder="全部來源" clearable @change="reloadList">
            <el-option label="全部來源" value="" />
            <el-option label="✍️ 手打單張" value="__manual__" />
            <el-option
              v-for="src in sourceOptions"
              :key="src.id"
              :label="`${sourceTypeEmoji(src.type)} ${src.name || '(未命名)'}`"
              :value="src.id"
            />
          </el-select>
        </div>
        <p v-if="searchInput && filteredChunks.length < chunks.length" class="kb-search-hint">
          顯示 {{ filteredChunks.length }} / {{ chunks.length }} 張（在已載入的範圍內搜尋；往下捲可載入更多）
        </p>
      </div>

      <div v-if="loading && !chunks.length" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!chunks.length" class="split-sidebar-empty">
        <span>尚無知識卡</span>
        <p class="text-xs text-muted">新增一張卡來建立 AI 客服知識庫</p>
        <el-button size="small" type="primary" plain @click="openCreate">立即新增</el-button>
      </div>
      <div v-else-if="!filteredChunks.length" class="split-sidebar-empty">
        <span>沒有符合搜尋的卡</span>
        <p class="text-xs text-muted">試試別的關鍵字、或清空篩選</p>
      </div>
      <div v-else ref="listEl" class="split-list" @scroll.passive="onSidebarListScroll">
        <AdminSplitListItem
          v-for="chunk in filteredChunks"
          :key="chunk.id"
          :title="chunk.title || '(未命名)'"
          :active="selectedId === chunk.id"
          time-in-title-row
          title-row-chip
          :chip-text="statusLabel(chunk.status)"
          :chip-tone="statusTone(chunk.status)"
          :meta-text="metaForChunk(chunk)"
          :meta-truncate="true"
          @select="selectChunk(chunk)"
        />

        <div v-if="loadingMore" class="admin-sidebar-load-more">
          <div class="spinner" />
          <span>載入更多…</span>
        </div>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">📚</span>
      <h3>選擇一張卡開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立一張知識卡</p>
      <el-button type="primary" @click="openCreate">新增知識卡</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <AdminEditorHeaderTitle
        v-model="form.title"
        field-label="標題"
        create-prefix="新增知識卡:"
        placeholder="例：退換貨政策"
        caption="簡短的主題名稱；列表顯示用"
        :is-creating="isCreating"
        @enter="submitForm"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button
          v-if="!isCreating && selectedChunk && selectedChunk.status === 'failed'"
          @click="reindex"
          :loading="reindexing"
        >
          🔄 重新索引
        </el-button>
        <el-button v-if="!isCreating && selectedChunk" type="danger" @click="deleteChunk">
          🗑️ 刪除
        </el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立卡片' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <!-- Status section -->
        <div v-if="!isCreating && selectedChunk" class="message-card kb-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📍 索引狀態</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="kb-status-row">
              <span :class="['badge', `badge-${statusTone(selectedChunk.status)}`]">
                {{ statusLabel(selectedChunk.status) }}
              </span>
              <span v-if="lastIndexedAtLabel" class="text-xs text-muted">
                最後索引：{{ lastIndexedAtLabel }}
              </span>
            </div>
            <p v-if="selectedChunk.status === 'failed' && selectedChunk.failureReason" class="kb-failure-reason">
              失敗原因：{{ selectedChunk.failureReason }}
            </p>
            <p v-if="selectedChunk.status === 'pending'" class="kb-section-hint">
              背景索引中⋯ 約需 5–30 秒。儲存內容後狀態會自動更新。
            </p>
          </div>
        </div>

        <!-- Content section -->
        <div class="message-card kb-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📝 內容</span>
              <el-button
                size="small"
                plain
                :loading="normalizing"
                :disabled="!form.content.trim()"
                class="kb-normalize-btn"
                @click="normalizeContent"
              >
                ✨ AI 整理一下
              </el-button>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="kb-section-hint">
              這是「直接餵給 AI 參考」的文字。內容要完整、講人話；不要用條列或 markdown 格式。
              點「AI 整理一下」會自動加上「重點：…」摘要、移除品號等系統碼，提高 AI 檢索準確度。儲存後會自動重新索引。
            </p>
            <el-input
              v-model="form.content"
              type="textarea"
              :rows="10"
              maxlength="5000"
              show-word-limit
              placeholder="例：本店鑑賞期 7 天內可申請退換貨。退貨需保留商品原包裝與配件，不接受人為損壞商品⋯"
            />
          </div>
        </div>

        <!-- Tags section -->
        <div class="message-card kb-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🏷️ 標籤</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="kb-section-hint">標籤用於後台分類與篩選，不影響 AI 檢索結果。</p>
            <div class="kb-tag-row">
              <el-tag
                v-for="tag in form.tags"
                :key="tag"
                closable
                class="kb-tag"
                @close="removeTag(tag)"
              >
                {{ tag }}
              </el-tag>
              <el-input
                v-if="tagInputVisible"
                ref="tagInputEl"
                v-model="tagInput"
                size="small"
                class="kb-tag-input"
                @keydown.enter.prevent="commitTag"
                @blur="commitTag"
              />
              <el-button v-else size="small" plain class="kb-tag-add" @click="showTagInput">＋ 標籤</el-button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import type { KnowledgeChunkStatus } from '~~/shared/types/ai-knowledge'
import { KNOWLEDGE_CHUNK_STATUS_LABELS } from '~~/shared/types/ai-knowledge'

definePageMeta({ middleware: 'auth', layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const route = useRoute()

function goImport() {
  router.push(`/admin/${workspaceId.value}/knowledge/import`)
}

function goSources() {
  router.push(`/admin/${workspaceId.value}/knowledge/sources`)
}

interface ChunkRow {
  id: string
  workspaceId?: string
  title: string
  content: string
  tags: string[]
  status: KnowledgeChunkStatus
  failureReason?: string
  sourceId?: string | null
  sourceName?: string
  sourceType?: string
  manuallyEditedAt?: { seconds?: number; _seconds?: number } | null
  lastIndexedAt?: { seconds?: number; _seconds?: number } | null
  createdAt?: { seconds?: number; _seconds?: number } | null
  updatedAt?: { seconds?: number; _seconds?: number } | null
}

interface SourceOption {
  id: string
  name: string
  type: string
}

// ── State ─────────────────────────────────────────────────
// 進來時若帶 ?status=indexed|pending|failed，自動套用 filter（給 overview 的待辦連結用）
const initialStatus = (() => {
  const s = String(route.query.status ?? '').trim()
  return s === 'indexed' || s === 'pending' || s === 'failed' ? s : ''
})()
const filterStatus = ref(initialStatus)
const filterSourceId = ref('') // '' = all, '__manual__' = manual only, '<id>' = specific source
const searchInput = ref('') // client-side filter (title / content / tags substring)
const sourceOptions = ref<SourceOption[]>([])
const {
  items: chunks,
  loading,
  loadingMore,
  listEl,
  load: loadChunks,
  onScroll: onSidebarListScroll,
} = useWorkspaceSidebarList<ChunkRow>('/api/ai/knowledge/list', () => ({
  ...(filterStatus.value ? { status: filterStatus.value } : {}),
  ...(filterSourceId.value ? { sourceId: filterSourceId.value } : {}),
}))

const filteredChunks = computed(() => {
  const q = searchInput.value.trim().toLowerCase()
  if (!q) return chunks.value
  return chunks.value.filter((c) => {
    const haystack = `${c.title} ${c.content} ${(c.tags ?? []).join(' ')}`.toLowerCase()
    return haystack.includes(q)
  })
})

const saving = ref(false)
const reindexing = ref(false)
const normalizing = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const { showToast } = useAdminToast()

const defaultForm = () => ({ title: '', content: '', tags: [] as string[] })
const form = ref(defaultForm())
const { markClean, confirmLeaveIfDirty } = useUnsavedChanges({
  getSnapshot: () => form.value,
})

// ── Tag input ─────────────────────────────────────────────
const tagInputVisible = ref(false)
const tagInput = ref('')
const tagInputEl = ref<{ focus: () => void } | null>(null)

function showTagInput() {
  tagInputVisible.value = true
  nextTick(() => tagInputEl.value?.focus())
}

function commitTag() {
  const t = tagInput.value.trim()
  if (t && !form.value.tags.includes(t)) {
    form.value.tags = [...form.value.tags, t]
  }
  tagInput.value = ''
  tagInputVisible.value = false
}

function removeTag(tag: string) {
  form.value.tags = form.value.tags.filter(t => t !== tag)
}

function sourceTypeEmoji(type: string | undefined): string {
  if (type === 'url') return '🔗'
  if (type === 'file') return '📄'
  return '✍️'
}

function metaForChunk(chunk: ChunkRow): string {
  const parts: string[] = []
  if (chunk.sourceId && chunk.sourceName) {
    parts.push(`${sourceTypeEmoji(chunk.sourceType)} ${chunk.sourceName}`)
  }
  else if (chunk.sourceId) {
    parts.push(`${sourceTypeEmoji(chunk.sourceType)} (已刪除來源)`)
  }
  else {
    parts.push('✍️ 手打')
  }
  if (chunk.manuallyEditedAt) parts.push('🔒')
  parts.push(contentPreview(chunk.content))
  return parts.join(' · ')
}

// ── Computed ──────────────────────────────────────────────
const selectedChunk = computed(() => chunks.value.find(c => c.id === selectedId.value) ?? null)

const lastIndexedAtLabel = computed(() => {
  const ts = selectedChunk.value?.lastIndexedAt
  if (!ts) return ''
  const sec = ts.seconds ?? ts._seconds
  if (typeof sec !== 'number') return ''
  return new Date(sec * 1000).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

// ── Helpers ───────────────────────────────────────────────
function statusLabel(status: KnowledgeChunkStatus) {
  return KNOWLEDGE_CHUNK_STATUS_LABELS[status] ?? status
}

function statusTone(status: KnowledgeChunkStatus): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'indexed') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}

function contentPreview(text: string) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 60)}⋯` : t
}

// ── Load ─────────────────────────────────────────────────
async function reloadList() {
  await loadChunks(true)
}

async function loadSourceOptions() {
  try {
    const res = await apiFetch<{ items: Array<{ id: string; name: string; type: string }> }>('/api/ai/sources/list')
    sourceOptions.value = res.items.map(s => ({ id: s.id, name: s.name, type: s.type }))
  }
  catch { /* 拿不到就只顯示「全部 / 手打」兩個選項 */ }
}

onMounted(() => {
  loadChunks(true)
  loadSourceOptions()
  // K: 從 playground 點「編輯」按鈕進來時，自動選取對應的卡
  const targetChunkId = String(route.query.chunkId ?? '').trim()
  if (targetChunkId) tryAutoSelectChunk(targetChunkId)
})

async function tryAutoSelectChunk(chunkId: string) {
  // 先等第一頁 load 完
  let tries = 0
  while (tries < 20) {
    const found = chunks.value.find(c => c.id === chunkId)
    if (found) {
      selectChunk(found, { skipDiscardConfirm: true })
      return
    }
    if (!loadingMore.value && !loading.value) break // 沒在 load 還找不到 → 放棄
    await new Promise(r => setTimeout(r, 200))
    tries++
  }
}

// ── Select / Create ───────────────────────────────────────
function selectChunk(chunk: ChunkRow, opts?: { skipDiscardConfirm?: boolean }) {
  if (!opts?.skipDiscardConfirm && !confirmLeaveIfDirty()) return
  isCreating.value = false
  selectedId.value = chunk.id
  form.value = {
    title: chunk.title ?? '',
    content: chunk.content ?? '',
    tags: Array.isArray(chunk.tags) ? [...chunk.tags] : [],
  }
  markClean()
}

function openCreate() {
  if (!confirmLeaveIfDirty()) return
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
  markClean()
}

function cancelEdit() {
  if (!confirmLeaveIfDirty()) return
  if (selectedChunk.value) {
    selectChunk(selectedChunk.value, { skipDiscardConfirm: true })
    isCreating.value = false
  }
  else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
    markClean()
  }
}

// ── Save / Delete / Reindex ───────────────────────────────
async function submitForm() {
  const title = form.value.title.trim()
  const content = form.value.content.trim()
  if (!title) return showToast('請輸入標題', 'error')
  if (!content) return showToast('請輸入內容', 'error')
  if (content.length > 5000) return showToast('內容過長（上限 5000 字）', 'error')

  saving.value = true
  try {
    const body = { title, content, tags: form.value.tags }
    if (isCreating.value) {
      const res = await apiFetch<{ id: string; status: KnowledgeChunkStatus; failureReason?: string }>(
        '/api/ai/knowledge/create',
        { method: 'POST', body },
      )
      if (res.status === 'failed') {
        showToast(`已儲存，但索引失敗：${res.failureReason ?? '未知'}`, 'error')
      }
      else {
        showToast('知識卡已建立 ✅', 'success')
      }
      await loadChunks(true)
      const newChunk = chunks.value.find(c => c.id === res.id)
      if (newChunk) selectChunk(newChunk, { skipDiscardConfirm: true })
      isCreating.value = false
    }
    else if (selectedId.value) {
      const res = await apiFetch<{ status: KnowledgeChunkStatus; failureReason?: string }>(
        `/api/ai/knowledge/${selectedId.value}`,
        { method: 'PUT', body },
      )
      if (res.status === 'failed') {
        showToast(`已儲存，但索引失敗：${res.failureReason ?? '未知'}`, 'error')
      }
      else {
        showToast('知識卡已更新 ✅', 'success')
      }
      await loadChunks(true)
      markClean()
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || err?.message || '儲存失敗', 'error')
  }
  finally {
    saving.value = false
  }
}

async function deleteChunk() {
  if (!selectedId.value) return
  if (!confirm(`確定刪除「${form.value.title}」這張知識卡？刪除後 AI 將不會再引用此則。`)) return
  try {
    await apiFetch(`/api/ai/knowledge/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    isCreating.value = false
    form.value = defaultForm()
    markClean()
    await loadChunks(true)
  }
  catch {
    showToast('刪除失敗', 'error')
  }
}

async function reindex() {
  if (!selectedId.value) return
  reindexing.value = true
  try {
    await apiFetch(`/api/ai/knowledge/${selectedId.value}/reindex`, { method: 'POST' })
    showToast('已重新索引', 'success')
    await loadChunks(true)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '重新索引失敗', 'error')
  }
  finally {
    reindexing.value = false
  }
}

async function normalizeContent() {
  const original = form.value.content.trim()
  if (!original) return
  normalizing.value = true
  try {
    const res = await apiFetch<{ title: string; content: string; tags: string[] }>(
      '/api/ai/knowledge/normalize',
      {
        method: 'POST',
        body: {
          title: form.value.title,
          content: form.value.content,
          tags: form.value.tags,
        },
      },
    )
    form.value.title = res.title || form.value.title
    form.value.content = res.content
    form.value.tags = res.tags
    showToast('已整理 — 記得儲存 ✨', 'success')
  }
  catch (err: any) {
    showToast(err?.statusMessage || 'AI 整理失敗', 'error')
  }
  finally {
    normalizing.value = false
  }
}

</script>

<style scoped lang="scss">

.kb-sidebar-filter {
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 6px;
  :deep(.el-select) {
    width: 100%;
  }
}

.kb-sidebar-filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.kb-search-hint {
  margin: 0;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.kb-section-card {
  margin-bottom: 0; // gap 由 .admin-panel-stack 控制
}

.kb-normalize-btn {
  margin-left: auto;
}

.kb-section-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 8px;
}

.kb-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kb-failure-reason {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 4px 0 0;
}

.kb-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.kb-tag {
  margin: 0;
}

.kb-tag-input {
  width: 120px;
}

.kb-tag-add {
  font-size: 12px;
}
</style>
