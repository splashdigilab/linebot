<template>
  <AdminSplitLayout solo>
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="知識庫"
        title="📥 上傳 / 匯入"
        caption="把 PDF、Excel、網址或一大段文字交給 AI 切成知識卡"
      />
      <div class="flex gap-1 admin-header-actions">
        <el-button @click="goBackToList">← 回到清單</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <!-- ── Step 1：選來源 ─────────────────────────── -->
        <div v-if="step === 'input'" class="message-card kb-import-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">1️⃣ 選擇來源</span>
            </div>
          </div>
          <div class="card-section-stack">
            <el-tabs v-model="mode" class="kb-import-tabs">
              <el-tab-pane label="📄 檔案" name="file">
                <p class="kb-section-hint">支援 PDF、Excel（.xlsx / .xls）。單檔上限 10MB。</p>
                <div class="kb-file-zone">
                  <input
                    ref="fileInputEl"
                    type="file"
                    accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    class="kb-file-input"
                    @change="onFileChosen"
                  >
                  <el-button type="primary" plain @click="fileInputEl?.click()">選擇檔案</el-button>
                  <span v-if="fileName" class="kb-file-name">{{ fileName }}（{{ fileSizeKb }} KB）</span>
                  <span v-else class="text-muted">尚未選擇檔案</span>
                </div>
              </el-tab-pane>

              <el-tab-pane label="🔗 網址" name="url">
                <p class="kb-section-hint">系統會抓取網頁文字（不破解防爬／不渲染 JS）。若抓不到請改用上傳檔案。</p>
                <el-input
                  v-model="urlInput"
                  placeholder="https://example.com/faq"
                  clearable
                />
              </el-tab-pane>

              <el-tab-pane label="✍️ 手打" name="text">
                <p class="kb-section-hint">貼一大段文字（最多 100,000 字），由 AI 幫你切成多張卡。</p>
                <el-input
                  v-model="textInput"
                  type="textarea"
                  :rows="10"
                  :maxlength="100000"
                  show-word-limit
                  placeholder="把你的客服 FAQ 或政策原文貼這裡..."
                />
              </el-tab-pane>
            </el-tabs>

            <div class="kb-import-actions">
              <el-button
                type="primary"
                :loading="previewing"
                :disabled="!canPreview"
                @click="runPreview"
              >
                {{ previewing ? 'AI 切卡中⋯' : '🪄 預覽切卡' }}
              </el-button>
              <span v-if="previewing" class="text-muted text-xs">
                Gemini 正在分析內容、預估 5–15 秒
              </span>
            </div>
          </div>
        </div>

        <!-- ── Step 2：預覽 + 編輯 ─────────────────────────── -->
        <div v-if="step === 'preview'" class="message-card kb-import-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">2️⃣ 預覽切卡結果</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="kb-section-hint">
              AI 偵測到 <strong>{{ chunks.length }}</strong> 張卡片。
              <span v-if="truncated" class="kb-warning"> ⚠️ 原文超過 10 萬字已截斷，可能漏掉後半部。</span>
              <span v-else>勾選要匯入的、可直接編輯內容；確認後一鍵建立。</span>
            </p>

            <el-alert
              v-if="existingMatches.length"
              type="warning"
              show-icon
              :closable="false"
              class="kb-dedup-warning"
            >
              <template #title>
                ⚠️ 已存在 {{ existingMatches.length }} 個同名來源
              </template>
              <div class="kb-dedup-body">
                <p class="text-xs">繼續建立會在來源列表出現多筆同名項目，可能不是你想要的。</p>
                <ul class="kb-dedup-list">
                  <li v-for="m in existingMatches" :key="m.id">
                    「{{ m.name }}」（{{ m.chunkCount }} 張卡，{{ relativeTime(m.updatedAtMs) || '未更新' }}）
                  </li>
                </ul>
                <div class="kb-dedup-actions">
                  <el-button size="small" @click="goManageSources">📁 去管理現有來源</el-button>
                  <el-button size="small" plain @click="step = 'input'">取消、改其它名稱</el-button>
                </div>
              </div>
            </el-alert>

            <div class="kb-bulk-actions">
              <el-button size="small" plain @click="selectAll">全選</el-button>
              <el-button size="small" plain @click="selectNone">全不選</el-button>
              <span class="text-muted text-xs">已選 {{ includedCount }} / {{ chunks.length }}</span>
            </div>

            <div class="kb-chunk-list">
              <div
                v-for="(chunk, idx) in chunks"
                :key="idx"
                class="kb-chunk-row"
                :class="{ 'kb-chunk-row--excluded': !chunk.included }"
              >
                <div class="kb-chunk-checkbox">
                  <el-checkbox v-model="chunk.included" />
                </div>
                <div class="kb-chunk-content">
                  <el-input
                    v-model="chunk.title"
                    placeholder="標題"
                    size="small"
                    class="kb-chunk-title"
                  />
                  <el-input
                    v-model="chunk.content"
                    type="textarea"
                    :rows="3"
                    placeholder="內容"
                    class="kb-chunk-textarea"
                  />
                  <div class="kb-chunk-tags">
                    <el-tag
                      v-for="tag in chunk.tags"
                      :key="tag"
                      size="small"
                      closable
                      @close="removeTag(chunk, tag)"
                    >
                      {{ tag }}
                    </el-tag>
                    <el-input
                      v-if="editingTagIdx === idx"
                      ref="tagInputRef"
                      v-model="tagInput"
                      size="small"
                      class="kb-tag-input"
                      @keydown.enter.prevent="commitTag(chunk)"
                      @blur="commitTag(chunk)"
                    />
                    <el-button v-else size="small" plain @click="startAddTag(idx)">＋</el-button>
                  </div>
                </div>
              </div>
            </div>

            <div class="kb-import-actions">
              <el-button @click="step = 'input'">← 重新切片</el-button>
              <el-button
                type="primary"
                :loading="importing"
                :disabled="includedCount === 0"
                @click="runImport"
              >
                {{ importing ? '匯入並索引中⋯' : `✅ 確認匯入 ${includedCount} 張` }}
              </el-button>
            </div>
          </div>
        </div>

        <!-- ── Step 3：結果 ─────────────────────────── -->
        <div v-if="step === 'result' && result" class="message-card kb-import-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">3️⃣ 匯入結果</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="kb-result-summary">
              <div class="kb-result-stat">
                <span class="kb-result-label">總計</span>
                <strong>{{ result.total }}</strong>
              </div>
              <div class="kb-result-stat kb-result-stat--success">
                <span class="kb-result-label">已索引</span>
                <strong>{{ result.indexed }}</strong>
              </div>
              <div class="kb-result-stat" :class="result.failed ? 'kb-result-stat--danger' : ''">
                <span class="kb-result-label">失敗</span>
                <strong>{{ result.failed }}</strong>
              </div>
            </div>

            <div v-if="result.failed > 0" class="kb-result-failed-list">
              <p class="kb-section-hint">以下卡片建立但索引失敗，可到清單頁手動重試：</p>
              <ul class="kb-failed-list">
                <li v-for="item in failedItems" :key="item.id">
                  <strong>{{ item.title }}</strong>
                  <span class="text-muted text-xs">— {{ item.failureReason ?? '未知原因' }}</span>
                </li>
              </ul>
            </div>

            <div class="kb-import-actions">
              <el-button @click="resetAll">📥 繼續匯入</el-button>
              <el-button type="primary" @click="goBackToList">回到知識庫清單</el-button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

