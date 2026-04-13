<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Rich Menu 設定</h1>
        <p>建立並部署 LINE Rich Menu</p>
      </div>
      <el-button type="primary" @click="openCreateModal">
        ➕ 新增 Rich Menu
      </el-button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner" />
    </div>

    <!-- Empty -->
    <el-card v-else-if="!menus.length">
      <div class="empty-state">
        <span class="empty-icon">🗂️</span>
        <h3>尚無 Rich Menu</h3>
        <p>點擊右上角「新增 Rich Menu」開始建立您的第一個選單</p>
        <el-button type="primary" @click="openCreateModal">建立選單</el-button>
      </div>
    </el-card>

    <!-- Menu List -->
    <el-card v-else shadow="hover" body-style="padding: 0;">
      <el-table :data="sortedMenus" style="width: 100%" @row-click="openEditModal" row-class-name="cursor-pointer">
        <el-table-column label="預覽圖片" width="120">
          <template #default="{ row }">
            <el-image
              v-if="row.imageUrl"
              :src="row.imageUrl"
              fit="contain"
              style="height: 60px; border-radius: var(--radius-sm); background: var(--bg-elevated);"
            />
            <div v-else style="height: 60px; width: 60px; background: var(--bg-elevated); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              🖼️
            </div>
          </template>
        </el-table-column>
        <el-table-column label="選單名稱">
          <template #default="{ row }">
            <div style="font-weight: 600;">{{ row.name }}</div>
            <div class="text-xs text-muted" style="font-weight: 400; margin-top: 0.2rem;">{{ row.areas?.length ?? 0 }} 個區塊</div>
          </template>
        </el-table-column>
        <el-table-column label="狀態">
          <template #default="{ row }">
            <el-tag v-if="row.isDefault" type="success" effect="light">⭐ 預設選單</el-tag>
            <span v-else class="text-muted text-sm">一般選單</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ── Create Modal ── -->
    <el-dialog
      v-model="showCreate"
      :title="editingId ? '編輯 Rich Menu' : '新增 Rich Menu'"
      width="700px"
      :before-close="closeCreateModal"
    >
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="選單名稱">
          <el-input v-model="form.name" placeholder="例：主選單" />
        </el-form-item>

        <el-form-item label="Chat Bar 文字">
          <el-input v-model="form.chatBarText" placeholder="選單" />
        </el-form-item>

        <!-- Create Image Upload Zone -->
        <el-form-item :label="`1. 上傳選單背景圖 (${editingId ? '選填，若不上傳則自動沿用舊圖' : '必要'})`">
          <div
            class="upload-zone"
            :class="{ dragging: isCreateDragging }"
            @dragleave="isCreateDragging = false"
            @dragover.prevent="isCreateDragging = true"
            @drop.prevent="onCreateDrop"
            @click="triggerCreateFile"
            style="min-height: 120px; padding: 1.5rem;"
          >
            <input ref="createFileInput" type="file" :accept="IMAGE_ACCEPT_ATTR" style="display:none;" @change="onCreateFileSelect" />
            <div v-if="form.previewUrl" style="text-align:center;">
              <div class="badge badge-green" style="margin-bottom:0.5rem;font-size:0.875rem;">✅ 圖片已上傳 ({{ form.width }} × {{ form.height }})</div>
              <p class="text-xs text-muted">點擊或拖放到此處可重新上傳</p>
            </div>
            <div v-else style="text-align:center;color:var(--text-muted);">
              <div style="font-size:1.75rem;margin-bottom:0.25rem;">🖼️</div>
              <p style="font-size:0.875rem;font-weight:600;">拖放圖片或點擊選擇</p>
              <p class="text-xs text-muted" style="margin-top:0.25rem;">JPG / PNG · 最大 500KB (建議 2500x1686 或 2500x843)</p>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="預設顯示">
          <el-select v-model="form.selected" style="width: 100%">
            <el-option :value="true" label="是" />
            <el-option :value="false" label="否" />
          </el-select>
        </el-form-item>

        <!-- Areas Editor (only visible if image uploaded) -->
        <div v-if="form.previewUrl" style="margin-bottom:1rem;">
          <div class="flex items-center justify-between" style="margin-bottom:0.75rem;">
            <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">
              2. 區塊設定（{{ form.areas.length }} 個）
            </label>
            <el-button size="small" @click="addArea">➕ 新增區塊</el-button>
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

          <el-card
            v-for="(area, i) in form.areas"
            :key="i"
            shadow="never"
            style="margin-bottom:0.75rem;"
            body-style="padding: 1rem;"
          >
            <template #header>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <el-tag
                  :color="areaColors[i % areaColors.length]"
                  style="color: #fff; border: none;"
                >
                  區塊 {{ i + 1 }}
                </el-tag>
                <el-button link type="danger" @click="removeArea(i)">✕ 移除</el-button>
              </div>
            </template>

            <el-row :gutter="10" style="margin-bottom: 0.5rem;">
              <el-col :span="12">
                <el-form-item label="X" style="margin-bottom: 0;">
                  <el-input-number v-model="area.bounds.x" :min="0" :controls="false" style="width: 100%;" @change="clampArea(area)" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="Y" style="margin-bottom: 0;">
                  <el-input-number v-model="area.bounds.y" :min="0" :controls="false" style="width: 100%;" @change="clampArea(area)" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="10">
              <el-col :span="12">
                <el-form-item label="Width" style="margin-bottom: 0;">
                  <el-input-number v-model="area.bounds.width" :min="0" :controls="false" style="width: 100%;" @change="clampArea(area)" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="Height" style="margin-bottom: 0;">
                  <el-input-number v-model="area.bounds.height" :min="0" :controls="false" style="width: 100%;" @change="clampArea(area)" />
                </el-form-item>
              </el-col>
            </el-row>

            <!-- Action -->
            <el-form-item label="動作類型" style="margin-top: 0.75rem; margin-bottom: 0.5rem;">
              <el-select v-model="area.action.type" style="width: 100%;" @change="onActionTypeChange(area)">
                <el-option value="message" label="message（代發文字）" />
                <el-option value="uri" label="uri（開啟網址）" />
                <el-option value="postback" label="postback（觸發機器人模組）" />
                <el-option value="switch" label="switch（切換選單）" />
              </el-select>
            </el-form-item>

            <el-form-item v-if="area.action.type === 'message'" label="文字內容" style="margin-bottom: 0;">
              <el-input v-model="area.action.text" placeholder="輸入代發文字" />
            </el-form-item>
            <el-form-item v-if="area.action.type === 'uri'" label="網址" style="margin-bottom: 0;">
              <el-input v-model="area.action.uri" placeholder="https://..." />
            </el-form-item>
            <el-form-item v-if="area.action.type === 'postback'" label="選擇目標模組" style="margin-bottom: 0;">
              <el-select v-model="area.action.data" placeholder="請選擇要觸發的機器人模組..." style="width: 100%;">
                <el-option v-for="mod in modules" :key="mod.id" :value="`triggerModule=${mod.id}`" :label="mod.name" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="area.action.type === 'switch'" label="選擇目標 Rich Menu" style="margin-bottom: 0;">
              <el-select v-model="area.action.data" placeholder="請選擇要切換的選單..." style="width: 100%;">
                <template v-for="m in menus" :key="m.id">
                  <el-option v-if="m.id !== editingId" :value="`switchMenu=${m.id}`" :label="m.name" />
                </template>
              </el-select>
              <!-- Warn if current selection points to a deleted menu -->
              <div
                v-if="area.action.data && area.action.data !== '' && !menus.find(m => m.id !== editingId && `switchMenu=${m.id}` === area.action.data)"
                style="color:var(--color-error);font-size:0.75rem;margin-top:0.35rem;"
              >
                ⚠️ 所選的目標選單已不存在，請重新選擇
              </div>
            </el-form-item>
          </el-card>
        </div>

        <el-form-item v-if="form.previewUrl">
          <el-checkbox v-model="form.setAsDefault">設為預設選單</el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button v-if="editingId" type="danger" style="float: left;" @click="confirmDeleteFromModal">刪除</el-button>
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" :loading="creating" @click="submitCreate">
            🚀 部署到 LINE
          </el-button>
        </span>
      </template>
    </el-dialog>



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
import {
  IMAGE_ACCEPT_ATTR,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
} from '~~/shared/upload-rules'

