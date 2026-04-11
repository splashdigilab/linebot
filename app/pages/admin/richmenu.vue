<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Rich Menu 設定</h1>
        <p>建立並部署 LINE Rich Menu</p>
      </div>
      <button class="btn btn-primary" @click="openCreateModal">
        ➕ 新增 Rich Menu
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner" />
    </div>

    <!-- Empty -->
    <div v-else-if="!menus.length" class="card">
      <div class="empty-state">
        <span class="empty-icon">🗂️</span>
        <h3>尚無 Rich Menu</h3>
        <p>點擊右上角「新增 Rich Menu」開始建立您的第一個選單</p>
        <button class="btn btn-primary" @click="openCreateModal">建立選單</button>
      </div>
    </div>

    <!-- Menu List -->
    <div v-else class="grid-2" style="align-items:start;">
      <div
        v-for="menu in menus"
        :key="menu.id"
        class="card menu-card"
        @click="openEditModal(menu)"
      >
        <!-- Image Preview -->
        <div class="menu-preview">
          <img
            v-if="menu.imageUrl"
            :src="menu.imageUrl"
            :alt="menu.name"
            style="width:100%;border-radius:var(--radius-md);object-fit:cover;"
          >
          <div v-else class="menu-preview-placeholder">
            <span>🖼️</span>
            <span>尚未上傳圖片</span>
          </div>
        </div>

        <!-- Info -->
        <div>
          <div class="flex items-center gap-1">
            <h3 style="font-size:1rem;font-weight:700;">{{ menu.name }}</h3>
            <span v-if="menu.isDefault" class="badge badge-green">預設</span>
          </div>
          <p class="text-xs text-muted" style="margin-top:0.25rem;">
            {{ menu.areas?.length ?? 0 }} 個區塊 · {{ menu.size?.width }}×{{ menu.size?.height }}
          </p>
          <p class="text-xs text-muted truncate" style="margin-top:0.15rem;">
            LINE ID: {{ menu.richMenuId }}
          </p>
        </div>

        <!-- Areas -->
        <div v-if="menu.areas?.length" class="card-sm" style="padding:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
          <p class="text-xs" style="color:var(--text-muted);font-weight:600;margin-bottom:0.25rem;">區塊設定</p>
          <div
            v-for="(area, i) in menu.areas"
            :key="i"
            class="flex items-center gap-1"
            style="font-size:0.78rem;color:var(--text-secondary);"
          >
            <span class="badge badge-blue" style="font-size:0.65rem;">{{ i + 1 }}</span>
            <span>{{ area.action?.type }}</span>
            <span class="text-muted">·</span>
            <span class="truncate">{{ getActionLabel(area.action) }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-1" style="flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" @click.stop="openUpload(menu)">
            🖼️ 上傳圖片
          </button>
          <button
            v-if="!menu.isDefault"
            class="btn btn-secondary btn-sm"
            @click.stop="setAsDefault(menu)"
          >
            ⭐ 設為預設
          </button>
          <button class="btn btn-danger btn-sm" @click.stop="confirmDelete(menu)">
            🗑️ 刪除
          </button>
        </div>
      </div>
    </div>

    <!-- ── Create Modal ── -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="closeCreateModal">
      <div class="modal" style="max-width:700px;">
        <div class="modal-header">
          <h3>{{ editingId ? '編輯 Rich Menu' : '新增 Rich Menu' }}</h3>
          <button class="btn btn-ghost btn-sm" @click="closeCreateModal">✕</button>
        </div>

        <div class="form-group">
          <label>選單名稱</label>
          <input v-model="form.name" placeholder="例：主選單" />
        </div>

        <div class="form-group">
          <label>Chat Bar 文字</label>
          <input v-model="form.chatBarText" placeholder="選單" />
        </div>

        <!-- Create Image Upload Zone -->
        <div class="form-group" style="margin-bottom:1.5rem;">
          <label>1. 上傳選單背景圖 ({{ editingId ? '選填，若不上傳則自動沿用舊圖' : '必要' }})</label>
          <div
            class="upload-zone"
            :class="{ dragging: isCreateDragging }"
            @dragleave="isCreateDragging = false"
            @dragover.prevent="isCreateDragging = true"
            @drop.prevent="onCreateDrop"
            @click="triggerCreateFile"
            style="min-height: 120px; padding: 1.5rem;"
          >
            <input ref="createFileInput" type="file" accept="image/png,image/jpeg" style="display:none;" @change="onCreateFileSelect" />
            <div v-if="form.previewUrl" style="text-align:center;">
              <div class="badge badge-green" style="margin-bottom:0.5rem;font-size:0.875rem;">✅ 圖片已上傳 ({{ form.width }} × {{ form.height }})</div>
              <p class="text-xs text-muted">點擊或拖放到此處可重新上傳</p>
            </div>
            <div v-else style="text-align:center;color:var(--text-muted);">
              <div style="font-size:1.75rem;margin-bottom:0.25rem;">🖼️</div>
              <p style="font-size:0.875rem;font-weight:600;">拖放圖片或點擊選擇</p>
              <p style="font-size:0.75rem;margin-top:0.25rem;">PNG / JPEG · 最大 1MB (LINE 規範)</p>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>預設顯示</label>
          <select v-model="form.selected">
            <option :value="true">是</option>
            <option :value="false">否</option>
          </select>
        </div>

        <!-- Areas Editor (only visible if image uploaded) -->
        <div v-if="form.previewUrl" style="margin-bottom:1rem;">
          <div class="flex items-center justify-between" style="margin-bottom:0.75rem;">
            <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">
              2. 區塊設定（{{ form.areas.length }} 個）
            </label>
            <button class="btn btn-secondary btn-sm" @click="addArea">➕ 新增區塊</button>
          </div>

          <!-- Visual canvas (drag + resize) -->
          <div
            ref="canvasRef"
            class="canvas-wrap"
            :style="{
              width: '100%',
              paddingBottom: `${(Number(form.height) / Number(form.width)) * 100}%`,
              position: 'relative',
              background: `url(${form.previewUrl}) center/cover no-repeat`,
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              marginBottom: '1rem',
              overflow: 'hidden',
              userSelect: dragState ? 'none' : 'auto',
              cursor: dragState?.type === 'move' ? 'grabbing' : 'default',
            }"
          >
            <div
              v-for="(area, i) in form.areas"
              :key="i"
              class="canvas-area"
              :class="{
                'area-active': dragState?.areaIndex === i,
                'area-overlap': overlapSet.has(i),
              }"
              :style="{
                left: `${(area.bounds.x / Number(form.width)) * 100}%`,
                top: `${(area.bounds.y / Number(form.height)) * 100}%`,
                width: `${(area.bounds.width / Number(form.width)) * 100}%`,
                height: `${(area.bounds.height / Number(form.height)) * 100}%`,
                background: areaColors[i % areaColors.length],
              }"
              @mousedown.prevent="startDrag($event, i)"
            >
              <span class="area-label">{{ i + 1 }}</span>
              <!-- 8 resize handles -->
              <div class="rh nw" @mousedown.stop.prevent="startResize($event, i, 'nw')" />
              <div class="rh n"  @mousedown.stop.prevent="startResize($event, i, 'n')" />
              <div class="rh ne" @mousedown.stop.prevent="startResize($event, i, 'ne')" />
              <div class="rh e"  @mousedown.stop.prevent="startResize($event, i, 'e')" />
              <div class="rh se" @mousedown.stop.prevent="startResize($event, i, 'se')" />
              <div class="rh s"  @mousedown.stop.prevent="startResize($event, i, 's')" />
              <div class="rh sw" @mousedown.stop.prevent="startResize($event, i, 'sw')" />
              <div class="rh w"  @mousedown.stop.prevent="startResize($event, i, 'w')" />
            </div>

            <!-- Guide lines -->
            <div
              v-for="(gl, gi) in guideLines"
              :key="`gl-${gi}`"
              class="guide-line"
              :class="gl.type"
              :style="gl.type === 'v'
                ? { left: `${(gl.pos / Number(form.width)) * 100}%` }
                : { top: `${(gl.pos / Number(form.height)) * 100}%` }"
            />
          </div>

          <div
            v-for="(area, i) in form.areas"
            :key="i"
            class="card-sm"
            style="margin-bottom:0.75rem;"
          >
            <div class="flex items-center justify-between" style="margin-bottom:0.75rem;">
              <span
                class="badge"
                :style="{ background: areaColors[i % areaColors.length], color: '#fff', fontSize:'0.7rem' }"
              >
                區塊 {{ i + 1 }}
              </span>
              <button class="btn btn-ghost btn-sm" style="color:var(--color-error);" @click="removeArea(i)">✕</button>
            </div>

            <div class="form-row">
              <div class="form-group" style="margin:0;">
                <label>X</label>
                <input v-model.number="area.bounds.x" type="number" @change="clampArea(area)" />
              </div>
              <div class="form-group" style="margin:0;">
                <label>Y</label>
                <input v-model.number="area.bounds.y" type="number" @change="clampArea(area)" />
              </div>
            </div>
            <div class="form-row" style="margin-top:0.5rem;">
              <div class="form-group" style="margin:0;">
                <label>Width</label>
                <input v-model.number="area.bounds.width" type="number" @change="clampArea(area)" />
              </div>
              <div class="form-group" style="margin:0;">
                <label>Height</label>
                <input v-model.number="area.bounds.height" type="number" @change="clampArea(area)" />
              </div>
            </div>

            <!-- Action -->
            <div class="form-group" style="margin-top:0.75rem;margin-bottom:0.5rem;">
              <label>動作類型</label>
              <select v-model="area.action.type" @change="onActionTypeChange(area)">
                <option value="message">message（代發文字）</option>
                <option value="uri">uri（開啟網址）</option>
                <option value="postback">postback（觸發流程）</option>
                <option value="switch">switch（切換選單）</option>
              </select>
            </div>

            <div v-if="area.action.type === 'message'" class="form-group" style="margin:0;">
              <label>文字內容</label>
              <input v-model="area.action.text" placeholder="輸入代發文字" />
            </div>
            <div v-if="area.action.type === 'uri'" class="form-group" style="margin:0;">
              <label>網址</label>
              <input v-model="area.action.uri" placeholder="https://..." />
            </div>
            <div v-if="area.action.type === 'postback'" class="form-group" style="margin:0;">
              <label>Postback Data</label>
              <input v-model="area.action.data" placeholder="action=xxx" />
            </div>
            <div v-if="area.action.type === 'switch'">
              <div class="form-group" style="margin-bottom:0.5rem;">
                <label>選擇目標 Rich Menu</label>
                <select v-model="area.action.data">
                  <option disabled value="">請選擇要切換的選單...</option>
                  <template v-for="m in menus" :key="m.id">
                    <option v-if="m.id !== editingId" :value="`switchMenu=${m.id}`">{{ m.name }}</option>
                  </template>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div v-if="form.previewUrl" class="flex items-center gap-1" style="margin-bottom:1rem;">
          <input id="setDefault" v-model="form.setAsDefault" type="checkbox" style="width:auto;" />
          <label for="setDefault" style="font-size:0.875rem;color:var(--text-secondary);">設為預設選單</label>
        </div>

        <div class="flex gap-1" style="justify-content:flex-end;">
          <button class="btn btn-secondary" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="creating" @click="submitCreate">
            <span v-if="creating" class="spinner" style="width:14px;height:14px;" />
            🚀 部署到 LINE
          </button>
        </div>
      </div>
    </div>

    <!-- ── Upload Modal ── -->
    <div v-if="showUpload" class="modal-backdrop" @click.self="showUpload = false">
      <div class="modal" style="max-width:440px;">
        <div class="modal-header">
          <h3>上傳圖片</h3>
          <button class="btn btn-ghost btn-sm" @click="showUpload = false">✕</button>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:1rem;">
          為「{{ uploadTarget?.name }}」上傳 Rich Menu 圖片（PNG/JPEG）
        </p>

        <div
          class="upload-zone"
          :class="{ dragging: isUploadDragging }"
          @dragleave="isUploadDragging = false"
          @dragover.prevent="isUploadDragging = true"
          @drop.prevent="onDrop"
          @click="triggerFile"
        >
          <input ref="fileInput" type="file" accept="image/png,image/jpeg" style="display:none;" @change="onFileSelect" />
          <div v-if="previewUrl">
            <img :src="previewUrl" style="max-width:100%;border-radius:var(--radius-md);" />
          </div>
          <div v-else style="text-align:center;color:var(--text-muted);">
            <div style="font-size:2rem;">📁</div>
            <p style="font-size:0.875rem;">拖放圖片或點擊選擇</p>
            <p style="font-size:0.75rem;margin-top:0.25rem;">PNG / JPEG · 最大 1MB</p>
          </div>
        </div>

        <div class="flex gap-1" style="justify-content:flex-end;margin-top:1rem;">
          <button class="btn btn-secondary" @click="showUpload = false">取消</button>
          <button class="btn btn-primary" :disabled="!selectedFile || uploading" @click="submitUpload">
            <span v-if="uploading" class="spinner" style="width:14px;height:14px;" />
            上傳
          </button>
        </div>
      </div>
    </div>

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

