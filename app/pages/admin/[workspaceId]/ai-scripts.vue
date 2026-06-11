<template>
  <AdminSplitLayout :is-empty="!selectedScript && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">🧩 腳本</span>
      <el-button type="primary" size="small" @click="openCreate">➕ 新增</el-button>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <div v-if="loading && !scripts.length" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!scripts.length" class="split-sidebar-empty">
        <span>尚無腳本</span>
        <p class="text-xs text-muted">建一條情境流程，把多步驟客服變成自動流程</p>
        <el-button size="small" type="primary" plain @click="openCreate">立即新增</el-button>
      </div>
      <div v-else ref="listEl" class="split-list" @scroll.passive="onSidebarListScroll">
        <AdminSplitListItem
          v-for="script in scripts"
          :key="script.id"
          :title="script.name || '(未命名腳本)'"
          :active="selectedId === script.id"
          time-in-title-row
          title-row-chip
          :chip-text="script.enabled ? '啟用' : '停用'"
          :chip-tone="script.enabled ? 'success' : 'neutral'"
          :meta-text="triggerSummary(script)"
          :meta-truncate="true"
          @select="selectScript(script)"
        />
        <div v-if="loadingMore" class="admin-sidebar-load-more">
          <div class="spinner" />
        </div>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">🧩</span>
      <h3>選擇一條腳本開始編輯</h3>
      <p>或點擊左側「➕ 新增」建立第一條情境流程</p>
      <el-button type="primary" @click="openCreate">新增腳本</el-button>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <AdminEditorHeaderTitle
        v-model="form.name"
        field-label="腳本名稱"
        create-prefix="新增腳本:"
        placeholder="例：訂單查詢、退換貨流程"
        caption="為這條情境流程取個名"
        :is-creating="isCreating"
        @enter="submitForm"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button v-if="!isCreating && selectedScript" type="danger" @click="deleteScript">🗑️ 刪除</el-button>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isCreating ? '建立腳本' : '儲存變更' }}
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div class="ai-scripts-body admin-panel-stack">
        <!-- 啟用 + 優先度 -->
        <div class="message-card scripts-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⚙️ 基本設定</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="admin-field-group">
              <AdminFieldLabel text="啟用此腳本" tight />
              <el-switch
                v-model="form.enabled"
                active-text="啟用"
                inactive-text="停用"
              />
              <p class="scripts-section-hint">關掉後此腳本不會被觸發；AI 保底仍照常運作。</p>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel :text="`觸發優先度（${form.priority}）`" tight />
              <el-slider v-model="form.priority" :min="1" :max="100" :step="1" />
              <p class="scripts-section-hint">多個腳本同時命中時，數字越大越優先。預設 50。</p>
            </div>
          </div>
        </div>

        <!-- 節點清單 -->
        <div class="message-card scripts-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">🔗 流程節點</span>
              <span class="text-xs text-muted">流程：觸發 → 收集（可多個）→ 回覆</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="scripts-node-list">
              <div v-for="(node, idx) in form.nodes" :key="node.id" class="scripts-node-card">
                <div class="scripts-node-header">
                  <span class="scripts-node-badge" :class="nodeBadgeClass(node.type)">
                    {{ nodeIcon(node.type) }} {{ nodeTypeLabel(node.type) }}
                  </span>
                  <span class="text-xs text-muted">節點 {{ idx + 1 }}</span>
                  <el-button
                    v-if="node.type !== 'trigger'"
                    size="small"
                    type="danger"
                    plain
                    class="scripts-node-delete"
                    @click="removeNode(node.id)"
                  >
                    移除
                  </el-button>
                </div>

                <!-- Trigger -->
                <template v-if="node.type === 'trigger'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="關鍵字（任一命中即觸發）" tight />
                    <el-input
                      :model-value="node.keywords.join('，')"
                      placeholder="例：退換貨，退費，要退（用逗號或空白分隔）"
                      @update:model-value="updateKeywords(node, $event)"
                    />
                  </div>
                </template>

                <!-- Collect -->
                <template v-else-if="node.type === 'collect'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="問題（要問使用者的話）" tight />
                    <el-input v-model="node.question" placeholder="例：請輸入您的訂單編號" />
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="變數名稱（後面 {{ variable }} 取用）" tight />
                    <el-input v-model="node.fieldName" placeholder="例：order_id" />
                  </div>
                </template>

                <!-- Reply -->
                <template v-else-if="node.type === 'reply'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="回覆文字（可用 {{ 變數名 }}）" tight />
                    <el-input
                      v-model="node.text"
                      type="textarea"
                      :rows="3"
                      placeholder="例：您的訂單 {{ order_id }} 已收到，將盡快為您處理"
                    />
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="回覆後直接轉真人" tight />
                    <el-switch v-model="node.thenHandoff" active-text="開" inactive-text="關" />
                  </div>
                </template>
              </div>
            </div>

            <div class="scripts-add-actions">
              <el-button size="small" plain @click="addNode('collect')">＋ 收集節點</el-button>
              <el-button size="small" plain @click="addNode('reply')">＋ 回覆節點</el-button>
            </div>

            <p class="scripts-section-hint">
              💡 順序依照清單由上而下執行。新增收集節點時會自動接到流程末端、原最後節點變成它的下一步。
            </p>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from 'uuid'
