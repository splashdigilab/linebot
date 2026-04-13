<template>
  <div class="ar-layout">
    <!-- ── Left Sidebar ─────────────────────────────── -->
    <aside class="ar-sidebar">
      <div class="ar-sidebar-header">
        <span class="ar-sidebar-title">⚡ 自動回覆</span>
        <button class="btn btn-primary btn-sm" @click="openCreate">➕ 新增</button>
      </div>

      <div v-if="loading" style="padding:1.5rem;text-align:center;">
        <div class="spinner" />
      </div>

      <div v-else-if="!rules.length" class="ar-sidebar-empty">
        <span>尚無規則</span>
        <p class="text-xs text-muted">新增一條關鍵字規則來開始</p>
        <button class="btn btn-ghost btn-sm" @click="openCreate">立即新增</button>
      </div>

      <div v-else class="ar-list">
        <button
          v-for="rule in rules"
          :key="rule.id"
          class="ar-list-item"
          :class="{ active: selectedId === rule.id }"
          @click="selectRule(rule)"
        >
          <div class="ar-list-keyword">{{ rule.name || rule.keyword || '(未命名)' }}</div>
          <div class="ar-list-meta">
            <span class="badge" :class="rule.isActive ? 'badge-green' : 'badge-gray'" style="font-size:0.6rem;">
              {{ rule.isActive ? '啟用' : '停用' }}
            </span>
            <span class="text-xs text-muted truncate">→ {{ getModuleName(rule.moduleId) }}</span>
          </div>
        </button>
      </div>
    </aside>

    <!-- ── Right Editor ───────────────────────────── -->
    <main class="ar-editor">
      <div v-if="!selectedRule && !isCreating" class="ar-empty-state">
        <span class="empty-icon">⚡</span>
        <h3>選擇一條規則開始編輯</h3>
        <p>或點擊左側「➕ 新增」建立一條新的關鍵字觸發規則</p>
        <button class="btn btn-primary" @click="openCreate">新增規則</button>
      </div>

      <div v-else class="ar-editor-inner">
        <!-- Editor Header -->
        <div class="ar-editor-header">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
              <span v-if="isCreating" class="ar-editor-title">新增規則:</span>
              <input 
                v-model="form.name" 
                class="input-base" 
                style="font-size: 1.1rem; font-weight: 700; padding: 0.25rem 0.5rem; border: 1px solid transparent; border-bottom: 1px solid var(--border); box-shadow: none; background: transparent; max-width: 400px;" 
                placeholder="請輸入規則名稱..." 
                @keydown.enter.prevent="submitForm"
              />
            </div>
            <p class="text-sm text-muted" style="margin-top:0.25rem; padding-left: 0.5rem;">
              為這個自動回覆規則命名，方便後續管理
            </p>
          </div>
          <div class="flex gap-2" style="align-items: center;">
            <!-- Toggle Switch in Header -->
            <label v-if="!isCreating && selectedRule" class="toggle-label" style="margin-right: 0.75rem;">
              <div class="toggle-switch" :class="{ on: form.isActive }" @click="toggleActive">
                <div class="toggle-thumb" />
              </div>
              <span class="text-sm">{{ form.isActive ? '✅ 啟用中' : '⏸ 已停用' }}</span>
            </label>
            <button v-if="!isCreating && selectedRule" class="btn btn-danger btn-sm" @click="deleteRule">
              🗑️ 刪除
            </button>
            <button class="btn btn-secondary btn-sm" @click="cancelEdit">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="submitForm">
              <span v-if="saving" class="spinner" style="width:12px;height:12px;" />
              {{ isCreating ? '建立規則' : '儲存變更' }}
            </button>
          </div>
        </div>

        <!-- Editor Body -->
        <div class="ar-editor-body">
          <!-- Keyword section -->
          <div class="ar-section">
            <div class="ar-section-title">⚡ 觸發關鍵字</div>
            <p class="ar-section-hint">當使用者傳送的訊息<b>完全符合</b>此關鍵字時觸發（不區分大小寫）。</p>
            <input
              v-model="form.keyword"
              class="input-base"
              placeholder="例：你好、優惠、查詢商品"
              @keydown.enter.prevent="submitForm"
            />
          </div>

          <!-- Module picker -->
          <div class="ar-section">
            <div class="ar-section-title">🤖 指定回覆模組</div>
            <p class="ar-section-hint">觸發後，系統將自動發送下方所選模組中的所有訊息。</p>

            <div v-if="modulesLoading" style="padding:1rem;text-align:center;">
              <div class="spinner" />
            </div>
            <div v-else-if="!modules.length" class="ar-no-modules">
              尚無模組。請先前往「<NuxtLink to="/admin/flow" class="link">機器人模組</NuxtLink>」建立。
            </div>
            <div v-else class="module-picker">
              <button
                v-for="mod in modules"
                :key="mod.id"
                class="module-option"
                :class="{ selected: form.moduleId === mod.id }"
                @click="form.moduleId = mod.id"
              >
                <div class="module-option-check">{{ form.moduleId === mod.id ? '✓' : '' }}</div>
                <div class="module-option-info">
                  <div class="module-option-name">{{ mod.name }}</div>
                  <div class="module-option-meta">{{ mod.messages?.length ?? 0 }} 則訊息</div>
                </div>
                <span class="badge" :class="mod.isActive ? 'badge-green' : 'badge-gray'" style="font-size:0.6rem; margin-left:auto;">
                  {{ mod.isActive ? '啟用' : '停用' }}
                </span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </main>

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

// ── State ────────────────────────────────────────────────
const rules = ref<any[]>([])
const modules = ref<any[]>([])
const loading = ref(true)
const modulesLoading = ref(true)
const saving = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const toasts = ref<{ id: number; msg: string; type: 'success' | 'error' }[]>([])