definePageMeta({ middleware: 'auth', layout: 'default' })

// ── Data ──────────────────────────────────────────────────────
const menus = ref<any[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const toasts = ref<{ id: number; msg: string; type: 'success' | 'error' }[]>([])

const sortedMenus = computed(() => {
  return [...menus.value].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return 0;
  });
})

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

const modules = ref<any[]>([])

// ── Fetch ─────────────────────────────────────────────────────
async function loadMenus() {
  loading.value = true
  try {
    const [menusData, modulesData] = await Promise.all([
      $fetch<any[]>('/api/richmenu/list'),
      $fetch<any[]>('/api/flow/list')
    ])
    menus.value = menusData
    modules.value = modulesData
  } catch (err) {
    menus.value = []
    modules.value = []
  }
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
      // Restore switch menu state from legacy postback format
      if (a.action.type === 'postback' && a.action.data?.startsWith('switchMenu=')) {
        return { ...a, action: { type: 'switch', data: a.action.data } }
      }
      // Restore from native richmenuswitch: look up target menu by aliasId
      if (a.action.type === 'richmenuswitch') {
        const richMenuAliasId: string = a.action.richMenuAliasId ?? ''
        // Find the target menu in our list whose aliasId matches
        const targetMenu = menus.value.find(m => m.aliasId === richMenuAliasId)
        const targetFirestoreId = targetMenu?.id ?? ''
        return { ...a, action: { type: 'switch', data: `switchMenu=${targetFirestoreId}` } }
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
  if (file.size > IMAGE_MAX_BYTES) return showToast('圖片不能超過 500KB', 'error')
  if (!IMAGE_MIME_TYPES.includes(file.type)) return showToast('僅支援 JPG / PNG 格式', 'error')
  
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
    // LINE Rich Menu 只支援 JPEG/PNG，將可上傳格式一律轉為 PNG 再送出
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return showToast('圖片處理失敗，請重試', 'error')
    ctx.drawImage(img, 0, 0)
    const pngDataUrl = canvas.toDataURL('image/png')
    form.value.contentType = 'image/png'
    form.value.imageBase64 = pngDataUrl.split(',')[1] ?? ''
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

  // Pre-process areas: transform "switch" to LINE's native richmenuswitch action
  // Look up the target menu's aliasId from the menus list (more reliable than string derivation)
  const apiAreas = form.value.areas.map(a => {
    if (a.action.type === 'switch' || a.action.type === 'richmenuswitch') {
      const targetFirestoreId = (a.action.data ?? '').replace('switchMenu=', '')
      const targetMenu = menus.value.find(m => m.id === targetFirestoreId)
      if (!targetMenu) {
        throw new Error(`切換選單目標「${targetFirestoreId}」已不存在，請重新選擇目標選單再儲存`)
      }
      if (!targetMenu.aliasId) {
        throw new Error(`目標選單「${targetMenu.name}」尚未建立快速切換別名，請先上傳圖片再試一次`)
      }
      return { ...a, action: { type: 'richmenuswitch', richMenuAliasId: targetMenu.aliasId, data: `switchMenu=${targetFirestoreId}` } }
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
    showToast(e?.data?.statusMessage ?? e?.message ?? '建立失敗', 'error')
  }
  finally {
    creating.value = false
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
async function confirmDeleteFromModal() {
  if (!editingId.value) return
  const menuName = form.value.name
  if (!confirm(`確定刪除「${menuName}」？此動作無法復原。`)) return
  try {
    await $fetch(`/api/richmenu/${editingId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    showCreate.value = false
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