// ── Data ──────────────────────────────────────────────────────
const menus = ref<any[]>([])
const loading = ref(true)
const showCreate = ref(false)
const showUpload = ref(false)
const creating = ref(false)
const uploading = ref(false)
const uploadTarget = ref<any>(null)
const selectedFile = ref<File | null>(null)
const previewUrl = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const isUploadDragging = ref(false)
const toasts = ref<{ id: number; msg: string; type: 'success' | 'error' }[]>([])

// ── Canvas drag / resize ──────────────────────────────────────
const canvasRef = ref<HTMLElement | null>(null)

interface DragState {
  type: 'move' | 'resize'
  areaIndex: number
  handle: string
  startClientX: number
  startClientY: number
  startBounds: { x: number; y: number; width: number; height: number }
}
const dragState = ref<DragState | null>(null)

// Guide lines shown during drag
const guideLines = ref<Array<{ type: 'h' | 'v'; pos: number }>>([])

// Detect overlapping areas (reactive)
const overlapSet = computed(() => {
  const result = new Set<number>()
  const areas = form.value.areas
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i].bounds
      const b = areas[j].bounds
      const overlapping = !(
        a.x + a.width <= b.x ||
        a.x >= b.x + b.width ||
        a.y + a.height <= b.y ||
        a.y >= b.y + b.height
      )
      if (overlapping) { result.add(i); result.add(j) }
    }
  }
  return result
})

