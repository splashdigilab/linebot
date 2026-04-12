<template>
  <div class="flow-layout">
    <!-- ── Left Sidebar: Flow List ─────────────────────────── -->
    <aside class="flow-sidebar">
      <div class="flow-sidebar-header">
        <span class="flow-sidebar-title">🤖 對話流程</span>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          ➕ 新增
        </button>
      </div>

      <div v-if="loading" style="padding:1.5rem;text-align:center;">
        <div class="spinner" />
      </div>

      <div v-else-if="!flows.length" class="flow-sidebar-empty">
        <span>尚無流程</span>
        <button class="btn btn-ghost btn-sm" @click="openCreate">立即建立</button>
      </div>

      <div v-else class="flow-list">
        <button
          v-for="flow in flows"
          :key="flow.id"
          class="flow-list-item"
          :class="{ active: selectedId === flow.id }"
          @click="selectFlow(flow)"
        >
          <div class="flow-list-name">{{ flow.name }}</div>
          <div class="flow-list-meta">
            <span class="badge" :class="flow.isActive ? 'badge-green' : 'badge-gray'" style="font-size:0.6rem;">
              {{ flow.isActive ? '啟用' : '停用' }}
            </span>
            <span class="text-xs text-muted">{{ getTriggerDisplay(flow) }}</span>
          </div>
        </button>
      </div>
    </aside>

    <!-- ── Right Editor ────────────────────────────────────── -->
    <main class="flow-editor">

      <!-- Empty state when nothing selected -->
      <div v-if="!selectedFlow && !isCreating" class="flow-empty-state">
        <span class="empty-icon">🤖</span>
        <h3>選擇一個流程開始編輯</h3>
        <p>或點擊左側「➕ 新增」建立一個全新的自動回覆流程</p>
        <button class="btn btn-primary" @click="openCreate">建立流程</button>
      </div>

      <!-- Editor form -->
      <div v-else class="flow-editor-inner">
        <!-- Header -->
        <div class="flow-editor-header">
          <div>
            <h2 class="flow-editor-title">{{ isCreating ? '新增流程' : form.name }}</h2>
            <p class="text-sm text-muted" style="margin-top:0.25rem;">
              {{ isCreating ? '設定觸發條件與回覆訊息' : `${form.triggers.length} 個觸發詞・${form.messages.length} 則回覆` }}
            </p>
          </div>
          <div class="flex gap-1">
            <!-- Toggle active -->
            <button
              v-if="!isCreating && selectedFlow"
              class="btn btn-sm"
              :class="form.isActive ? 'btn-secondary' : 'btn-secondary'"
              style="gap:0.4rem;"
              @click="toggleActive"
            >
              <span>{{ form.isActive ? '✅ 啟用中' : '⏸ 已停用' }}</span>
            </button>
            <button v-if="!isCreating && selectedFlow" class="btn btn-danger btn-sm" @click="deleteFlow">
              🗑️ 刪除
            </button>
            <button class="btn btn-secondary btn-sm" @click="cancelEdit">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="submitForm">
              <span v-if="saving" class="spinner" style="width:12px;height:12px;" />
              {{ isCreating ? '建立流程' : '儲存變更' }}
            </button>
          </div>
        </div>

        <div class="flow-editor-body">
          <!-- Left column: Config -->
          <div class="flow-editor-config">

            <!-- Name -->
            <div class="config-section">
              <div class="config-section-title">📌 流程名稱</div>
              <input v-model="form.name" placeholder="例：商品查詢流程" class="input-base" />
            </div>

            <!-- Triggers -->
            <div class="config-section">
              <div class="config-section-title">⚡ 觸發關鍵字</div>
              <p class="config-section-hint">
                輸入關鍵字後按 <kbd>Enter</kbd> 或 <kbd>,</kbd> 確認。使用者傳送的訊息包含其中一個詞即可觸發。
              </p>
              <div class="tag-input-wrap" @click="focusTriggerInput">
                <span
                  v-for="(tag, i) in form.triggers"
                  :key="i"
                  class="trigger-tag"
                >
                  {{ tag }}
                  <button class="trigger-tag-remove" @click.stop="removeTrigger(i)">×</button>
                </span>
                <input
                  ref="triggerInputRef"
                  v-model="triggerInputVal"
                  class="tag-inner-input"
                  placeholder="輸入關鍵字…"
                  @keydown="onTriggerKeydown"
                  @blur="commitTrigger"
                />
              </div>
              <div v-if="form.triggers.length" class="config-section-hint" style="margin-top:0.5rem;">
                💡 目前共 {{ form.triggers.length }} 個關鍵字觸發
              </div>
            </div>

            <!-- Active toggle -->
            <div class="config-section">
              <div class="config-section-title">🔘 流程狀態</div>
              <label class="toggle-label">
                <div class="toggle-switch" :class="{ on: form.isActive }" @click="form.isActive = !form.isActive">
                  <div class="toggle-thumb" />
                </div>
                <span>{{ form.isActive ? '啟用中 — 使用者觸發時將自動回覆' : '已停用 — 不會自動回覆' }}</span>
              </label>
            </div>
          </div>

          <!-- Right column: Messages Preview -->
          <div class="flow-editor-messages">
            <div class="messages-header">
              <span class="config-section-title" style="margin:0;">💬 回覆訊息</span>
              <div class="flex gap-1">
                <button class="btn btn-secondary btn-sm" @click="addMessage('text')">＋ 文字</button>
                <button class="btn btn-secondary btn-sm" @click="addMessage('image')">＋ 圖片</button>
              </div>
            </div>

            <div v-if="!form.messages.length" class="messages-empty">
              <span>尚無訊息</span>
              <p class="text-xs text-muted">點擊上方按鈕新增</p>
            </div>

            <!-- Message Cards (chat bubble preview style) -->
            <div
              v-for="(msg, i) in form.messages"
              :key="i"
              class="message-card"
              :class="{ dragging: dragIndex === i, 'drag-over': dragOverIndex === i && dragIndex !== i }"
              @dragover.prevent="onDragOver($event, i)"
              @dragenter.prevent
              @dragleave="onDragLeave"
              @drop="onDrop($event, i)"
            >
              <div class="message-card-header">
                <div class="flex gap-1" style="align-items: center;">
                  <span
                    class="drag-handle"
                    draggable="true"
                    @dragstart="onDragStart($event, i)"
                    @dragend="onDragEnd"
                  >⠿</span>
                  <span class="badge" :class="msg.type === 'text' ? 'badge-blue' : 'badge-orange'">
                    {{ msg.type === 'text' ? '📝 文字訊息' : '🖼️ 圖片訊息' }}
                  </span>
                </div>
                <div class="flex gap-1">
                  <button class="btn btn-ghost btn-sm" style="color:var(--color-error);padding:0.1rem 0.4rem;" @click="removeMessage(i)">✕</button>
                </div>
              </div>

              <!-- Text message -->
              <div v-if="msg.type === 'text'" class="message-bubble-wrap">
                <div class="message-bubble">
                  <textarea
                    v-model="msg.text"
                    rows="3"
                    class="bubble-textarea"
                    placeholder="輸入回覆文字..."
                    :maxlength="msg.buttons && msg.buttons.length > 0 ? 160 : 5000"
                  />
                  <div class="text-xs text-muted" style="text-align: right; margin-top: 0.25rem;">
                    {{ msg.text?.length || 0 }} / {{ msg.buttons && msg.buttons.length > 0 ? 160 : 5000 }}
                  </div>
                </div>
                
                <!-- Buttons List -->
                <div v-if="msg.buttons && msg.buttons.length" class="message-buttons-list">
                  <div v-for="(btn, bIdx) in msg.buttons" :key="bIdx" class="action-button-editor">
                    <div class="flex gap-1 items-center" style="margin-bottom: 0.5rem;">
                      <select v-model="btn.type" class="input-base" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                        <option value="message">傳送文字</option>
                        <option value="uri">開啟網址</option>
                      </select>
                      <button class="btn btn-ghost btn-sm" style="color:var(--color-error); margin-left: auto;" @click="removeButton(msg, bIdx)">✕</button>
                    </div>
                    <input v-model="btn.label" placeholder="按鈕名稱 (最多 20 字)" maxlength="20" class="input-base mb-1" />
                    <input v-if="btn.type === 'message'" v-model="btn.text" placeholder="用戶點擊後傳送的文字..." maxlength="300" class="input-base" />
                    <input v-if="btn.type === 'uri'" v-model="btn.uri" placeholder="https://..." class="input-base" />
                  </div>
                </div>

                <!-- Add Button Toggle -->
                <button
                  v-if="!msg.buttons || msg.buttons.length < 4"
                  class="btn btn-ghost"
                  style="width: 100%; justify-content: center; border: 1px dashed var(--border); margin-top: 0.5rem;"
                  @click="addButton(msg)"
                >
                  ⊕ 新增按鈕 (非必需)
                </button>
              </div>

              <!-- Image message -->
              <div v-if="msg.type === 'image'" class="message-image-wrap">
                <div v-if="msg.originalContentUrl" class="image-preview" style="position: relative;">
                  <img :src="msg.originalContentUrl" alt="preview" style="max-width: 100%; border-radius: var(--radius-md); display: block;" />
                  <button class="btn btn-sm btn-danger" style="position: absolute; top: 0.5rem; right: 0.5rem; opacity: 0.8;" @click="msg.originalContentUrl = ''; msg.previewImageUrl = ''">更換圖片</button>
                </div>
                <div v-else class="upload-zone" @click="triggerImageUpload(i)">
                  <div v-if="uploadingIndex === i" style="text-align: center; color: var(--text-muted);">
                    <div class="spinner" style="margin: 0 auto 0.5rem auto;"></div>
                    <span>上傳中...</span>
                  </div>
                  <div v-else style="text-align: center; color: var(--text-muted);">
                    <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">📷</span>
                    <span>點擊上傳圖片</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Hidden File Input for Image Upload -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/png, image/jpeg"
      style="display: none"
      @change="onFileSelected"
    />

    <!-- Toast -->
    <div class="toast-bar">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
        <span>{{ t.type === 'success' ? '✅' : '❌' }}</span>
        <span>{{ t.msg }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'default' })