const { apiFetch, workspaceId } = useWorkspace()
const router = useRouter()
const { showToast } = useAdminToast()

type ImportMode = 'file' | 'url' | 'text'
type Step = 'input' | 'preview' | 'result'

const step = ref<Step>('input')
const mode = ref<ImportMode>('file')

// ── File ──────────────────────────────────────────────────
const fileInputEl = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const fileSizeKb = ref(0)
const fileBase64 = ref('')
const fileContentType = ref('')

async function onFileChosen(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    showToast('檔案超過 10MB 上限', 'error')
    target.value = ''
    return
  }
  fileName.value = file.name
  fileSizeKb.value = Math.round(file.size / 1024)
  fileContentType.value = file.type
  fileBase64.value = await fileToBase64(file)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      // data:application/pdf;base64,xxxx — 我們只要 xxxx
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ── URL / text ────────────────────────────────────────────
const urlInput = ref('')
const textInput = ref('')

// ── Preview ───────────────────────────────────────────────
const previewing = ref(false)
const truncated = ref(false)
const chunks = ref<Array<{ included: boolean; title: string; content: string; tags: string[] }>>([])
const existingMatches = ref<Array<{ id: string; name: string; chunkCount: number; updatedAtMs: number }>>([])
const sourceMeta = ref({
  type: '' as ImportMode | '',
  name: '',
  url: '',
})