const areaColors = [
  'rgba(6,199,85,0.6)',
  'rgba(59,130,246,0.6)',
  'rgba(245,158,11,0.6)',
  'rgba(239,68,68,0.6)',
  'rgba(168,85,247,0.6)',
  'rgba(236,72,153,0.6)',
]

// ── Snap helpers ──────────────────────────────────────────────
const SNAP_PX = 8 // threshold in screen pixels

function getSnapXs(excludeIdx: number, W: number): number[] {
  const pts = [0, W / 2, W]
  form.value.areas.forEach((a, i) => {
    if (i === excludeIdx) return
    pts.push(a.bounds.x, a.bounds.x + a.bounds.width)
  })
  return pts
}

function getSnapYs(excludeIdx: number, H: number): number[] {
  const pts = [0, H / 2, H]
  form.value.areas.forEach((a, i) => {
    if (i === excludeIdx) return
    pts.push(a.bounds.y, a.bounds.y + a.bounds.height)
  })
  return pts
}

/** Try snapping `val` to nearest point within threshold. Returns {snapped value, snap point, delta}. */
function trySnap(val: number, pts: number[], thresh: number): { val: number; pt: number | null; delta: number } {
  let best = { val, pt: null as number | null, delta: Infinity }
  for (const p of pts) {
    const d = Math.abs(val - p)
    if (d < thresh && d < best.delta) best = { val: p, pt: p, delta: d }
  }
  return best
}