// ── State ─────────────────────────────────────────────
const flows = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const toasts = ref<{ id: number; msg: string; type: 'success' | 'error' }[]>([])
const triggerInputRef = ref<HTMLInputElement | null>(null)
const triggerInputVal = ref('')

// Image Upload State
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadTargetIndex = ref<number | null>(null)
const uploadingIndex = ref<number | null>(null)

// Drag and Drop State
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const defaultForm = () => ({
  name: '',
  triggers: [] as string[],
  messages: [] as any[],
  isActive: true,
})
const form = ref(defaultForm())

const selectedFlow = computed(() => flows.value.find(f => f.id === selectedId.value) ?? null)

// ── Load ──────────────────────────────────────────────
async function loadFlows() {
  loading.value = true
  flows.value = await $fetch<any[]>('/api/flow/list').catch(() => [])
  loading.value = false
}
onMounted(loadFlows)

// ── Select / Create ───────────────────────────────────
function selectFlow(flow: any) {
  isCreating.value = false
  selectedId.value = flow.id
  // Normalize: support legacy trigger string
  const triggers: string[] = Array.isArray(flow.triggers)
    ? flow.triggers
    : (flow.trigger ? [flow.trigger] : [])
  form.value = {
    name: flow.name,
    triggers,
    messages: JSON.parse(JSON.stringify(flow.messages ?? [])),
    isActive: flow.isActive,
  }
  triggerInputVal.value = ''
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
  triggerInputVal.value = ''
}