import type {
  ScriptCollectNode,
  ScriptDoc,
  ScriptNode,
  ScriptReplyNode,
  ScriptTriggerNode,
} from '~~/shared/types/ai-script'
import { DEFAULT_COLLECT_EXPIRE_MS, DEFAULT_SCRIPT_PRIORITY } from '~~/shared/types/ai-script'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

const { apiFetch } = useWorkspace()
const { showToast } = useAdminToast()

interface ScriptRow extends ScriptDoc { id: string }

const {
  items: scripts,
  loading,
  loadingMore,
  listEl,
  load: loadScripts,
  onScroll: onSidebarListScroll,
} = useWorkspaceSidebarList<ScriptRow>('/api/ai/scripts/list')

const saving = ref(false)
const selectedId = ref<string | null>(null)
const isCreating = ref(false)

function defaultTriggerNode(nextId: string): ScriptTriggerNode {
  return { id: uuidv4(), type: 'trigger', keywords: [], priority: DEFAULT_SCRIPT_PRIORITY, next: nextId }
}
function defaultReplyNode(): ScriptReplyNode {
  return { id: uuidv4(), type: 'reply', text: '', thenHandoff: false }
}
function defaultCollectNode(nextId: string): ScriptCollectNode {
  return { id: uuidv4(), type: 'collect', question: '', fieldName: '', expireMs: DEFAULT_COLLECT_EXPIRE_MS, next: nextId }
}

function blankForm() {
  const trigger = defaultTriggerNode('')
  const reply = defaultReplyNode()
  trigger.next = reply.id
  return {
    name: '',
    enabled: true,
    priority: DEFAULT_SCRIPT_PRIORITY,
    rootNodeId: trigger.id,
    nodes: [trigger, reply] as ScriptNode[],
  }
}

const form = ref(blankForm())
const { markClean, confirmLeaveIfDirty } = useUnsavedChanges({
  getSnapshot: () => form.value,
})

const selectedScript = computed(() => scripts.value.find(s => s.id === selectedId.value) ?? null)

// ── List helpers ───────────────────────────────────────────────────
function triggerSummary(script: ScriptRow): string {
  const trig = script.nodes?.find(n => n.type === 'trigger') as ScriptTriggerNode | undefined
  if (!trig?.keywords?.length) return '無關鍵字'
  return `🔑 ${trig.keywords.slice(0, 3).join('、')}${trig.keywords.length > 3 ? '⋯' : ''}`
}

function nodeIcon(type: string) {
  if (type === 'trigger') return '🔑'
  if (type === 'collect') return '📋'
  return '💬'
}

function nodeTypeLabel(type: string) {
  if (type === 'trigger') return '觸發'
  if (type === 'collect') return '收集'
  return '回覆'
}

function nodeBadgeClass(type: string) {
  if (type === 'trigger') return 'scripts-node-badge--trigger'
  if (type === 'collect') return 'scripts-node-badge--collect'
  return 'scripts-node-badge--reply'
}

// ── Edit ───────────────────────────────────────────────────────────
function selectScript(script: ScriptRow, opts?: { skipDiscardConfirm?: boolean }) {
  if (!opts?.skipDiscardConfirm && !confirmLeaveIfDirty()) return
  isCreating.value = false
  selectedId.value = script.id
  form.value = {
    name: script.name,
    enabled: script.enabled,
    priority: script.priority || DEFAULT_SCRIPT_PRIORITY,
    rootNodeId: script.rootNodeId,
    nodes: deepCloneNodes(script.nodes),
  }
  markClean()
}

function openCreate() {
  if (!confirmLeaveIfDirty()) return
  isCreating.value = true
  selectedId.value = null
  form.value = blankForm()
  markClean()
}

function cancelEdit() {
  if (!confirmLeaveIfDirty()) return
  if (selectedScript.value) {
    selectScript(selectedScript.value, { skipDiscardConfirm: true })
    isCreating.value = false
  }
  else {
    isCreating.value = false
    selectedId.value = null
    form.value = blankForm()
    markClean()
  }
}