const defaultForm = () => ({
  name: '',
  chatBarText: '選單',
  width: 0,
  height: 0,
  imageBase64: '',
  contentType: '',
  previewUrl: '',
  selected: true,
  setAsDefault: false,
  areas: [] as any[],
})
const form = ref(defaultForm())

// ── Fetch ─────────────────────────────────────────────────────
async function loadMenus() {
  loading.value = true
  menus.value = await $fetch<any[]>('/api/richmenu/list').catch(() => [])
  loading.value = false
}
onMounted(loadMenus)

// ── Create ────────────────────────────────────────────────────
const isCreateDragging = ref(false)
const createFileInput = ref<HTMLInputElement | null>(null)
const editingId = ref<string | null>(null)
const originalFormString = ref('')

function openCreateModal() {
  editingId.value = null
  form.value = defaultForm()
  originalFormString.value = JSON.stringify(form.value)
  showCreate.value = true
}

function openEditModal(menu: any) {
  editingId.value = menu.id
  form.value = {
    name: menu.name || '',
    chatBarText: menu.chatBarText || '選單',
    width: menu.size?.width || 2500,
    height: menu.size?.height || 843,
    imageBase64: '',
    contentType: '',
    previewUrl: menu.imageUrl || '',
    selected: true,
    setAsDefault: menu.isDefault || false,
    areas: JSON.parse(JSON.stringify(menu.areas || [])).map((a: any) => {
      // Restore switch menu state from postback
      if (a.action.type === 'postback' && a.action.data?.startsWith('switchMenu=')) {
        return { ...a, action: { type: 'switch', data: a.action.data } }
      }
      // Migrate legacy richmenuswitch
      if (a.action.type === 'richmenuswitch') {
        return { ...a, action: { type: 'switch', data: '' } }
      }
      return a
    })
  }
  originalFormString.value = JSON.stringify(form.value)
  showCreate.value = true
}