function cancelEdit() {
  if (selectedFlow.value) {
    selectFlow(selectedFlow.value)
    isCreating.value = false
  } else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
}

// ── Trigger Tag Input ─────────────────────────────────
function focusTriggerInput() {
  triggerInputRef.value?.focus()
}

function commitTrigger() {
  const val = triggerInputVal.value.trim()
  if (val && !form.value.triggers.includes(val)) {
    form.value.triggers.push(val)
  }
  triggerInputVal.value = ''
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTrigger()
  } else if (e.key === 'Backspace' && !triggerInputVal.value && form.value.triggers.length) {
    form.value.triggers.pop()
  }
}

function removeTrigger(i: number) {
  form.value.triggers.splice(i, 1)
}

// ── Messages ──────────────────────────────────────────
function addMessage(type: 'text' | 'image') {
  if (type === 'text') form.value.messages.push({ type: 'text', text: '', buttons: [] })
  if (type === 'image') form.value.messages.push({ type: 'image', originalContentUrl: '', previewImageUrl: '' })
}

function removeMessage(i: number) {
  form.value.messages.splice(i, 1)
}

function moveMessage(i: number, dir: -1 | 1) {
  const arr = form.value.messages
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function onDragStart(e: DragEvent, i: number) {
  dragIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', i.toString())
  }
  // Small delay so the card has time to render before ghost appears
  setTimeout(() => {
    // intentionally empty - triggers repaint for ghost image
  }, 0)
}

