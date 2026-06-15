<template>
  <el-dialog
    :model-value="modelValue"
    title="📥 上傳 / 匯入"
    width="760px"
    :close-on-click-modal="false"
    class="kb-import-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @close="onDialogClose"
  >
    <!-- ── Step 1:選來源 ─────────────────────────── -->
    <div v-if="step === 'input'">
      <p class="kb-step-label">1️⃣ 選擇來源 — 把 PDF、Excel、網址或一大段文字交給 AI 切成知識卡</p>
      <el-tabs v-model="mode" class="kb-import-tabs">
        <el-tab-pane label="📄 檔案" name="file">
          <p class="kb-section-hint">支援 PDF、Excel（.xlsx / .xls）。單檔上限 10MB。掃描檔 / 圖片型 PDF 會自動用 AI 辨識文字（30 頁以內）。</p>
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

        <el-tab-pane label="📋 貼上文字" name="text">
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

      <div class="kb-overview-toggle">
        <el-checkbox v-model="generateOverview">
          這是商品 / 列表頁（額外產生一張「總覽卡」）
        </el-checkbox>
        <p class="kb-section-hint">
          適用首頁、商品型錄這類「列出很多項目」的頁面。除了把每個項目切成卡片，再額外合成一張帶分類的總覽卡，
          讓客人問「你們有賣什麼 / 有哪些產品」時能一次回答，不會被反問。
        </p>
      </div>

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

    <!-- ── Step 2:預覽 + 編輯 ─────────────────────────── -->
    <div v-if="step === 'preview'">
      <p class="kb-step-label">2️⃣ 預覽切卡結果</p>
      <p class="kb-section-hint">
        AI 偵測到 <strong>{{ chunks.length }}</strong> 張卡片。
        <span v-if="truncated" class="kb-warning"> ⚠️ 原文超過 10 萬字已截斷，可能漏掉後半部。</span>
        <span v-else>勾選要匯入的、可直接編輯內容；確認後一鍵建立。</span>
      </p>

      <el-alert
        v-if="ocrUsed"
        type="warning"
        show-icon
        :closable="false"
        class="kb-ocr-alert"
      >
        <template #title>
          📷 這份 PDF 是掃描檔，文字由 AI 辨識
        </template>
        <div class="text-xs">辨識可能有錯漏（尤其數字、價格、電話），請逐張確認內容正確再匯入。</div>
      </el-alert>

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
            <el-button size="small" plain @click="step = 'input'">取消、改其它名稱</el-button>
          </div>
        </div>
      </el-alert>

      <!-- 總覽卡（列表頁專屬）：列在最上面、可編輯、可取消 -->
      <div v-if="overviewCard" class="kb-overview-card">
        <div class="kb-chunk-checkbox">
          <el-checkbox v-model="overviewCard.included" />
        </div>
        <div class="kb-chunk-content">
          <div class="kb-overview-badge">🗂️ 總覽卡（接「你們有賣什麼」這類問題）</div>
          <el-input v-model="overviewCard.title" placeholder="標題" size="small" class="kb-chunk-title" />
          <el-input
            v-model="overviewCard.content"
            type="textarea"
            :rows="4"
            placeholder="內容"
            class="kb-chunk-textarea"
          />
          <div class="kb-chunk-tags">
            <el-tag
              v-for="tag in overviewCard.tags"
              :key="tag"
              size="small"
              closable
              @close="removeTag(overviewCard, tag)"
            >
              {{ tag }}
            </el-tag>
          </div>
        </div>
      </div>

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

    <!-- ── Step 3:結果(只有部分失敗才會看到;全成功直接關窗) ── -->
    <div v-if="step === 'result' && result">
      <p class="kb-step-label">3️⃣ 匯入結果</p>
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
        <p class="kb-section-hint">以下卡片建立但索引失敗，可在知識庫點開該卡按「🔄 重新索引」：</p>
        <ul class="kb-failed-list">
          <li v-for="item in failedItems" :key="item.id">
            <strong>{{ item.title }}</strong>
            <span class="text-muted text-xs">— {{ item.failureReason ?? '未知原因' }}</span>
          </li>
        </ul>
      </div>

      <div class="kb-import-actions">
        <el-button @click="resetAll">📥 繼續匯入</el-button>
        <el-button type="primary" @click="close">完成</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 有實際建立資料時觸發(全成功或部分成功),父層應刷新來源列表 */
  'imported': [sourceId: string | null]
}>()