const canPreview = computed(() => {
  if (mode.value === 'file') return Boolean(fileBase64.value)
  if (mode.value === 'url') return /^https?:\/\//i.test(urlInput.value.trim())
  return textInput.value.trim().length > 0
})

const includedCount = computed(() => chunks.value.filter(c => c.included).length)

async function runPreview() {
  previewing.value = true
  try {
    const body: Record<string, unknown> = { type: mode.value }
    if (mode.value === 'file') {
      body.fileName = fileName.value
      body.contentType = fileContentType.value
      body.fileBase64 = fileBase64.value
    }
    else if (mode.value === 'url') {
      body.url = urlInput.value.trim()
    }
    else {
      body.text = textInput.value.trim()
      body.name = '手打輸入'
    }

    const res = await apiFetch<{
      chunks: Array<{ title: string; content: string; tags: string[] }>
      sourceName: string
      sourceUrl: string
      truncated: boolean
      existingMatches?: Array<{ id: string; name: string; chunkCount: number; updatedAtMs: number }>
    }>('/api/ai/knowledge/preview-chunks', { method: 'POST', body })

    if (!res.chunks.length) {
      showToast('AI 沒有切出任何有意義的卡片；請改用手打或檢查來源內容', 'error')
      return
    }

    truncated.value = res.truncated
    chunks.value = res.chunks.map(c => ({
      included: true,
      title: c.title,
      content: c.content,
      tags: [...(c.tags ?? [])],
    }))
    existingMatches.value = res.existingMatches ?? []
    sourceMeta.value = {
      type: mode.value,
      name: res.sourceName,
      url: res.sourceUrl,
    }
    step.value = 'preview'
  }
  catch (err: any) {
    showToast(err?.statusMessage || err?.message || '切片失敗', 'error')
  }
  finally {
    previewing.value = false
  }
}

// ── Tag editor (per chunk) ────────────────────────────────
const editingTagIdx = ref<number | null>(null)
const tagInput = ref('')
const tagInputRef = ref<Array<{ focus: () => void }> | { focus: () => void } | null>(null)

function startAddTag(idx: number) {
  editingTagIdx.value = idx
  tagInput.value = ''
  nextTick(() => {
    const el = Array.isArray(tagInputRef.value) ? tagInputRef.value[0] : tagInputRef.value
    el?.focus?.()
  })
}

function commitTag(chunk: { tags: string[] }) {
  const t = tagInput.value.trim()
  if (t && !chunk.tags.includes(t)) chunk.tags.push(t)
  tagInput.value = ''
  editingTagIdx.value = null
}

function removeTag(chunk: { tags: string[] }, tag: string) {
  chunk.tags = chunk.tags.filter(x => x !== tag)
}

