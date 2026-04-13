<template>
  <AdminSplitLayout :is-empty="!selectedRule && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">⚡ 自動回覆</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!rules.length" class="split-sidebar-empty">
        <span>尚無規則</span>
        <p class="text-xs text-muted">新增一條關鍵字規則來開始</p>
        <el-button size="small" type="primary" plain @click="openCreate">立即新增</el-button>
      </div>
      <div v-else class="split-list">
        <button
          v-for="rule in rules"
          :key="rule.id"
          class="split-list-item"
          :class="{ active: selectedId === rule.id }"
          @click="selectRule(rule)"
        >
          <div class="split-list-name">{{ rule.name || rule.keyword || '(未命名)' }}</div>
          <div class="split-list-meta">
            <span class="badge" :class="rule.isActive ? 'badge-green' : 'badge-gray'" style="font-size:0.6rem;">
              {{ rule.isActive ? '啟用' : '停用' }}
            </span>
            <span class="text-xs text-muted truncate">→ {{ getModuleName(rule.moduleId) }}</span>
          </div>
        </button>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">⚡</span>
      <h3>選擇一條規則開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立一條新的關鍵字觸發規則</p>
      <el-button type="primary" @click="openCreate">新增規則</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span v-if="isCreating" class="split-editor-title">新增規則:</span>
          <el-input
            v-model="form.name"
            size="large"
            style="max-width: 400px;"
            placeholder="請輸入規則名稱..."
            @keydown.enter.prevent="submitForm"
          />
        </div>
        <p class="text-sm text-muted" style="margin-top:0.25rem; padding-left: 0.5rem;">
          為這個自動回覆規則命名，方便後續管理
        </p>
      </div>
      <div class="flex gap-2" style="align-items: center;">
        <el-button v-if="!isCreating && selectedRule" type="danger" @click="deleteRule">
          🗑️ 刪除
        </el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立規則' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="ar-editor-body">
        <!-- Status section -->
        <div class="ar-section">
          <div class="ar-section-title">📍 狀態</div>
          <p class="ar-section-hint" style="margin-bottom: 0.5rem;">停用的規則將不會被觸發。</p>
          <el-switch
            v-model="form.isActive"
            active-text="啟用中"
            inactive-text="已停用"
            style="--el-switch-on-color: var(--color-success);"
          />
        </div>

        <!-- Keyword section -->
        <div class="ar-section">
          <div class="ar-section-title">⚡ 觸發關鍵字</div>
          <p class="ar-section-hint">當使用者傳送的訊息<b>完全符合</b>此關鍵字時觸發（不區分大小寫）。</p>
          <el-input
            v-model="form.keyword"
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
    </template>
  </AdminSplitLayout>

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