function closeCreateModal() {
  if (JSON.stringify(form.value) !== originalFormString.value) {
    if (!window.confirm('您有未儲存的變更，關閉將會遺失所有進度，確定要關閉嗎？')) {
      return
    }
  }
  showCreate.value = false
}

function triggerCreateFile() { createFileInput.value?.click() }

function handleCreateFile(file: File) {
  if (file.size > 1024 * 1024) return showToast('圖片不能超過 1MB', 'error')
  if (!['image/jpeg', 'image/png'].includes(file.type)) return showToast('僅支援 JPEG 與 PNG 格式', 'error')
  
  const img = new Image()
  const pUrl = URL.createObjectURL(file)
  
  img.onload = () => {
    const W = img.naturalWidth
    const H = img.naturalHeight
    
    // LINE check
    if (W < 800 || W > 2500 || H < 250 || (W / H) < 1.45) {
      return showToast(`尺寸不符規範 (W:800~2500, H>=250, W/H>=1.45)。目前：${W}x${H}`, 'error')
    }
    
    form.value.width = W
    form.value.height = H
    form.value.previewUrl = pUrl
    form.value.contentType = file.type
    
    const reader = new FileReader()
    reader.onload = () => {
      form.value.imageBase64 = (reader.result as string).split(',')[1] ?? ''
    }
    reader.readAsDataURL(file)
  }
  img.src = pUrl
}

function onCreateFileSelect(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleCreateFile(f)
}
function onCreateDrop(e: DragEvent) {
  isCreateDragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) handleCreateFile(f)
}

function addArea() {
  const W = Number(form.value.width) || 2500
  const H = Number(form.value.height) || 843
  form.value.areas.push({
    bounds: { x: 0, y: 0, width: Math.floor(W / 3), height: H },
    action: { type: 'postback', data: `action=area${form.value.areas.length + 1}` },
  })
}

function removeArea(i: number) {
  form.value.areas.splice(i, 1)
}

function clampArea(area: any) {
  const W = Number(form.value.width) || 2500
  const H = Number(form.value.height) || 843
  
  // 底部防呆限制大小
  if (area.bounds.width < 10) area.bounds.width = 10
  if (area.bounds.height < 10) area.bounds.height = 10
  if (area.bounds.width > W) area.bounds.width = W
  if (area.bounds.height > H) area.bounds.height = H

  // 修復 xy
  if (area.bounds.x < 0) area.bounds.x = 0
  if (area.bounds.y < 0) area.bounds.y = 0
  if (area.bounds.x + area.bounds.width > W) area.bounds.x = W - area.bounds.width
  if (area.bounds.y + area.bounds.height > H) area.bounds.y = H - area.bounds.height

  // 確保四捨五入
  area.bounds.x = Math.round(area.bounds.x)
  area.bounds.y = Math.round(area.bounds.y)
  area.bounds.width = Math.round(area.bounds.width)
  area.bounds.height = Math.round(area.bounds.height)
}

function clampAllAreas() {
  if (form.value.width < 100) form.value.width = 100
  if (form.value.height < 100) form.value.height = 100
  form.value.areas.forEach(clampArea)
}

function attachDocListeners() {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', stopDrag)
}
function detachDocListeners() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopDrag)
}

function startDrag(e: MouseEvent, index: number) {
  e.preventDefault()
  const area = form.value.areas[index]
  dragState.value = {
    type: 'move',
    areaIndex: index,
    handle: '',
    startClientX: e.clientX,
    startClientY: e.clientY,
    startBounds: { ...area.bounds },
  }
  attachDocListeners()
}

function startResize(e: MouseEvent, index: number, handle: string) {
  e.preventDefault()
  const area = form.value.areas[index]
  dragState.value = {
    type: 'resize',
    areaIndex: index,
    handle,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startBounds: { ...area.bounds },
  }
  attachDocListeners()
}