function onDragOver(_e: DragEvent, i: number) {
  dragOverIndex.value = i
}

function onDragLeave() {
  dragOverIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDrop(e: DragEvent, dropIndex: number) {
  const fromIndex = dragIndex.value
  if (fromIndex !== null && fromIndex !== dropIndex) {
    const item = form.value.messages.splice(fromIndex, 1)[0]
    form.value.messages.splice(dropIndex, 0, item)
  }
  dragIndex.value = null
  dragOverIndex.value = null
}

function addButton(msg: any) {
  if (!msg.buttons) msg.buttons = []
  if (msg.buttons.length >= 4) {
    showToast('最多只能新增 4 個按鈕', 'error')
    return
  }
  msg.buttons.push({ type: 'message', label: '', text: '', uri: '' })
}

function removeButton(msg: any, bIdx: number) {
  if (msg.buttons) {
    msg.buttons.splice(bIdx, 1)
  }
}

// ── Image Upload ──────────────────────────────────────
function triggerImageUpload(index: number) {
  uploadTargetIndex.value = index
  fileInputRef.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > 5 * 1024 * 1024) {
    showToast('圖片不能超過 5MB', 'error')
    input.value = ''
    return
  }

  const index = uploadTargetIndex.value
  if (index === null || !form.value.messages[index]) return
  
  uploadingIndex.value = index

  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const res = await $fetch<any>('/api/upload', {
      method: 'POST',
      body: {
        imageBase64: base64,
        contentType: file.type,
      },
    })

    form.value.messages[index].originalContentUrl = res.imageUrl
    form.value.messages[index].previewImageUrl = res.imageUrl
  } catch (err) {
    console.error('Upload error:', err)
    showToast('圖片上傳失敗', 'error')
  } finally {
    uploadingIndex.value = null
    uploadTargetIndex.value = null
    input.value = ''
  }
}