// ── Bulk selection ────────────────────────────────────────
function selectAll() {
  for (const c of chunks.value) c.included = true
}
function selectNone() {
  for (const c of chunks.value) c.included = false
}

// ── Import ────────────────────────────────────────────────
const importing = ref(false)
const result = ref<{
  total: number
  indexed: number
  failed: number
  items: Array<{ id: string; title: string; status: string; failureReason?: string }>
} | null>(null)

const failedItems = computed(() =>
  (result.value?.items ?? []).filter(i => i.status === 'failed'),
)

async function runImport() {
  const selected = chunks.value
    .filter(c => c.included && c.title.trim() && c.content.trim())
    .map(c => ({ title: c.title.trim(), content: c.content.trim(), tags: c.tags }))

  if (!selected.length) return showToast('請至少選擇一張卡', 'error')
  if (selected.length > 50) return showToast('單次最多匯入 50 張，請先取消勾選一些', 'error')

  importing.value = true
  try {
    const res = await apiFetch<typeof result.value>('/api/ai/knowledge/bulk-create', {
      method: 'POST',
      body: {
        source: {
          type: sourceMeta.value.type,
          name: sourceMeta.value.name,
          url: sourceMeta.value.url,
        },
        chunks: selected,
      },
    })
    result.value = res
    step.value = 'result'
    if (res && res.failed === 0) showToast(`成功匯入 ${res.indexed} 張 ✅`, 'success')
    else if (res) showToast(`匯入完成：${res.indexed} 成功 / ${res.failed} 失敗`, 'error')
  }
  catch (err: any) {
    showToast(err?.statusMessage || err?.message || '匯入失敗', 'error')
  }
  finally {
    importing.value = false
  }
}

function resetAll() {
  step.value = 'input'
  mode.value = 'file'
  fileName.value = ''
  fileSizeKb.value = 0
  fileBase64.value = ''
  fileContentType.value = ''
  urlInput.value = ''
  textInput.value = ''
  chunks.value = []
  existingMatches.value = []
  truncated.value = false
  result.value = null
  sourceMeta.value = { type: '', name: '', url: '' }
  if (fileInputEl.value) fileInputEl.value.value = ''
}

function goBackToList() {
  router.push(`/admin/${workspaceId.value}/knowledge/cards`)
}

function goManageSources() {
  router.push(`/admin/${workspaceId.value}/knowledge/sources`)
}

function relativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`
  return new Date(ms).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}
</script>

<style scoped lang="scss">
.kb-import-card {
  margin-bottom: 0; // gap 由 .admin-panel-stack 控制
}

.kb-section-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 12px;
}

.kb-warning {
  color: var(--el-color-warning);
  font-weight: 500;
}

.kb-dedup-warning {
  margin-bottom: 12px;
}

.kb-dedup-body p {
  margin: 0 0 6px;
}

.kb-dedup-list {
  margin: 6px 0 8px;
  padding-left: 18px;
  font-size: 13px;
}

.kb-dedup-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.kb-import-tabs {
  margin-top: -8px;
}

.kb-file-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.kb-file-input {
  display: none;
}

.kb-file-name {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.kb-import-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.kb-bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.kb-chunk-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 640px;
  overflow-y: auto;
  padding: 4px;
}

.kb-chunk-row {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);

  &--excluded {
    opacity: 0.5;
  }
}

.kb-chunk-checkbox {
  padding-top: 8px;
}

.kb-chunk-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.kb-chunk-textarea {
  width: 100%;
}

.kb-chunk-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.kb-tag-input {
  width: 100px;
}

.kb-result-summary {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.kb-result-stat {
  flex: 1;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  text-align: center;

  &--success {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
  }

  &--danger {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
  }

  strong {
    display: block;
    font-size: 24px;
    margin-top: 4px;
  }
}

.kb-result-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kb-failed-list {
  margin: 8px 0 0;
  padding-left: 20px;
  li {
    margin: 4px 0;
  }
}
</style>