function onMouseMove(e: MouseEvent) {
  if (!dragState.value || !canvasRef.value) return

  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const W = Number(form.value.width)
  const H = Number(form.value.height)
  // Actual rendered height (padding-bottom trick means rect.height includes padding)
  const canvasHeight = rect.width * (H / W)
  const scaleX = W / rect.width
  const scaleY = H / canvasHeight

  const dx = (e.clientX - dragState.value.startClientX) * scaleX
  const dy = (e.clientY - dragState.value.startClientY) * scaleY

  const { areaIndex, type, handle, startBounds } = dragState.value
  const area = form.value.areas[areaIndex]
  const MIN = 80

  // Snap thresholds in canvas units (convert from screen px)
  const threshX = SNAP_PX * scaleX
  const threshY = SNAP_PX * scaleY
  const snapXs = getSnapXs(areaIndex, W)
  const snapYs = getSnapYs(areaIndex, H)

  const newGuides: Array<{ type: 'h' | 'v'; pos: number }> = []

  if (type === 'move') {
    const bw = startBounds.width
    const bh = startBounds.height
    let newX = Math.max(0, Math.min(W - bw, startBounds.x + dx))
    let newY = Math.max(0, Math.min(H - bh, startBounds.y + dy))

    // Snap X: try left edge, right edge, then center of block
    const leftSnap   = trySnap(newX,        snapXs, threshX)
    const rightSnap  = trySnap(newX + bw,   snapXs, threshX)
    const cxSnap     = trySnap(newX + bw/2, [W/2],  threshX)
    if (leftSnap.pt !== null && leftSnap.delta <= rightSnap.delta) {
      newX = leftSnap.val
      newGuides.push({ type: 'v', pos: leftSnap.pt })
    } else if (rightSnap.pt !== null) {
      newX = rightSnap.val - bw
      newGuides.push({ type: 'v', pos: rightSnap.pt })
    } else if (cxSnap.pt !== null) {
      newX = cxSnap.val - bw / 2
      newGuides.push({ type: 'v', pos: cxSnap.pt })
    }

    // Snap Y: try top edge, bottom edge, then center of block
    const topSnap    = trySnap(newY,        snapYs, threshY)
    const bottomSnap = trySnap(newY + bh,   snapYs, threshY)
    const cySnap     = trySnap(newY + bh/2, [H/2],  threshY)
    if (topSnap.pt !== null && topSnap.delta <= bottomSnap.delta) {
      newY = topSnap.val
      newGuides.push({ type: 'h', pos: topSnap.pt })
    } else if (bottomSnap.pt !== null) {
      newY = bottomSnap.val - bh
      newGuides.push({ type: 'h', pos: bottomSnap.pt })
    } else if (cySnap.pt !== null) {
      newY = cySnap.val - bh / 2
      newGuides.push({ type: 'h', pos: cySnap.pt })
    }

    area.bounds.x = Math.round(newX)
    area.bounds.y = Math.round(newY)
  }
  else {
    let { x, y, width, height } = startBounds

    if (handle.includes('e')) {
      let rEdge = startBounds.x + startBounds.width + dx
      const s = trySnap(rEdge, snapXs, threshX)
      if (s.pt !== null) { rEdge = s.val; newGuides.push({ type: 'v', pos: s.pt }) }
      width = Math.max(MIN, rEdge - x)
    }
    if (handle.includes('s')) {
      let bEdge = startBounds.y + startBounds.height + dy
      const s = trySnap(bEdge, snapYs, threshY)
      if (s.pt !== null) { bEdge = s.val; newGuides.push({ type: 'h', pos: s.pt }) }
      height = Math.max(MIN, bEdge - y)
    }
    if (handle.includes('w')) {
      let lEdge = startBounds.x + dx
      const s = trySnap(lEdge, snapXs, threshX)
      if (s.pt !== null) { lEdge = s.val; newGuides.push({ type: 'v', pos: s.pt }) }
      width = Math.max(MIN, startBounds.x + startBounds.width - lEdge)
      x = startBounds.x + startBounds.width - width
    }
    if (handle.includes('n')) {
      let tEdge = startBounds.y + dy
      const s = trySnap(tEdge, snapYs, threshY)
      if (s.pt !== null) { tEdge = s.val; newGuides.push({ type: 'h', pos: s.pt }) }
      height = Math.max(MIN, startBounds.y + startBounds.height - tEdge)
      y = startBounds.y + startBounds.height - height
    }

    // Clamp to canvas bounds
    x = Math.max(0, x)
    y = Math.max(0, y)
    width  = Math.min(W - x, width)
    height = Math.min(H - y, height)

    area.bounds.x      = Math.round(x)
    area.bounds.y      = Math.round(y)
    area.bounds.width  = Math.round(width)
    area.bounds.height = Math.round(height)
  }

  guideLines.value = newGuides
}