// ── Save / Delete ─────────────────────────────────────
async function submitForm() {
  commitTrigger()
  if (!form.value.name) return showToast('請輸入流程名稱', 'error')
  if (!form.value.triggers.length) return showToast('請至少輸入一個觸發關鍵字', 'error')
  if (!form.value.messages.length) return showToast('請至少新增一則回覆訊息', 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const res = await $fetch<any>('/api/flow/create', {
        method: 'POST',
        body: {
          name: form.value.name,
          triggers: form.value.triggers,
          messages: form.value.messages,
          isActive: form.value.isActive,
        },
      })
      showToast('流程已建立 ✅', 'success')
      await loadFlows()
      const newFlow = flows.value.find(f => f.id === res.id) ?? flows.value[0]
      if (newFlow) selectFlow(newFlow)
      isCreating.value = false
    } else {
      await $fetch(`/api/flow/${selectedId.value}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          triggers: form.value.triggers,
          messages: form.value.messages,
          isActive: form.value.isActive,
        },
      })
      showToast('流程已更新 ✅', 'success')
      await loadFlows()
    }
  } catch {
    showToast('儲存失敗', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleActive() {
  if (!selectedId.value) return
  const newVal = !form.value.isActive
  try {
    await $fetch(`/api/flow/${selectedId.value}`, { method: 'PUT', body: { isActive: newVal } })
    form.value.isActive = newVal
    await loadFlows()
    showToast(newVal ? '已啟用' : '已停用', 'success')
  } catch {
    showToast('更新失敗', 'error')
  }
}

async function deleteFlow() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name}」？`)) return
  try {
    await $fetch(`/api/flow/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    form.value = defaultForm()
    await loadFlows()
  } catch {
    showToast('刪除失敗', 'error')
  }
}

// ── Helpers ───────────────────────────────────────────
function getTriggerDisplay(flow: any) {
  const triggers: string[] = Array.isArray(flow.triggers)
    ? flow.triggers
    : (flow.trigger ? [flow.trigger] : [])
  if (!triggers.length) return '無關鍵字'
  return triggers.slice(0, 2).join('、') + (triggers.length > 2 ? ` +${triggers.length - 2}` : '')
}

let toastId = 0
function showToast(msg: string, type: 'success' | 'error') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3500)
}
</script>

<style scoped>
/* ── Layout ── */
.flow-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  /* Break out of main-content's padding to fill the viewport */
  margin: -2rem -2.5rem;
}

/* ── Sidebar ── */
.flow-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.flow-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.flow-sidebar-title {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.flow-sidebar-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.flow-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.flow-list-item {
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.65rem 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--text-secondary);
}

.flow-list-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.flow-list-item.active {
  background: var(--color-line-glow, rgba(6,199,85,0.12));
  border-color: var(--color-line);
  color: var(--color-line);
}

.flow-list-name {
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.25rem;
}

.flow-list-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Editor ── */
.flow-editor {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.flow-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
  padding: 3rem;
}

.flow-empty-state h3 {
  color: var(--text-primary);
  font-size: 1.1rem;
}

.flow-editor-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.flow-editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
  gap: 1rem;
}

.flow-editor-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

/* ── Two-column editor body ── */
.flow-editor-body {
  display: grid;
  grid-template-columns: 340px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.flow-editor-config {
  border-right: 1px solid var(--border);
  padding: 1.25rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.flow-editor-messages {
  padding: 1.25rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ── Config Sections ── */
.config-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.config-section-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.config-section-hint {
  font-size: 0.74rem;
  color: var(--text-muted);
  line-height: 1.5;
}

kbd {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  font-size: 0.7rem;
  font-family: monospace;
}

.input-base {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input, var(--bg-elevated));
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s;
}

.input-base:focus {
  border-color: var(--color-line);
}

/* ── Tag Input ── */
.tag-input-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  cursor: text;
  min-height: 42px;
  align-items: center;
  transition: border-color 0.15s;
}

.tag-input-wrap:focus-within {
  border-color: var(--color-line);
}

.trigger-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--color-line-glow, rgba(6,199,85,0.15));
  color: var(--color-line);
  border: 1px solid var(--color-line);
  border-radius: 20px;
  padding: 0.1rem 0.5rem 0.1rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.trigger-tag-remove {
  background: none;
  border: none;
  color: var(--color-line);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0;
  line-height: 1;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.trigger-tag-remove:hover { opacity: 1; }

.tag-inner-input {
  border: none;
  outline: none;
  background: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  flex: 1;
  min-width: 80px;
  padding: 0;
}

/* ── Toggle Switch ── */
.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.toggle-switch {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  position: relative;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.toggle-switch.on {
  background: var(--color-line);
  border-color: var(--color-line);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.2s;
}

.toggle-switch.on .toggle-thumb {
  left: calc(100% - 18px);
}

/* ── Messages ── */
.messages-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
}

.messages-empty {
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border);
}

.message-card {
  flex-shrink: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: box-shadow 0.15s, opacity 0.15s, transform 0.15s;
  position: relative;
}

.message-card.dragging {
  opacity: 0.35;
  transform: scale(0.98);
}

.message-card.drag-over {
  border-color: var(--color-line);
  box-shadow: 0 0 0 2px rgba(6, 199, 85, 0.35);
}

.message-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}

.drag-handle {
  display: flex;
  align-items: center;
  cursor: grab;
  color: var(--text-muted);
  padding: 0 0.25rem;
  font-size: 1rem;
  opacity: 0.5;
  transition: opacity 0.15s;
  user-select: none;
}

.drag-handle:hover {
  opacity: 1;
  color: var(--text-secondary);
}

.drag-handle:active {
  cursor: grabbing;
}

.message-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.85rem;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
}

/* Text bubble */
.message-bubble-wrap {
  padding: 0.85rem;
}

.message-bubble {
  background: var(--color-line-glow, rgba(6,199,85,0.08));
  border-radius: var(--radius-md);
  border: 1px solid var(--color-line, rgba(6,199,85,0.25));
  overflow: hidden;
}

.bubble-textarea {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  padding: 0.65rem 0.75rem;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
}

/* Image */
.message-image-wrap {
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.image-preview {
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #000;
}

.image-preview img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
}

.message-buttons-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.action-button-editor {
  border: 1px solid var(--border);
  background: var(--bg-hover, rgba(0,0,0,0.02));
  border-radius: var(--radius-sm);
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.upload-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 2.5rem 1rem;
  cursor: pointer;
  background: var(--bg-card);
  transition: all 0.2s;
}

.upload-zone:hover {
  border-color: var(--color-line);
  background: rgba(6, 199, 85, 0.05); /* slightly green */
}
</style>