const defaultForm = () => ({
  name: '',
  keyword: '',
  moduleId: '',
  isActive: true,
})
const form = ref(defaultForm())

const selectedRule = computed(() => rules.value.find(r => r.id === selectedId.value) ?? null)

// ── Load ─────────────────────────────────────────────────
async function loadRules() {
  loading.value = true
  rules.value = await $fetch<any[]>('/api/auto-reply/list').catch(() => [])
  loading.value = false
}

async function loadModules() {
  modulesLoading.value = true
  modules.value = await $fetch<any[]>('/api/flow/list').catch(() => [])
  modulesLoading.value = false
}

onMounted(() => {
  loadRules()
  loadModules()
})

// ── Select / Create ───────────────────────────────────────
function selectRule(rule: any) {
  isCreating.value = false
  selectedId.value = rule.id
  form.value = {
    name: rule.name ?? '',
    keyword: rule.keyword ?? '',
    moduleId: rule.moduleId ?? '',
    isActive: rule.isActive ?? true,
  }
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  form.value = defaultForm()
}

function cancelEdit() {
  if (selectedRule.value) {
    selectRule(selectedRule.value)
    isCreating.value = false
  } else {
    isCreating.value = false
    selectedId.value = null
    form.value = defaultForm()
  }
}

// ── Save / Delete ─────────────────────────────────────────
async function submitForm() {
  if (!form.value.name.trim()) return showToast('請輸入規則名稱', 'error')
  if (!form.value.keyword.trim()) return showToast('請輸入觸發關鍵字', 'error')
  if (!form.value.moduleId) return showToast('請選擇一個機器人模組', 'error')

  saving.value = true
  try {
    if (isCreating.value) {
      const res = await $fetch<any>('/api/auto-reply/create', {
        method: 'POST',
        body: { name: form.value.name.trim(), keyword: form.value.keyword.trim(), moduleId: form.value.moduleId, isActive: form.value.isActive },
      })
      showToast('規則已建立 ✅', 'success')
      await loadRules()
      const newRule = rules.value.find(r => r.id === res.id) ?? rules.value[0]
      if (newRule) selectRule(newRule)
      isCreating.value = false
    } else {
      await $fetch(`/api/auto-reply/${selectedId.value}`, {
        method: 'PUT',
        body: { name: form.value.name.trim(), keyword: form.value.keyword.trim(), moduleId: form.value.moduleId, isActive: form.value.isActive },
      })
      showToast('規則已更新 ✅', 'success')
      await loadRules()
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
    await $fetch(`/api/auto-reply/${selectedId.value}`, { method: 'PUT', body: { isActive: newVal } })
    form.value.isActive = newVal
    await loadRules()
    showToast(newVal ? '已啟用' : '已停用', 'success')
  } catch {
    showToast('更新失敗', 'error')
  }
}

async function deleteRule() {
  if (!selectedId.value || !confirm(`確定刪除「${form.value.name || form.value.keyword}」這條規則？`)) return
  try {
    await $fetch(`/api/auto-reply/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    isCreating.value = false
    form.value = defaultForm()
    await loadRules()
  } catch {
    showToast('刪除失敗', 'error')
  }
}

// ── Helpers ───────────────────────────────────────────────
function getModuleName(moduleId: string) {
  return modules.value.find(m => m.id === moduleId)?.name ?? '未選擇模組'
}

let toastId = 0
function showToast(msg: string, type: 'success' | 'error') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3500)
}
</script>

<style scoped>
.ar-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  margin: -2rem -2.5rem;
}

/* ── Sidebar ── */
.ar-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ar-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ar-sidebar-title {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.ar-sidebar-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ar-list-item {
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

.ar-list-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.ar-list-item.active {
  background: var(--color-line-glow);
  border-color: var(--color-line);
  color: var(--color-line);
}

.ar-list-keyword {
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.25rem;
}

.ar-list-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* ── Editor ── */
.ar-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ar-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
  padding: 3rem;
}
.ar-empty-state h3 { color: var(--text-primary); font-size: 1.1rem; }

.ar-editor-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.ar-editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
  gap: 1rem;
}

.ar-editor-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.ar-editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* ── Sections ── */
.ar-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.ar-section-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ar-section-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.ar-no-modules {
  padding: 1rem;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border);
  font-size: 0.875rem;
  color: var(--text-muted);
}

.link {
  color: var(--color-primary, var(--color-line));
  text-decoration: underline;
}

/* ── Module Picker ── */
.module-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.module-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  width: 100%;
}

.module-option:hover {
  border-color: var(--color-line);
  background: var(--color-line-glow);
}

.module-option.selected {
  border-color: var(--color-line);
  background: var(--color-line-glow);
}

.module-option-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
  color: var(--color-line);
  background: transparent;
  transition: background 0.15s, border-color 0.15s;
}

.module-option.selected .module-option-check {
  background: var(--color-line);
  border-color: var(--color-line);
  color: #fff;
}

.module-option-info { flex: 1; min-width: 0; }

.module-option-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-option-meta {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 0.1rem;
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

.toggle-switch.on { background: var(--color-line); border-color: var(--color-line); }

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

.toggle-switch.on .toggle-thumb { left: calc(100% - 18px); }

/* ── Toast ── */
.toast-bar {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 9999;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: slideIn 0.25s ease;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
}

.toast.success { border-color: var(--color-line); }
.toast.error { border-color: var(--color-error, #e53e3e); }

@keyframes slideIn {
  from { opacity: 0; transform: translateX(1rem); }
  to   { opacity: 1; transform: translateX(0); }
}

/* ── Input ── */
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
.input-base:focus { border-color: var(--color-line); }
</style>