function stopDrag() {
  dragState.value = null
  guideLines.value = []
  detachDocListeners()
}

// Clean up listeners if modal closes mid-drag
watch(() => showCreate.value, (v) => { if (!v) stopDrag() })

function onActionTypeChange(area: any) {
  const t = area.action.type
  area.action = { type: t }
  if (t === 'message') area.action.text = ''
  if (t === 'uri') area.action.uri = ''
  if (t === 'postback') area.action.data = ''
  if (t === 'switch') area.action.data = ''
}

async function submitCreate() {
  if (!form.value.previewUrl) return showToast('請先上傳圖片', 'error')
  if (!form.value.name || !form.value.areas.length) return showToast('請填寫名稱並新增至少一個區塊', 'error')
  if (overlapSet.value.size > 0) return showToast('區塊有重疊，請調整後再部署', 'error')

  // 硬性檢查邊界
  const W = Number(form.value.width) || 2500
  const H = Number(form.value.height) || 843
  const isOutOfBounds = form.value.areas.some(a => 
    a.bounds.x < 0 || a.bounds.y < 0 || 
    (a.bounds.x + a.bounds.width) > W || 
    (a.bounds.y + a.bounds.height) > H
  )
  if (isOutOfBounds) {
    clampAllAreas()
    return showToast('發現超出邊界的區塊，已自動為您修正！請重新確認後再送出', 'error')
  }

  // Pre-process areas: transform "switch" back to "postback" for standard API payload
  const apiAreas = form.value.areas.map(a => {
    if (a.action.type === 'switch' || a.action.type === 'richmenuswitch') {
      return { ...a, action: { type: 'postback', data: a.action.data || 'switchMenu=' } }
    }
    return a
  })

  creating.value = true
  try {
    if (editingId.value) {
      // Edit Flow
      await $fetch(`/api/richmenu/${editingId.value}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          chatBarText: form.value.chatBarText,
          size: { width: form.value.width, height: form.value.height },
          selected: form.value.selected,
          areas: apiAreas,
          setAsDefault: form.value.setAsDefault,
          imageBase64: form.value.imageBase64,
          contentType: form.value.contentType,
        },
      })
      showToast('Rich Menu 已成功更新 ✅', 'success')
    } else {
      // Create Flow
      const docResponse = await $fetch('/api/richmenu/create', {
        method: 'POST',
        body: {
          name: form.value.name,
          chatBarText: form.value.chatBarText,
          size: { width: form.value.width, height: form.value.height },
          selected: form.value.selected,
          areas: apiAreas,
          setAsDefault: form.value.setAsDefault,
        },
      })
      
      await $fetch('/api/richmenu/upload', {
        method: 'POST',
        body: {
          richMenuId: docResponse.richMenuId,
          firestoreId: docResponse.id,
          imageBase64: form.value.imageBase64,
          contentType: form.value.contentType,
        },
      })
      showToast('Rich Menu 已成功建立與部署 ✅', 'success')
    }

    showCreate.value = false
    await loadMenus()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage ?? '建立失敗', 'error')
  }
  finally {
    creating.value = false
  }
}

// ── Upload ────────────────────────────────────────────────────
function openUpload(menu: any) {
  uploadTarget.value = menu
  selectedFile.value = null
  previewUrl.value = ''
  showUpload.value = true
}

function triggerFile() { fileInput.value?.click() }

function handleFile(file: File) {
  if (file.size > 1024 * 1024) return showToast('圖片不能超過 1MB', 'error')
  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
}

function onFileSelect(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleFile(f)
}

function onDrop(e: DragEvent) {
  isUploadDragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) handleFile(f)
}

async function submitUpload() {
  if (!selectedFile.value || !uploadTarget.value) return
  uploading.value = true
  try {
    const reader = new FileReader()
    const base64 = await new Promise<string>((res, rej) => {
      reader.onload = () => res((reader.result as string).split(',')[1] ?? '')
      reader.onerror = rej
      reader.readAsDataURL(selectedFile.value!)
    })

    await $fetch('/api/richmenu/upload', {
      method: 'POST',
      body: {
        richMenuId: uploadTarget.value.richMenuId,
        firestoreId: uploadTarget.value.id,
        imageBase64: base64,
        contentType: selectedFile.value.type,
      },
    })
    showToast('圖片上傳成功', 'success')
    showUpload.value = false
    await loadMenus()
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage ?? '上傳失敗', 'error')
  }
  finally {
    uploading.value = false
  }
}

// ── Set Default ───────────────────────────────────────────────
async function setAsDefault(menu: any) {
  try {
    await $fetch('/api/richmenu/setDefault', {
      method: 'POST',
      body: { richMenuId: menu.richMenuId, firestoreId: menu.id },
    })
    showToast('已設為預設選單', 'success')
    await loadMenus()
  }
  catch {
    showToast('設定失敗', 'error')
  }
}

// ── Delete ────────────────────────────────────────────────────
async function confirmDelete(menu: any) {
  if (!confirm(`確定刪除「${menu.name}」？此動作無法復原。`)) return
  try {
    await $fetch(`/api/richmenu/${menu.id}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    await loadMenus()
  }
  catch {
    showToast('刪除失敗', 'error')
  }
}

// ── Toast ─────────────────────────────────────────────────────
let toastId = 0
function showToast(msg: string, type: 'success' | 'error') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3500)
}