void props // 只在 template 用到 modelValue

const { apiFetch } = useWorkspace()
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

// ── Overview（列表頁總覽卡）──────────────────────────────
const generateOverview = ref(false)
type OverviewCard = { included: boolean; title: string; content: string; tags: string[]; questions: string[] }
const overviewCard = ref<OverviewCard | null>(null)

// ── Preview ───────────────────────────────────────────────
const previewing = ref(false)
const truncated = ref(false)
const ocrUsed = ref(false) // 掃描檔 PDF 由 AI 辨識文字 → 預覽時提醒逐張確認
const chunks = ref<Array<{ included: boolean; title: string; content: string; tags: string[]; questions: string[] }>>([])
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
    const body: Record<string, unknown> = { type: mode.value, generateOverview: generateOverview.value }
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
      chunks: Array<{ title: string; content: string; tags: string[]; questions?: string[] }>
      overviewCard?: { title: string; content: string; tags: string[]; questions: string[] } | null
      sourceName: string
      sourceUrl: string
      truncated: boolean
      ocrUsed?: boolean
      existingMatches?: Array<{ id: string; name: string; chunkCount: number; updatedAtMs: number }>
    }>('/api/ai/knowledge/preview-chunks', { method: 'POST', body })

    if (!res.chunks.length) {
      showToast('AI 沒有切出任何有意義的卡片；請改貼文字或檢查來源內容', 'error')
      return
    }

    truncated.value = res.truncated
    ocrUsed.value = res.ocrUsed === true
    chunks.value = res.chunks.map(c => ({
      included: true,
      title: c.title,
      content: c.content,
      tags: [...(c.tags ?? [])],
      questions: [...(c.questions ?? [])],
    }))
    overviewCard.value = res.overviewCard
      ? {
          included: true,
          title: res.overviewCard.title,
          content: res.overviewCard.content,
          tags: [...(res.overviewCard.tags ?? [])],
          questions: [...(res.overviewCard.questions ?? [])],
        }
      : null
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
  sourceId: string | null
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
    .map(c => ({ title: c.title.trim(), content: c.content.trim(), tags: c.tags, questions: c.questions ?? [] }))

  if (!selected.length) return showToast('請至少選擇一張卡', 'error')
  if (selected.length > 150) return showToast('單次最多匯入 150 張，請先取消勾選一些', 'error')

  importing.value = true
  try {
    const ov = overviewCard.value
    const overviewPayload = ov && ov.included && ov.title.trim() && ov.content.trim()
      ? { title: ov.title.trim(), content: ov.content.trim(), tags: ov.tags, questions: ov.questions ?? [] }
      : null

    const res = await apiFetch<typeof result.value>('/api/ai/knowledge/bulk-create', {
      method: 'POST',
      body: {
        source: {
          type: sourceMeta.value.type,
          name: sourceMeta.value.name,
          url: sourceMeta.value.url,
        },
        chunks: selected,
        overviewCard: overviewPayload,
      },
    })
    result.value = res
    // 全部成功直接關窗(關窗 handler 會通知父層刷新並選中新來源);
    // 有失敗才停在結果頁,讓使用者看到哪幾張失敗、原因是什麼
    if (res && res.failed === 0) {
      showToast(`成功匯入 ${res.indexed} 張 ✅`, 'success')
      close()
    }
    else if (res) {
      step.value = 'result'
      showToast(`匯入完成：${res.indexed} 成功 / ${res.failed} 失敗`, 'error')
    }
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
  overviewCard.value = null
  generateOverview.value = false
  existingMatches.value = []
  truncated.value = false
  ocrUsed.value = false
  result.value = null
  sourceMeta.value = { type: '', name: '', url: '' }
  if (fileInputEl.value) fileInputEl.value.value = ''
}

function close() {
  emit('update:modelValue', false)
}

/**
 * 統一在「關窗」時結算:只要有實際建立過資料(result 存在,全成功或部分成功),
 * 就通知父層刷新來源列表並重置狀態;中途關窗(還沒匯入)則保留輸入,下次打開接續。
 */
function onDialogClose() {
  if (result.value) {
    emit('imported', result.value.sourceId)
    resetAll()
  }
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
