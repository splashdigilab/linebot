<template>
  <AdminSplitLayout :is-empty="!selectedFlow && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">🤖 機器人模組</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!flows.length" class="split-sidebar-empty">
        <span>尚無模組</span>
        <el-button size="small" type="primary" plain @click="openCreate">立即建立</el-button>
      </div>
      <div v-else class="split-list">
        <button
          v-for="flow in flows"
          :key="flow.id"
          class="split-list-item"
          :class="{ active: selectedId === flow.id }"
          @click="selectFlow(flow)"
        >
          <div class="split-list-name">{{ flow.name }}</div>
          <div class="split-list-meta">
            <span class="text-xs text-muted">{{ flow.messages?.length ?? 0 }} 則訊息</span>
          </div>
        </button>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">🤖</span>
      <h3>選擇一個模組開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立一個全新的回覆模組</p>
      <el-button type="primary" @click="openCreate">建立模組</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span v-if="isCreating" class="split-editor-title">新增模組:</span>
          <el-input
            v-model="form.name"
            size="large"
            style="max-width: 400px;"
            placeholder="請輸入模組名稱..."
          />
        </div>
        <p class="text-sm text-muted" style="margin-top:0.25rem; padding-left: 0.5rem;">
          共 {{ form.messages.length }} 則回覆訊息
        </p>
      </div>
      <div class="flex gap-1">
        <el-button v-if="!isCreating && selectedFlow" type="danger" @click="deleteFlow">
          🗑️ 刪除
        </el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立模組' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="flow-editor-messages">
        <div class="messages-header">
          <span class="config-section-title" style="margin:0;">💬 回覆訊息</span>
          <div class="flex gap-1">
            <el-button size="small" @click="addMessage('text')">＋ 文字</el-button>
            <el-button size="small" @click="addMessage('image')">＋ 圖片</el-button>
          </div>
        </div>

        <div v-if="!form.messages.length" class="messages-empty">
          <span>尚無訊息</span>
          <p class="text-xs text-muted">點擊上方按鈕新增</p>
        </div>

        <!-- Message Cards -->
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
              <el-button link type="danger" style="padding:0.1rem 0.4rem;" @click="removeMessage(i)">✕</el-button>
            </div>
          </div>

          <!-- Text message -->
          <div v-if="msg.type === 'text'" class="message-bubble-wrap">
            <el-input
              v-model="msg.text"
              type="textarea"
              :rows="3"
              placeholder="輸入回覆文字..."
              :maxlength="msg.buttons && msg.buttons.length > 0 ? 160 : 5000"
              show-word-limit
            />
            <!-- Buttons List -->
            <div v-if="msg.buttons && msg.buttons.length" class="message-buttons-list">
              <div v-for="(btn, bIdx) in msg.buttons" :key="bIdx" class="action-button-editor">
                <div class="flex gap-1 items-center" style="margin-bottom: 0.5rem;">
                  <el-select v-model="btn.type" size="small" style="width: 120px;">
                    <el-option value="message" label="傳送文字" />
                    <el-option value="uri" label="開啟網址" />
                  </el-select>
                  <el-button link type="danger" style="margin-left: auto;" @click="removeButton(msg, bIdx)">✕</el-button>
                </div>
                <el-input v-model="btn.label" placeholder="按鈕名稱 (最多 20 字)" maxlength="20" style="margin-bottom: 0.5rem;" show-word-limit />
                <el-input v-if="btn.type === 'message'" v-model="btn.text" placeholder="用戶點擊後傳送的文字..." maxlength="300" show-word-limit />
                <el-input v-if="btn.type === 'uri'" v-model="btn.uri" placeholder="https://..." />
              </div>
            </div>
            <el-button
              v-if="!msg.buttons || msg.buttons.length < 4"
              plain
              style="width: 100%; justify-content: center; border-style: dashed; margin-top: 0.5rem;"
              @click="addButton(msg)"
            >
              ⊕ 新增按鈕 (非必需)
            </el-button>
          </div>

          <!-- Image message -->
          <div v-if="msg.type === 'image'" class="message-image-wrap">
            <div v-if="msg.originalContentUrl" class="image-preview" style="position: relative;">
              <img :src="msg.originalContentUrl" alt="preview" style="max-width: 100%; border-radius: var(--radius-md); display: block;" />
              <el-button type="danger" size="small" style="position: absolute; top: 0.5rem; right: 0.5rem; opacity: 0.9;" @click="msg.originalContentUrl = ''; msg.previewImageUrl = ''">更換圖片</el-button>
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
    </template>
  </AdminSplitLayout>

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
  messages: [] as any[],
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
  form.value = {
    name: flow.name,
    messages: JSON.parse(JSON.stringify(flow.messages ?? [])),
  }
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
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
  if (!form.value.name) return showToast('請輸入模組名稱', 'error')
  if (!form.value.messages.length) return showToast('請至少新增一則回覆訊息', 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const res = await $fetch<any>('/api/flow/create', {
        method: 'POST',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
        },
      })
      showToast('模組已建立 ✅', 'success')
      await loadFlows()
      const newFlow = flows.value.find(f => f.id === res.id) ?? flows.value[0]
      if (newFlow) selectFlow(newFlow)
      isCreating.value = false
    } else {
      await $fetch(`/api/flow/${selectedId.value}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          messages: form.value.messages,
          isActive: true,
        },
      })
      showToast('模組已更新 ✅', 'success')
      await loadFlows()
    }
  } catch {
    showToast('儲存失敗', 'error')
  } finally {
    saving.value = false
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
let toastId = 0
function showToast(msg: string, type: 'success' | 'error') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3500)
}
</script>