// ── Helpers ───────────────────────────────────────────────────
function getActionLabel(action: any) {
  if (!action) return '—'
  return action.text ?? action.uri ?? action.data ?? action.richMenuAliasId ?? '—'
}
</script>

<style scoped>
.menu-preview {
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.menu-preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}
.menu-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}
.menu-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 2rem;
  cursor: pointer;
  transition: border-color var(--t-fast);
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.upload-zone:hover, .upload-zone.dragging {
  border-color: var(--color-line);
  background: var(--color-line-glow);
}

/* ── Canvas area blocks ── */
.canvas-area {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255,255,255,0.4);
  cursor: grab;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.canvas-area:hover,
.canvas-area.area-active {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
  z-index: 10;
}
.canvas-area.area-active { cursor: grabbing; }

.area-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  pointer-events: none;
}

/* ── Resize handles ── */
.rh {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 2px solid rgba(0,0,0,0.4);
  border-radius: 2px;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.15s;
}
.canvas-area:hover .rh,
.canvas-area.area-active .rh { opacity: 1; }

/* Corners */
.rh.nw { top: -5px;  left: -5px;  cursor: nw-resize; }
.rh.ne { top: -5px;  right: -5px; cursor: ne-resize; }
.rh.se { bottom: -5px; right: -5px; cursor: se-resize; }
.rh.sw { bottom: -5px; left: -5px;  cursor: sw-resize; }

/* Edges */
.rh.n  { top: -5px;  left: 50%; transform: translateX(-50%); cursor: n-resize; }
.rh.s  { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.rh.e  { right: -5px; top: 50%; transform: translateY(-50%); cursor: e-resize; }
.rh.w  { left: -5px;  top: 50%; transform: translateY(-50%); cursor: w-resize; }

/* ── Overlap warning ── */
.canvas-area.area-overlap {
  border-color: #ff4d4d !important;
  box-shadow: 0 0 0 2px rgba(255, 77, 77, 0.4) !important;
  animation: pulse-overlap 1s ease-in-out infinite alternate;
}
@keyframes pulse-overlap {
  from { box-shadow: 0 0 0 2px rgba(255, 77, 77, 0.3); }
  to   { box-shadow: 0 0 0 4px rgba(255, 77, 77, 0.6); }
}

/* ── Snap guide lines ── */
.guide-line {
  position: absolute;
  pointer-events: none;
  z-index: 30;
  background: #00d4ff;
  box-shadow: 0 0 4px rgba(0, 212, 255, 0.8);
  animation: guide-in 0.08s ease-out;
}
.guide-line.v {
  top: -4px;
  bottom: -4px;
  width: 1px;
  transform: translateX(-50%);
}
.guide-line.h {
  left: -4px;
  right: -4px;
  height: 1px;
  transform: translateY(-50%);
}
@keyframes guide-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
</style>
