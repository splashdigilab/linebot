<template>
  <AdminSplitLayout :is-empty="!selectedSource">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">📁 來源</span>
      <div class="flex gap-1">
        <el-button size="small" plain @click="openCreateManual">➕ 新增</el-button>
        <el-button size="small" type="primary" plain @click="goImport">📥 匯入</el-button>
      </div>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <!-- 偵測到 orphan chunks → 提示一鍵整理 -->
      <div v-if="orphanCount > 0" class="src-orphan-banner">
        <p class="src-orphan-msg">
          ⚠️ 偵測到 <strong>{{ orphanCount }}</strong> 張舊版未分組卡片
        </p>
        <p class="src-orphan-hint">
          舊版手寫單張卡沒被「來源」管理，整理後每張會變成一筆手寫條目顯示在下方。
        </p>
        <el-button
          size="small"
          type="primary"
          plain
          :loading="migrating"
          @click="migrateOrphans"
        >
          ✨ 一鍵整理
        </el-button>
      </div>

      <div v-if="loading && !sources.length" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!sources.length && !orphanCount" class="split-sidebar-empty">
        <span>沒有任何來源</span>
        <p class="text-xs text-muted">每個來源代表一份知識（PDF / 網址 / 手寫條目），AI 從這些來源裡找答案。</p>
        <div class="flex gap-1" style="margin-top:8px;">
          <el-button size="small" plain @click="openCreateManual">➕ 手寫</el-button>
          <el-button size="small" type="primary" plain @click="goImport">📥 匯入</el-button>
        </div>
      </div>
      <div v-else class="split-list">
        <!-- 文件 / 網址 來源（平鋪、永遠顯示） -->
        <template v-if="importedSources.length">
          <div class="src-group-header">
            <span>📄 文件 / 網址（{{ importedSources.length }}）</span>
          </div>
          <AdminSplitListItem
            v-for="src in importedSources"
            :key="src.id"
            :title="src.name || '(未命名)'"
            :active="selectedId === src.id"
            time-in-title-row
            title-row-chip
            :chip-text="statusChipText(src)"
            :chip-tone="statusChipTone(src)"
            :meta-text="metaText(src)"
            :meta-truncate="true"
            @select="selectSource(src)"
          />
        </template>

        <!-- 手寫條目（可摺疊；筆數 > 10 預設摺起來） -->
        <template v-if="manualSources.length">
          <button
            type="button"
            class="src-group-header src-group-header--toggle"
            @click="manualGroupOpen = !manualGroupOpen"
          >
            <span>
              <span class="src-group-arrow">{{ manualGroupOpen ? '▾' : '▸' }}</span>
              ✍️ 手寫條目（{{ manualSources.length }}）
            </span>
            <span v-if="!manualGroupOpen" class="src-group-hint">點此展開</span>
          </button>
          <template v-if="manualGroupOpen">
            <AdminSplitListItem
              v-for="src in manualSources"
              :key="src.id"
              :title="src.name || '(未命名)'"
              :active="selectedId === src.id"
              time-in-title-row
              title-row-chip
              :chip-text="statusChipText(src)"
              :chip-tone="statusChipTone(src)"
              :meta-text="metaText(src)"
              :meta-truncate="true"
              @select="selectSource(src)"
            />
          </template>
        </template>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">📁</span>
      <h3>選擇一個來源開始管理</h3>
      <p>或新增一筆手寫條目 / 匯入新的 PDF、網址</p>
      <div class="flex gap-2" style="margin-top:8px;">
        <el-button @click="openCreateManual">➕ 新增手寫</el-button>
        <el-button type="primary" @click="goImport">📥 匯入</el-button>
      </div>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div class="src-header">
        <div class="src-header-main">
          <span class="src-type-emoji">{{ typeEmoji(selectedSource?.type) }}</span>
          <div class="src-header-text">
            <h2 class="src-header-title">{{ selectedSource?.name || '(未命名來源)' }}</h2>
            <p v-if="selectedSource?.url" class="src-header-url">
              <a :href="selectedSource.url" target="_blank" rel="noopener">{{ selectedSource.url }}</a>
            </p>
          </div>
        </div>
      </div>
      <div class="flex gap-1 admin-header-actions">
        <el-button plain @click="renameSource">✏️ 重新命名</el-button>
        <el-button
          v-if="selectedSource?.type === 'url'"
          type="primary"
          plain
          :loading="resyncing"
          @click="startResync"
        >
          🔄 重新同步
        </el-button>
        <el-button type="danger" plain :loading="deleting" @click="deleteSource">
          🗑️ 刪除
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div v-if="selectedSource" class="solo-editor-body admin-panel-stack">
        <!-- 偵測到變動的提示 -->
        <el-alert
          v-if="selectedSource.outdatedAtMs > 0"
          type="warning"
          show-icon
          :closable="false"
          class="src-outdated-alert"
        >
          <template #title>
            ⚠️ 偵測到網頁內容變動 — {{ relativeTime(selectedSource.outdatedAtMs) }}
          </template>
          <div>
            最後一次自動偵測發現原始網址內容已改變，建議點上方「🔄 重新同步」檢視差異後決定要不要套用。
          </div>
        </el-alert>

        <!-- 基本資訊 -->
        <div class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📊 基本資訊</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="src-info-grid">
              <div><span class="src-label">類型</span><strong>{{ typeLabel(selectedSource.type) }}</strong></div>
              <div><span class="src-label">狀態</span><strong>{{ statusLabel(selectedSource.status) }}</strong></div>
              <div><span class="src-label">卡片數</span><strong>{{ selectedSource.chunkCount }}</strong></div>
              <div><span class="src-label">最後同步</span><strong>{{ selectedSource.lastFetchedAtMs ? relativeTime(selectedSource.lastFetchedAtMs) : '尚未同步' }}</strong></div>
            </div>
            <p v-if="selectedSource.failureReason" class="src-failure">
              失敗原因：{{ selectedSource.failureReason }}
            </p>
          </div>
        </div>

        <!-- 自動偵測設定（只給 URL） -->
        <div v-if="selectedSource.type === 'url'" class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⏰ 自動偵測變動</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="src-section-hint">
              排程會定期抓網頁內容、跟上次比對。**偵測到變動不會自動覆蓋**，會在這裡標一個提示等你進來看差異再決定。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="偵測頻率" tight />
              <el-select v-model="settingsForm.refreshIntervalMinutes" class="control-full">
                <el-option label="不偵測（手動 re-sync）" :value="0" />
                <el-option label="每小時" :value="60" />
                <el-option label="每天" :value="1440" />
                <el-option label="每週" :value="10080" />
                <el-option label="每月" :value="43200" />
              </el-select>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="偵測到變動時" tight />
              <el-radio-group v-model="settingsForm.onChangeBehavior">
                <el-radio value="notify">通知我（在來源頁掛 ⚠️ 提示）</el-radio>
                <el-radio value="log_only">只記錄不通知</el-radio>
              </el-radio-group>
            </div>
            <div class="src-settings-actions">
              <el-button
                type="primary"
                size="small"
                :loading="savingSettings"
                :disabled="!settingsDirty"
                @click="saveSettings"
              >
                儲存設定
              </el-button>
            </div>
          </div>
        </div>

        <!-- 旗下 chunks -->
        <div class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📝 卡片（{{ chunks.length }}）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p v-if="!chunks.length" class="text-muted">這個來源底下沒有卡片。</p>
            <div v-else class="src-chunk-list">
              <div
                v-for="c in chunks"
                :key="c.id"
                class="src-chunk-row"
              >
                <div class="src-chunk-main">
                  <span class="src-chunk-title">{{ c.title }}</span>
                  <span v-if="c.manuallyEditedAtMs > 0" class="src-chunk-lock" :title="`手動編輯過：${relativeTime(c.manuallyEditedAtMs)}`">🔒</span>
                </div>
                <span class="src-chunk-meta">{{ chunkStatusLabel(c.status) }} · {{ relativeTime(c.updatedAtMs) }}</span>
                <el-button size="small" plain @click="openEditChunk(c)">✏️ 編輯</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- ── Diff Modal ──────────────────────────────────── -->
  <el-dialog
    v-model="diffOpen"
    title="🔄 重新同步：差異預覽"
    width="900px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-if="diffData" class="diff-body">
      <p class="text-muted text-sm">
        已重新抓取網頁並用 LLM 切卡，請逐張決定要採用新版本還是保留舊版本。
        手動編輯過的卡（🔒）預設保留你的版本。
      </p>
      <div class="diff-summary">
        <span class="diff-summary-chip diff-summary-chip--add">🟢 新增 {{ diffData.diff.summary.added }}</span>
        <span class="diff-summary-chip diff-summary-chip--mod">🟡 修改 {{ diffData.diff.summary.modified }}</span>
        <span class="diff-summary-chip diff-summary-chip--rem">🔴 移除 {{ diffData.diff.summary.removed }}</span>
        <span class="diff-summary-chip diff-summary-chip--same">⚪ 未變 {{ diffData.diff.summary.unchanged }}</span>
      </div>

      <div class="diff-entries">
        <div
          v-for="entry in diffData.diff.entries"
          :key="entry.id"
          class="diff-entry"
          :class="`diff-entry--${entry.kind}`"
        >
          <div class="diff-entry-head">
            <span class="diff-entry-kind">{{ kindLabel(entry.kind) }}</span>
            <span class="diff-entry-title">{{ entry.newChunk?.title || entry.oldChunk?.title }}</span>
            <span v-if="entry.oldChunk?.manuallyEdited" class="diff-entry-lock">🔒 手動編輯過</span>
          </div>

          <!-- 內容對照 -->
          <div v-if="entry.kind === 'modified'" class="diff-entry-cols">
            <div class="diff-col diff-col--old">
              <div class="diff-col-head">舊版</div>
              <pre>{{ entry.oldChunk?.content }}</pre>
            </div>
            <div class="diff-col diff-col--new">
              <div class="diff-col-head">新版</div>
              <pre>{{ entry.newChunk?.content }}</pre>
            </div>
          </div>
          <div v-else-if="entry.kind === 'new'" class="diff-entry-single">
            <pre>{{ entry.newChunk?.content }}</pre>
          </div>
          <div v-else-if="entry.kind === 'removed'" class="diff-entry-single">
            <pre>{{ entry.oldChunk?.content }}</pre>
          </div>
          <!-- unchanged：不顯示內容，省版面 -->

          <!-- 動作選擇 -->
          <div class="diff-entry-actions">
            <el-radio-group v-model="decisions[entry.id]" size="small">
              <template v-if="entry.kind === 'new'">
                <el-radio-button value="add_new">➕ 新增</el-radio-button>
                <el-radio-button value="skip">⏭️ 略過</el-radio-button>
              </template>
              <template v-else-if="entry.kind === 'modified'">
                <el-radio-button value="use_new">🟡 用新版</el-radio-button>
                <el-radio-button value="keep_old">🔒 保留舊版</el-radio-button>
              </template>
              <template v-else-if="entry.kind === 'removed'">
                <el-radio-button value="delete_old">🗑️ 刪除</el-radio-button>
                <el-radio-button value="keep_old">🔒 保留</el-radio-button>
              </template>
              <template v-else>
                <el-radio-button value="keep_old">（無動作）</el-radio-button>
              </template>
            </el-radio-group>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="diffOpen = false">取消</el-button>
      <el-button
        type="primary"
        :loading="applying"
        :disabled="!diffData?.diff.entries.length"
        @click="applyDiff"
      >
        套用選取的變更
      </el-button>
    </template>
  </el-dialog>

  <!-- ── Chunk Edit Modal ───────────────────────────── -->
  <el-dialog
    v-model="chunkEditOpen"
    :title="chunkEditMode === 'create' ? '➕ 新增手寫條目' : '✏️ 編輯卡片'"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="chunk-form">
      <div class="admin-field-group">
        <AdminFieldLabel text="標題" tight />
        <el-input
          v-model="chunkForm.title"
          maxlength="100"
          show-word-limit
          placeholder="例：退換貨政策"
        />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="內容" tight />
        <el-input
          v-model="chunkForm.content"
          type="textarea"
          :rows="10"
          :maxlength="5000"
          show-word-limit
          placeholder="把這條的完整資訊寫進來，AI 會用整段當回答依據。"
        />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="標籤（非必填，後台分類用）" tight />
        <div class="chunk-tag-row">
          <el-tag
            v-for="t in chunkForm.tags"
            :key="t"
            closable
            class="chunk-tag"
            @close="removeChunkTag(t)"
          >{{ t }}</el-tag>
          <el-input
            v-if="chunkTagInputVisible"
            ref="chunkTagInputEl"
            v-model="chunkTagInput"
            size="small"
            style="width: 120px;"
            @keydown.enter.prevent="commitChunkTag"
            @blur="commitChunkTag"
          />
          <el-button v-else size="small" plain @click="showChunkTagInput">＋</el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="chunk-footer">
        <el-button
          v-if="chunkEditMode === 'edit'"
          type="danger"
          plain
          :loading="chunkDeleting"
          :disabled="chunkSaving"
          @click="deleteChunkFromModal"
        >
          🗑️ 刪除
        </el-button>
        <div class="chunk-footer-right">
          <el-button @click="chunkEditOpen = false">取消</el-button>
          <el-button
            type="primary"
            :loading="chunkSaving"
            :disabled="chunkDeleting || !chunkForm.title.trim() || !chunkForm.content.trim()"
            @click="saveChunk"
          >
            {{ chunkEditMode === 'create' ? '建立' : '儲存' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'

definePageMeta({ middleware: 'auth', layout: 'default' })

type SourceType = 'file' | 'url' | 'manual'
type SourceStatus = 'fetching' | 'splitting' | 'ready' | 'failed'

interface SourceSummary {
  id: string
  type: SourceType
  name: string
  url: string
  status: SourceStatus
  failureReason?: string
  chunkCount: number
  refreshIntervalMinutes: number
  onChangeBehavior: 'notify' | 'log_only'
  lastFetchedAtMs: number
  outdatedAtMs: number
  updatedAtMs: number
}

interface ChunkRow {
  id: string
  title: string
  content: string
  tags: string[]
  status: string
  manuallyEditedAtMs: number
  updatedAtMs: number
}

interface DiffEntry {
  id: string
  kind: 'new' | 'modified' | 'removed' | 'unchanged'
  defaultAction: 'add_new' | 'use_new' | 'keep_old' | 'delete_old' | 'skip'
  oldChunk?: {
    id: string
    title: string
    content: string
    tags: string[]
    manuallyEdited: boolean
  }
  newChunk?: { title: string; content: string; tags: string[] }
}

interface DiffData {
  sourceId: string
  sourceName: string
  sourceUrl: string
  diff: {
    entries: DiffEntry[]
    summary: { added: number; modified: number; removed: number; unchanged: number }
  }
}

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const { showToast } = useAdminToast()

const sources = ref<SourceSummary[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const selectedSource = computed(() => sources.value.find(s => s.id === selectedId.value) ?? null)

// orphan chunks（sourceId === null）— 給「整理舊資料」橫幅用
const orphanCount = ref(0)
const migrating = ref(false)

// 分組顯示：file / url 平鋪 + manual 摺疊
const importedSources = computed(() => sources.value.filter(s => s.type === 'file' || s.type === 'url'))
const manualSources = computed(() => sources.value.filter(s => s.type === 'manual'))
// 手寫條目 > 10 筆預設摺起來（不然會把整個列表淹掉）
const manualGroupOpen = ref(true)
watch(manualSources, (list) => {
  if (list.length > 10) manualGroupOpen.value = false
}, { immediate: false })

const chunks = ref<ChunkRow[]>([])

const settingsForm = ref({ refreshIntervalMinutes: 0, onChangeBehavior: 'notify' as 'notify' | 'log_only' })
const settingsBaseline = ref({ refreshIntervalMinutes: 0, onChangeBehavior: 'notify' as 'notify' | 'log_only' })
const settingsDirty = computed(() =>
  settingsForm.value.refreshIntervalMinutes !== settingsBaseline.value.refreshIntervalMinutes
  || settingsForm.value.onChangeBehavior !== settingsBaseline.value.onChangeBehavior,
)
const savingSettings = ref(false)
const deleting = ref(false)

const resyncing = ref(false)
const applying = ref(false)
const diffOpen = ref(false)
const diffData = ref<DiffData | null>(null)
const decisions = ref<Record<string, string>>({})

// ── Chunk edit / create modal ───────────────────────
const chunkEditOpen = ref(false)
const chunkEditMode = ref<'create' | 'edit'>('create')
const chunkEditingId = ref<string | null>(null) // edit 模式才有值
const chunkForm = ref({ title: '', content: '', tags: [] as string[] })
const chunkSaving = ref(false)
const chunkDeleting = ref(false)
const chunkTagInput = ref('')
const chunkTagInputVisible = ref(false)
const chunkTagInputEl = ref<{ focus: () => void } | null>(null)

async function loadSources() {
  loading.value = true
  try {
    const res = await apiFetch<{ items: SourceSummary[]; orphanCount?: number }>('/api/ai/sources/list')
    sources.value = res.items
    orphanCount.value = Number(res.orphanCount ?? 0)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '載入來源失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

async function selectSource(src: SourceSummary) {
  selectedId.value = src.id
  await loadSourceDetail(src.id)
}

async function loadSourceDetail(sourceId: string) {
  try {
    const res = await apiFetch<{ source: SourceSummary; chunks: ChunkRow[] }>(`/api/ai/sources/${sourceId}`)
    // 用最新的 source 覆寫 list 裡的同一筆，保證 detail 不過時
    const idx = sources.value.findIndex(s => s.id === sourceId)
    if (idx >= 0) sources.value[idx] = res.source
    chunks.value = res.chunks
    settingsForm.value = {
      refreshIntervalMinutes: res.source.refreshIntervalMinutes,
      onChangeBehavior: res.source.onChangeBehavior,
    }
    settingsBaseline.value = { ...settingsForm.value }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '載入細節失敗', 'error')
  }
}

async function saveSettings() {
  if (!selectedId.value) return
  savingSettings.value = true
  try {
    await apiFetch(`/api/ai/sources/${selectedId.value}`, {
      method: 'PUT',
      body: { ...settingsForm.value },
    })
    settingsBaseline.value = { ...settingsForm.value }
    showToast('已儲存設定', 'success')
    await loadSourceDetail(selectedId.value)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    savingSettings.value = false
  }
}

async function deleteSource() {
  if (!selectedSource.value) return
  const src = selectedSource.value

  // 二次確認：使用者必須在輸入框打「刪除」兩個字才能繼續，避免誤刪
  try {
    await ElMessageBox.prompt(
      `要刪除「${src.name}」這個來源，會連同底下 ${src.chunkCount} 張卡片全部刪除，無法復原。\n\n請在下方輸入「刪除」確認：`,
      '⚠️ 刪除確認',
      {
        confirmButtonText: '永久刪除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        inputPattern: /^刪除$/,
        inputErrorMessage: '請輸入「刪除」兩個字',
        inputPlaceholder: '刪除',
        type: 'warning',
        roundButton: true,
      },
    )
  }
  catch {
    return // 使用者取消或關閉
  }

  deleting.value = true
  try {
    await apiFetch(`/api/ai/sources/${selectedId.value}`, { method: 'DELETE' })
    showToast(`已刪除「${src.name}」`, 'success')
    selectedId.value = null
    chunks.value = []
    await loadSources()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '刪除失敗', 'error')
  }
  finally {
    deleting.value = false
  }
}

async function startResync() {
  if (!selectedId.value) return
  resyncing.value = true
  try {
    const res = await apiFetch<DiffData>(`/api/ai/sources/${selectedId.value}/resync-preview`, {
      method: 'POST',
      body: {},
    })
    diffData.value = res
    // 用後端 defaultAction 初始化使用者決定
    const init: Record<string, string> = {}
    for (const e of res.diff.entries) init[e.id] = e.defaultAction
    decisions.value = init
    diffOpen.value = true
  }
  catch (err: any) {
    showToast(err?.statusMessage || '取得差異失敗', 'error')
  }
  finally {
    resyncing.value = false
  }
}

async function applyDiff() {
  if (!diffData.value || !selectedId.value) return
  applying.value = true
  try {
    const res = await apiFetch<{ added: number; updated: number; deleted: number; kept: number; errors: any[] }>(
      `/api/ai/sources/${selectedId.value}/resync-apply`,
      {
        method: 'POST',
        body: {
          entries: diffData.value.diff.entries,
          decisions: decisions.value,
        },
      },
    )
    const errTail = res.errors?.length ? `；失敗 ${res.errors.length} 張（看 console）` : ''
    showToast(`已套用：新增 ${res.added}、更新 ${res.updated}、刪除 ${res.deleted}、保留 ${res.kept}${errTail}`, res.errors?.length ? 'warning' : 'success')
    if (res.errors?.length) console.warn('[resync-apply] errors:', res.errors)
    diffOpen.value = false
    diffData.value = null
    await loadSources()
    if (selectedId.value) await loadSourceDetail(selectedId.value)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '套用失敗', 'error')
  }
  finally {
    applying.value = false
  }
}

function goImport() { router.push(`/admin/${workspaceId.value}/knowledge/import`) }

// ── 一鍵整理舊版未分組卡片 ───────────────────────────
async function migrateOrphans() {
  migrating.value = true
  try {
    const res = await apiFetch<{ migrated: number; capped: boolean }>(
      '/api/ai/sources/migrate-orphans',
      { method: 'POST', body: {} },
    )
    const tail = res.capped ? '（達單次上限 200，剩下的請再點一次）' : ''
    showToast(`已整理 ${res.migrated} 張舊卡為手寫條目${tail}`, 'success')
    await loadSources()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '整理失敗', 'error')
  }
  finally {
    migrating.value = false
  }
}

// ── 重新命名（用 ElMessageBox.prompt） ───────────────
async function renameSource() {
  if (!selectedSource.value) return
  const current = selectedSource.value.name
  try {
    const { value } = await ElMessageBox.prompt('輸入新名稱：', '✏️ 重新命名來源', {
      confirmButtonText: '儲存',
      cancelButtonText: '取消',
      inputValue: current,
      inputPattern: /^.{1,200}$/,
      inputErrorMessage: '名稱長度需 1–200 字',
    })
    const newName = String(value ?? '').trim()
    if (!newName || newName === current) return
    await apiFetch(`/api/ai/sources/${selectedId.value}`, {
      method: 'PUT',
      body: { name: newName },
    })
    showToast('已重新命名', 'success')
    await loadSources()
    if (selectedId.value) await loadSourceDetail(selectedId.value)
  }
  catch { /* 使用者取消 */ }
}

// ── 新增手寫條目 ─────────────────────────────────────
function openCreateManual() {
  chunkEditMode.value = 'create'
  chunkEditingId.value = null
  chunkForm.value = { title: '', content: '', tags: [] }
  chunkEditOpen.value = true
}

// ── 編輯既有 chunk ───────────────────────────────────
function openEditChunk(chunk: ChunkRow) {
  chunkEditMode.value = 'edit'
  chunkEditingId.value = chunk.id
  chunkForm.value = {
    title: chunk.title,
    content: chunk.content,
    tags: [...(chunk.tags ?? [])],
  }
  chunkEditOpen.value = true
}

async function saveChunk() {
  const t = chunkForm.value.title.trim()
  const c = chunkForm.value.content.trim()
  if (!t || !c) return
  chunkSaving.value = true
  try {
    if (chunkEditMode.value === 'create') {
      // 建立新手寫條目（後端會自動建一個 type='manual' 的 source 包它）
      const res = await apiFetch<{ id: string; sourceId: string }>('/api/ai/knowledge/create', {
        method: 'POST',
        body: { title: t, content: c, tags: chunkForm.value.tags },
      })
      showToast('已建立', 'success')
      chunkEditOpen.value = false
      await loadSources()
      if (res.sourceId) {
        selectedId.value = res.sourceId
        await loadSourceDetail(res.sourceId)
      }
    }
    else if (chunkEditingId.value) {
      await apiFetch(`/api/ai/knowledge/${chunkEditingId.value}`, {
        method: 'PUT',
        body: { title: t, content: c, tags: chunkForm.value.tags },
      })
      showToast('已儲存', 'success')
      chunkEditOpen.value = false
      if (selectedId.value) await loadSourceDetail(selectedId.value)
      await loadSources() // 因為 manual source 名稱可能跟著變
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    chunkSaving.value = false
  }
}

async function deleteChunkFromModal() {
  if (chunkEditMode.value !== 'edit' || !chunkEditingId.value) return
  const title = chunkForm.value.title || '(未命名)'
  try {
    await ElMessageBox.confirm(
      `要刪除「${title}」這張卡片嗎？無法復原。`,
      '🗑️ 刪除卡片',
      {
        confirmButtonText: '刪除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    )
  }
  catch { return }
  const targetId = chunkEditingId.value
  chunkDeleting.value = true
  try {
    await apiFetch(`/api/ai/knowledge/${targetId}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    chunkEditOpen.value = false
    // 若這張是 manual single-card source 的唯一卡，後端會連 source 一起刪 → 重載 source list
    await loadSources()
    if (selectedId.value) {
      const stillExists = sources.value.find(s => s.id === selectedId.value)
      if (stillExists) await loadSourceDetail(selectedId.value)
      else selectedId.value = null
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '刪除失敗', 'error')
  }
  finally {
    chunkDeleting.value = false
  }
}

// ── Chunk tag input ─────────────────────────────────
function showChunkTagInput() {
  chunkTagInputVisible.value = true
  nextTick(() => chunkTagInputEl.value?.focus())
}
function commitChunkTag() {
  const t = chunkTagInput.value.trim()
  if (t && !chunkForm.value.tags.includes(t)) {
    chunkForm.value.tags = [...chunkForm.value.tags, t]
  }
  chunkTagInput.value = ''
  chunkTagInputVisible.value = false
}
function removeChunkTag(t: string) {
  chunkForm.value.tags = chunkForm.value.tags.filter(x => x !== t)
}

// ─── Display helpers ───────────────────────────────────
function typeEmoji(t: string | undefined) {
  return t === 'url' ? '🔗' : t === 'file' ? '📄' : '✍️'
}
function typeLabel(t: string) {
  return t === 'url' ? '網址' : t === 'file' ? '檔案' : '手打'
}
function statusLabel(s: string) {
  return s === 'ready' ? '可用' : s === 'fetching' ? '抓取中' : s === 'splitting' ? '切卡中' : '失敗'
}
function chunkStatusLabel(s: string) {
  return s === 'indexed' ? '可用' : s === 'pending' ? '處理中' : '失敗'
}
function statusChipText(src: SourceSummary) {
  if (src.outdatedAtMs > 0) return '⚠️ 有變動'
  if (src.status === 'ready') return '可用'
  return statusLabel(src.status)
}
function statusChipTone(src: SourceSummary): 'success' | 'warning' | 'error' | 'neutral' {
  if (src.outdatedAtMs > 0) return 'warning'
  if (src.status === 'ready') return 'success'
  if (src.status === 'failed') return 'error'
  return 'neutral'
}
function metaText(src: SourceSummary) {
  const parts: string[] = []
  parts.push(`${src.chunkCount} 張卡`)
  if (src.lastFetchedAtMs) parts.push(`同步：${relativeTime(src.lastFetchedAtMs)}`)
  return parts.join(' · ')
}
function kindLabel(k: string) {
  return k === 'new' ? '🟢 新增' : k === 'modified' ? '🟡 修改' : k === 'removed' ? '🔴 移除' : '⚪ 未變'
}
function relativeTime(ms: number) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`
  return new Date(ms).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

onMounted(() => loadSources())
</script>

<style scoped lang="scss">

// ─── Orphan migration banner ─────────────────────
.src-orphan-banner {
  margin: 10px 12px;
  padding: 10px 12px;
  background: var(--el-color-warning-light-9);
  border-left: 3px solid var(--el-color-warning);
  border-radius: 4px;
  font-size: 13px;
}
.src-orphan-msg { margin: 0 0 4px; }
.src-orphan-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

// ─── Source group headers ───────────────────────
.src-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 14px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: none;
  background: none;
  border: none;
  text-align: left;
}
.src-group-header--toggle {
  cursor: pointer;
  &:hover { color: var(--el-text-color-primary); }
}
.src-group-arrow {
  display: inline-block;
  width: 12px;
  font-size: 10px;
}
.src-group-hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--el-text-color-disabled);
}

.src-header {
  flex: 1;
  min-width: 0;
}
.src-header-main { display: flex; gap: 12px; align-items: center; }
.src-type-emoji { font-size: 28px; }
.src-header-title { margin: 0; font-size: 17px; }
.src-header-url { margin: 2px 0 0; font-size: 12px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 600px;
  a { color: inherit; }
}

.src-section-card { margin-bottom: 0; } // gap 由 .admin-panel-stack 控制
.src-section-hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 0 0 8px; }

.src-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  > div {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }
}
.src-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}
.src-failure {
  margin: 8px 0 0;
  padding: 8px 10px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border-radius: 4px;
  font-size: 13px;
}

.src-settings-actions { margin-top: 8px; }

.src-chunk-list { display: flex; flex-direction: column; gap: 6px; }
.src-chunk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.src-chunk-main { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.src-chunk-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-chunk-lock { font-size: 12px; }
.src-chunk-meta { font-size: 12px; color: var(--el-text-color-secondary); }

.src-outdated-alert { margin-bottom: 12px; }

// ─── Diff modal ──────────────────────────────────
.diff-body {
  max-height: 70vh;
  overflow-y: auto;
}
.diff-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0 16px;
}
.diff-summary-chip {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--el-fill-color);
  &--add { background: var(--el-color-success-light-9); color: var(--el-color-success); }
  &--mod { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
  &--rem { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
  &--same { color: var(--el-text-color-secondary); }
}

.diff-entries { display: flex; flex-direction: column; gap: 12px; }
.diff-entry {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--el-bg-color);
  &--new { border-left: 3px solid var(--el-color-success); }
  &--modified { border-left: 3px solid var(--el-color-warning); }
  &--removed { border-left: 3px solid var(--el-color-danger); }
  &--unchanged { opacity: 0.6; }
}

.diff-entry-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.diff-entry-kind { font-size: 12px; font-weight: 600; }
.diff-entry-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.diff-entry-lock { font-size: 12px; color: var(--el-text-color-secondary); }

.diff-entry-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}
.diff-col {
  padding: 8px 10px;
  border-radius: 4px;
  &--old { background: var(--el-color-danger-light-9); }
  &--new { background: var(--el-color-success-light-9); }
}
.diff-col-head { font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--el-text-color-secondary); }
.diff-col pre, .diff-entry-single pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
  max-height: 200px;
  overflow-y: auto;
}
.diff-entry-single {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.diff-entry-actions { margin-top: 10px; }

// ─── Chunk edit / create modal ────────────────────
.chunk-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chunk-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chunk-tag { margin: 0; }

.chunk-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.chunk-footer-right { display: flex; gap: 8px; }
</style>