function deepCloneNodes(nodes: ScriptNode[] = []): ScriptNode[] {
  return JSON.parse(JSON.stringify(nodes || []))
}

// ── Node operations ─────────────────────────────────────────────────
function updateKeywords(node: ScriptTriggerNode, value: string) {
  node.keywords = String(value || '')
    .split(/[\n,，、\s]+/g)
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function addNode(type: 'collect' | 'reply') {
  const nodes = form.value.nodes
  // 把節點插在「最後一個 reply 之前」（如果有 reply）
  const replyIdx = nodes.findIndex(n => n.type === 'reply')
  let newNode: ScriptCollectNode | ScriptReplyNode
  if (type === 'collect') {
    newNode = defaultCollectNode('')
  }
  else {
    newNode = defaultReplyNode()
  }

  if (type === 'collect') {
    // 找前一個節點（trigger or 最後 collect）→ 把它的 next 改成新節點 id；新節點的 next 設為 reply id
    const reply = nodes.find(n => n.type === 'reply') as ScriptReplyNode | undefined
    if (!reply) {
      // 沒 reply：直接插到最末，next 留空（驗證會擋）
      nodes.push(newNode)
      return
    }
    // 找指到 reply 的那個節點
    const beforeReply = nodes.find(n => (n as any).next === reply.id) as ScriptTriggerNode | ScriptCollectNode | undefined
    if (beforeReply) {
      (beforeReply as any).next = newNode.id
    }
    (newNode as ScriptCollectNode).next = reply.id
    nodes.splice(replyIdx, 0, newNode) // 插在 reply 之前
  }
  else {
    // 新增 reply：通常只會有一個。若已有 reply，這顆會被當作備用、需要手動接（驗證會擋）
    nodes.push(newNode)
  }
}

function removeNode(id: string) {
  const nodes = form.value.nodes
  const idx = nodes.findIndex(n => n.id === id)
  if (idx < 0) return
  const removed = nodes[idx]
  if (!removed || removed.type === 'trigger') return // trigger 不可移除

  // 修補：把指向 removed.id 的節點 next 改成 removed.next（若是 collect）
  for (const n of nodes) {
    if ((n.type === 'trigger' || n.type === 'collect') && n.next === id) {
      n.next = removed.type === 'collect' ? removed.next : ''
    }
  }
  nodes.splice(idx, 1)
}

// ── Load / Save / Delete ────────────────────────────────────────────
onMounted(() => loadScripts(true))

async function submitForm() {
  const name = form.value.name.trim()
  if (!name) return showToast('請輸入腳本名稱', 'error')
  // trigger 同步 priority
  const trig = form.value.nodes.find(n => n.type === 'trigger') as ScriptTriggerNode | undefined
  if (trig) trig.priority = form.value.priority

  saving.value = true
  try {
    const payload = {
      name,
      enabled: form.value.enabled,
      priority: form.value.priority,
      rootNodeId: form.value.rootNodeId,
      nodes: form.value.nodes,
    }
    if (isCreating.value) {
      const res = await apiFetch<{ id: string }>('/api/ai/scripts/create', { method: 'POST', body: payload })
      showToast('腳本已建立 ✅', 'success')
      await loadScripts(true)
      const fresh = scripts.value.find(s => s.id === res.id)
      if (fresh) selectScript(fresh, { skipDiscardConfirm: true })
      isCreating.value = false
    }
    else if (selectedId.value) {
      await apiFetch(`/api/ai/scripts/${selectedId.value}`, { method: 'PUT', body: payload })
      showToast('已儲存 ✅', 'success')
      await loadScripts(true)
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

async function deleteScript() {
  if (!selectedId.value) return
  if (!confirm(`確定刪除「${form.value.name}」這條腳本？`)) return
  try {
    await apiFetch(`/api/ai/scripts/${selectedId.value}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    selectedId.value = null
    isCreating.value = false
    form.value = blankForm()
    markClean()
    await loadScripts(true)
  }
  catch {
    showToast('刪除失敗', 'error')
  }
}
</script>

<style scoped lang="scss">
.ai-scripts-body {
  padding: 16px;
}

.scripts-section-card {
  margin-bottom: 16px;
}

.scripts-section-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 4px 0 0;
}

.scripts-node-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scripts-node-card {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
}

.scripts-node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.scripts-node-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;

  &--trigger {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
  }
  &--collect {
    background: var(--el-color-info-light-9);
    color: var(--el-color-info);
  }
  &--reply {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
  }
}

.scripts-node-delete {
  margin-left: auto;
}

.scripts-add-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
