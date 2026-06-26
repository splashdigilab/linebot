<template>
  <AdminSplitLayout :is-empty="!selectedScript && !isCreating">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title">🧩 腳本</span>
      <el-button type="primary" size="small" data-tour="scr-new" @click="openCreate">➕ 新增</el-button>
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
      <p>從範本快速建立，或點「從空白開始」自己組</p>
      <div class="scripts-template-gallery" data-tour="scr-templates">
        <button
          v-for="tpl in scriptTemplates"
          :key="tpl.key"
          type="button"
          class="scripts-template-card"
          @click="createFromTemplate(tpl)"
        >
          <span class="scripts-template-card__title">{{ tpl.label }}</span>
          <span class="scripts-template-card__desc">{{ tpl.description }}</span>
        </button>
      </div>
      <el-button text @click="openCreate">從空白開始</el-button>
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
              <span v-if="statsText" class="text-xs text-muted">{{ statsText }}</span>
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
              <div v-for="node in form.nodes" :key="node.id" class="scripts-node-card">
                <div class="scripts-node-header">
                  <span class="scripts-node-badge" :class="nodeBadgeClass(node.type)">
                    {{ nodeIcon(node.type) }} {{ nodeTypeLabel(node.type) }}
                  </span>
                  <span v-if="nodeHeaderHint(node)" class="text-xs text-muted">{{ nodeHeaderHint(node) }}</span>
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
                    <AdminFieldLabel text="觸發方式" tight />
                    <el-radio-group
                      :model-value="node.matchMode ?? 'keyword'"
                      size="small"
                      @change="setTriggerMode(node, $event)"
                    >
                      <el-radio-button value="keyword">🔑 關鍵字</el-radio-button>
                      <el-radio-button value="semantic">🧠 看意思</el-radio-button>
                    </el-radio-group>
                  </div>

                  <div v-if="(node.matchMode ?? 'keyword') === 'keyword'" class="admin-field-group">
                    <AdminFieldLabel text="關鍵字（任一命中即觸發）" tight />
                    <el-input
                      :model-value="node.keywords.join('，')"
                      placeholder="例：退換貨，退費，要退（用逗號或空白分隔）"
                      @update:model-value="updateKeywords(node, $event)"
                    />
                  </div>

                  <template v-else>
                    <div class="admin-field-group">
                      <AdminFieldLabel text="意圖範例（一行一句，系統用「意思」比對）" tight />
                      <el-input
                        :model-value="(node.examples ?? []).join('\n')"
                        type="textarea"
                        :rows="4"
                        placeholder="例：&#10;我要退貨&#10;不想要了想退&#10;能不能取消訂單"
                        @update:model-value="updateExamples(node, $event)"
                      />
                    </div>
                    <p class="scripts-section-hint">
                      💡 不用列出所有講法——填 3～5 句不同說法即可，客人用相近意思的話也會觸發（最多 {{ MAX_TRIGGER_EXAMPLES }} 句）。
                    </p>
                  </template>
                </template>

                <!-- Collect -->
                <template v-else-if="node.type === 'collect'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="問題（要問使用者的話）" tight />
                    <el-input v-model="node.question" placeholder="例：請輸入您的訂單編號" />
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="欄位名稱（分支／寫名單／回覆都用它取值）" tight />
                    <el-input v-model="node.fieldName" placeholder="例：order_id" />
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="答案格式（自動從訊息抽出、格式不符會重問）" tight />
                    <el-select :model-value="node.format ?? 'any'" size="small" @change="node.format = $event">
                      <el-option label="不限制（整句存）" value="any" />
                      <el-option label="電話" value="phone" />
                      <el-option label="Email" value="email" />
                      <el-option label="純數字" value="number" />
                      <el-option label="自訂（正則）" value="custom" />
                    </el-select>
                  </div>
                  <div v-if="node.format === 'custom'" class="admin-field-group">
                    <AdminFieldLabel text="自訂格式（正則表達式）" tight />
                    <el-input v-model="node.pattern" placeholder="例：[A-Za-z]\d{3,}（訂單編號 A123）" />
                  </div>
                  <div v-if="(node.format ?? 'any') !== 'any'" class="admin-field-group">
                    <AdminFieldLabel text="格式不符時的重問話術（可留空用預設）" tight />
                    <el-input v-model="node.reaskText" placeholder="例：訂單編號好像怪怪的，可以再確認一次嗎？" />
                  </div>
                </template>

                <!-- Reply -->
                <template v-else-if="node.type === 'reply'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="回覆文字（可插入收集到的欄位）" tight />
                    <el-input
                      v-model="node.text"
                      type="textarea"
                      :rows="3"
                      placeholder="例：已收到您的訂單，將盡快為您處理 🙇"
                    />
                    <el-dropdown
                      v-if="collectFieldOptions.length"
                      size="small"
                      trigger="click"
                      class="scripts-var-insert"
                      @command="(f) => insertReplyVar(node, f)"
                    >
                      <el-button size="small" plain>＋ 插入欄位變數 ▾</el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item v-for="f in collectFieldOptions" :key="f.value" :command="f.value">
                            {{ varLabel(f.value) }}
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="回覆後直接轉真人" tight />
                    <el-switch v-model="node.thenHandoff" active-text="開" inactive-text="關" />
                  </div>
                </template>

                <!-- Branch -->
                <template v-else-if="node.type === 'branch'">
                  <p class="scripts-section-hint">依「已收集的欄位」決定往哪走。由上而下，第一個成立的條件勝出。</p>
                  <div v-for="(c, ci) in node.cases" :key="ci" class="scripts-branch-case">
                    <span class="text-xs text-muted">如果</span>
                    <el-select :model-value="c.field" filterable size="small" placeholder="選欄位" class="scripts-branch-field" @change="c.field = $event">
                      <el-option v-for="f in collectFieldOptions" :key="f.value" :label="f.label" :value="f.value" />
                    </el-select>
                    <el-select :model-value="c.op" size="small" class="scripts-branch-op" @change="setBranchOp(c, $event)">
                      <el-option label="有填寫" value="exists" />
                      <el-option label="等於" value="equals" />
                      <el-option label="包含" value="contains" />
                    </el-select>
                    <el-input v-if="c.op !== 'exists'" v-model="c.value" placeholder="比較值" class="scripts-branch-value" />
                    <span class="text-xs text-muted">→</span>
                    <el-select :model-value="c.next" size="small" placeholder="前往…" class="scripts-branch-next" @change="c.next = $event">
                      <el-option v-for="o in targetOptions(node.id)" :key="o.value" :label="o.label" :value="o.value" />
                    </el-select>
                    <el-button size="small" type="danger" plain @click="removeBranchCase(node, ci)">✕</el-button>
                  </div>
                  <el-button size="small" plain @click="addBranchCase(node)">＋ 新增條件</el-button>
                  <div class="admin-field-group">
                    <AdminFieldLabel text="其餘情況（都不符合時）→ 前往" tight />
                    <el-select :model-value="node.defaultNext" size="small" placeholder="前往…" @change="node.defaultNext = $event">
                      <el-option v-for="o in targetOptions(node.id)" :key="o.value" :label="o.label" :value="o.value" />
                    </el-select>
                  </div>
                </template>

                <!-- Quick reply -->
                <template v-else-if="node.type === 'quickReply'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="問句（出選項時一起送）" tight />
                    <el-input v-model="node.question" placeholder="例：請問需要哪項服務？" />
                  </div>
                  <p class="scripts-section-hint">客人點按鈕即走對應路線（按鈕文字就是送出的文字）。</p>
                  <div v-for="(o, oi) in node.options" :key="oi" class="scripts-branch-case">
                    <span class="text-xs text-muted">按鈕</span>
                    <el-input v-model="o.label" placeholder="按鈕文字（≤20 字）" class="scripts-branch-field" />
                    <span class="text-xs text-muted">→</span>
                    <el-select :model-value="o.next" size="small" placeholder="前往…" class="scripts-branch-next" @change="o.next = $event">
                      <el-option v-for="t in targetOptions(node.id)" :key="t.value" :label="t.label" :value="t.value" />
                    </el-select>
                    <el-button size="small" type="danger" plain @click="removeQuickReplyOption(node, oi)">✕</el-button>
                  </div>
                  <el-button size="small" plain @click="addQuickReplyOption(node)">＋ 新增選項</el-button>
                </template>

                <!-- Tag -->
                <template v-else-if="node.type === 'tag'">
                  <div class="admin-field-group">
                    <AdminFieldLabel text="替客人貼上標籤" tight />
                    <el-select
                      :model-value="node.addTagIds"
                      multiple
                      filterable
                      collapse-tags
                      placeholder="選擇標籤（可多選）"
                      class="scripts-tag-select"
                      @change="node.addTagIds = $event"
                    >
                      <el-option v-for="t in tagOptions" :key="t.value" :label="t.label" :value="t.value" />
                    </el-select>
                    <p class="scripts-section-hint">流程走到這裡就貼標，然後自動往下。</p>
                  </div>
                </template>

                <!-- Save lead -->
                <template v-else-if="node.type === 'saveLead'">
                  <p class="scripts-section-hint">把收集到的欄位存成使用者屬性（持久化、後台可見，之後回覆文字也能用屬性變數取用）。</p>
                  <div v-for="(m, mi) in node.fieldMap" :key="mi" class="scripts-branch-case">
                    <span class="text-xs text-muted">收集欄位</span>
                    <el-select :model-value="m.fromField" filterable size="small" placeholder="選欄位" class="scripts-branch-field" @change="m.fromField = $event">
                      <el-option v-for="f in collectFieldOptions" :key="f.value" :label="f.label" :value="f.value" />
                    </el-select>
                    <span class="text-xs text-muted">→ 屬性名稱</span>
                    <el-input v-model="m.attrKey" placeholder="如 訂單編號" class="scripts-branch-field" />
                    <el-button size="small" type="danger" plain @click="removeSaveLeadField(node, mi)">✕</el-button>
                  </div>
                  <el-button size="small" plain @click="addSaveLeadField(node)">＋ 新增欄位</el-button>
                </template>

                <!-- 下一步摘要：把自動接線/結束這種看不見的去向講出來 -->
                <p v-if="autoNextLabel(node)" class="scripts-next-hint">
                  ↳ 下一步：<strong>{{ autoNextLabel(node) }}</strong>
                </p>
              </div>
            </div>

            <div class="scripts-add-actions">
              <el-button size="small" plain @click="addNode('collect')">＋ 收集節點</el-button>
              <el-button size="small" plain @click="addNode('quickReply')">＋ 快速回覆</el-button>
              <el-button size="small" plain @click="addNode('branch')">＋ 分支節點</el-button>
              <el-button size="small" plain @click="addNode('tag')">＋ 貼標節點</el-button>
              <el-button size="small" plain @click="addNode('saveLead')">＋ 寫名單節點</el-button>
              <el-button size="small" plain @click="addNode('reply')">＋ 回覆節點</el-button>
            </div>

            <p class="scripts-section-hint">
              💡 線性節點由上而下自動串接；分支節點則用「前往…」下拉自己指定每條路要去哪個節點。
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
  BranchOp,
  ScriptBranchNode,
  ScriptCollectNode,
  ScriptDoc,
  ScriptNode,
  ScriptQuickReplyNode,
  ScriptReplyNode,
  ScriptSaveLeadNode,
  ScriptTagNode,
  ScriptTriggerNode,
  TriggerMatchMode,
} from '~~/shared/types/ai-script'
import { DEFAULT_COLLECT_EXPIRE_MS, DEFAULT_SCRIPT_PRIORITY, MAX_TRIGGER_EXAMPLES } from '~~/shared/types/ai-script'
import { SCRIPT_TEMPLATES, type ScriptTemplate } from '~~/shared/types/ai-script-templates'

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

const scriptTemplates = SCRIPT_TEMPLATES

// 貼標節點用的工作區標籤清單
const { tags: tagList, loadTags } = useAdminTagList()
const tagOptions = computed(() => (tagList.value ?? []).map((t: any) => ({ value: String(t.id), label: String(t.name ?? t.id) })))

function defaultTriggerNode(nextId: string): ScriptTriggerNode {
  return { id: uuidv4(), type: 'trigger', matchMode: 'keyword', keywords: [], examples: [], priority: DEFAULT_SCRIPT_PRIORITY, next: nextId }
}
function defaultReplyNode(): ScriptReplyNode {
  return { id: uuidv4(), type: 'reply', text: '', thenHandoff: false }
}
function defaultCollectNode(nextId: string): ScriptCollectNode {
  return { id: uuidv4(), type: 'collect', question: '', fieldName: '', expireMs: DEFAULT_COLLECT_EXPIRE_MS, format: 'any', next: nextId }
}
function defaultBranchNode(defaultNext: string): ScriptBranchNode {
  return { id: uuidv4(), type: 'branch', cases: [], defaultNext }
}
function defaultQuickReplyNode(nextId: string): ScriptQuickReplyNode {
  return { id: uuidv4(), type: 'quickReply', question: '', expireMs: DEFAULT_COLLECT_EXPIRE_MS, options: [{ label: '', next: nextId }] }
}
function defaultTagNode(nextId: string): ScriptTagNode {
  return { id: uuidv4(), type: 'tag', addTagIds: [], next: nextId }
}
function defaultSaveLeadNode(nextId: string): ScriptSaveLeadNode {
  return { id: uuidv4(), type: 'saveLead', fieldMap: [{ fromField: '', attrKey: '' }], next: nextId }
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

const statsText = computed(() => {
  if (isCreating.value) return ''
  const stats = selectedScript.value?.stats
  const starts = stats?.starts ?? 0
  const completions = stats?.completions ?? 0
  if (!starts) return ''
  const rate = Math.round((completions / starts) * 100)
  return `📊 啟動 ${starts} 次・完成 ${completions} 次（完成率 ${rate}%）`
})

// ── List helpers ───────────────────────────────────────────────────
function triggerSummary(script: ScriptRow): string {
  const trig = script.nodes?.find(n => n.type === 'trigger') as ScriptTriggerNode | undefined
  if (!trig) return '無觸發條件'
  if ((trig.matchMode ?? 'keyword') === 'semantic') {
    const ex = (trig.examples ?? []).filter(Boolean)
    if (!ex.length) return '無範例'
    return `🧠 ${ex.slice(0, 3).join('、')}${ex.length > 3 ? '⋯' : ''}`
  }
  if (!trig.keywords?.length) return '無關鍵字'
  return `🔑 ${trig.keywords.slice(0, 3).join('、')}${trig.keywords.length > 3 ? '⋯' : ''}`
}

function nodeIcon(type: string) {
  if (type === 'trigger') return '🔑'
  if (type === 'collect') return '📋'
  if (type === 'branch') return '🔀'
  if (type === 'quickReply') return '⚡'
  if (type === 'tag') return '🏷️'
  if (type === 'saveLead') return '💾'
  return '💬'
}

function nodeTypeLabel(type: string) {
  if (type === 'trigger') return '觸發'
  if (type === 'collect') return '收集'
  if (type === 'branch') return '分支'
  if (type === 'quickReply') return '快速回覆'
  if (type === 'tag') return '貼標'
  if (type === 'saveLead') return '寫名單'
  return '回覆'
}

function nodeBadgeClass(type: string) {
  if (type === 'trigger') return 'scripts-node-badge--trigger'
  if (type === 'collect') return 'scripts-node-badge--collect'
  if (type === 'branch') return 'scripts-node-badge--branch'
  if (type === 'quickReply') return 'scripts-node-badge--quickreply'
  if (type === 'tag' || type === 'saveLead') return 'scripts-node-badge--action'
  return 'scripts-node-badge--reply'
}

/** 給「下一步」下拉用的節點選項標籤（trigger 不能當目標） */
function nodeOptionLabel(n: ScriptNode): string {
  if (n.type === 'collect') return `📋 收集 ${n.fieldName || '(未命名)'}`
  if (n.type === 'branch') return '🔀 分支'
  if (n.type === 'quickReply') return `⚡ 快速回覆${n.question ? `「${n.question.slice(0, 8)}」` : ''}`
  if (n.type === 'tag') return '🏷️ 貼標'
  if (n.type === 'saveLead') return '💾 寫名單'
  if (n.type === 'reply') return `💬 回覆「${(n.text || '').slice(0, 8) || '空白'}」`
  return '🔑 觸發'
}

/** 節點短名（給「下一步」摘要用） */
function shortNodeName(id: string): string {
  const n = form.value.nodes.find(x => x.id === id)
  return n ? nodeOptionLabel(n) : '（尚未接，存檔會擋）'
}
/**
 * 把「看不見的去向」講出來：
 * - 線性節點（觸發/收集/貼標/寫名單）自動接下一個，但畫面上看不到 → 顯示 ↳ 下一步：X
 * - 回覆節點是終點 → 顯示是否結束/轉真人
 * - 分支/快速回覆的出口已在各自的列上顯示，回 null 不重複
 */
function autoNextLabel(node: ScriptNode): string | null {
  if (node.type === 'trigger' || node.type === 'collect' || node.type === 'tag' || node.type === 'saveLead') {
    return node.next ? shortNodeName(node.next) : '（尚未接，存檔會擋）'
  }
  if (node.type === 'reply') {
    return node.thenHandoff ? '流程結束，並轉真人客服' : '流程結束'
  }
  return null
}

/** 目前腳本裡所有 collect 節點的欄位名（給分支/寫名單/變數插入下拉選，避免手打 typo） */
const collectFieldOptions = computed(() =>
  form.value.nodes
    .filter((n): n is ScriptCollectNode => n.type === 'collect' && !!n.fieldName.trim())
    .map(n => ({ value: n.fieldName, label: n.fieldName })),
)
/** 節點標頭的用途提示（取代誤導的「節點 N」序號——分支圖裡順序≠流程） */
function nodeHeaderHint(node: ScriptNode): string {
  if (node.type === 'collect') return node.fieldName ? `欄位「${node.fieldName}」` : '（未命名欄位）'
  if (node.type === 'reply') return node.thenHandoff ? '結束 → 轉真人' : '結束'
  return ''
}
/** 在回覆文字尾端插入一個欄位變數 */
function insertReplyVar(node: ScriptReplyNode, field: string) {
  if (!field) return
  node.text = `${node.text || ''}{{${field}}}`
}
/** 變數插入選單的顯示文字（用函式回傳，避免在 template mustache 裡寫巢狀大括號被誤解析） */
function varLabel(field: string): string {
  return `{{ ${field} }}`
}

function addSaveLeadField(node: ScriptSaveLeadNode) {
  node.fieldMap.push({ fromField: '', attrKey: '' })
}
function removeSaveLeadField(node: ScriptSaveLeadNode, idx: number) {
  node.fieldMap.splice(idx, 1)
}
function targetOptions(selfId: string) {
  return form.value.nodes
    .filter(n => n.id !== selfId && n.type !== 'trigger')
    .map(n => ({ value: n.id, label: nodeOptionLabel(n) }))
}

function addBranchCase(node: ScriptBranchNode) {
  node.cases.push({ op: 'exists', field: '', value: '', next: '' })
}
function removeBranchCase(node: ScriptBranchNode, idx: number) {
  node.cases.splice(idx, 1)
}
function setBranchOp(c: ScriptBranchNode['cases'][number], op: string | number | boolean | undefined) {
  const next: BranchOp = (op === 'equals' || op === 'contains') ? op : 'exists'
  c.op = next
  // 切到 exists 不需要比較值，清掉殘留避免切回時冒出舊值
  if (next === 'exists') c.value = ''
}

function addQuickReplyOption(node: ScriptQuickReplyNode) {
  node.options.push({ label: '', next: '' })
}
function removeQuickReplyOption(node: ScriptQuickReplyNode, idx: number) {
  node.options.splice(idx, 1)
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

/** 從範本一鍵建立：載入到編輯器（尚未存檔，使用者微調後按建立才寫入） */
function createFromTemplate(tpl: ScriptTemplate) {
  if (!confirmLeaveIfDirty()) return
  isCreating.value = true
  selectedId.value = null
  form.value = {
    name: tpl.label,
    enabled: true,
    priority: DEFAULT_SCRIPT_PRIORITY,
    rootNodeId: tpl.rootNodeId,
    nodes: deepCloneNodes(tpl.nodes),
  }
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

function setTriggerMode(node: ScriptTriggerNode, mode: string | number | boolean | undefined) {
  const m: TriggerMatchMode = mode === 'semantic' ? 'semantic' : 'keyword'
  node.matchMode = m
  if (m === 'semantic' && !node.examples) node.examples = []
}

function updateExamples(node: ScriptTriggerNode, value: string) {
  // 一行一句（語意比對靠整句意思，不需逗號拆短詞）
  node.examples = String(value || '')
    .split(/\n+/g)
    .map(e => e.trim())
    .filter(Boolean)
    .slice(0, MAX_TRIGGER_EXAMPLES)
}

function addNode(type: 'collect' | 'reply' | 'branch' | 'quickReply' | 'tag' | 'saveLead') {
  const nodes = form.value.nodes

  if (type === 'reply') {
    // 新增 reply：通常只會有一個。若已有 reply，這顆需手動接（當分支的某個出口）
    nodes.push(defaultReplyNode())
    return
  }

  // 其餘節點：插在最後一個 reply 之前，把「原本指到 reply 的節點」改指到新節點，
  // 新節點則接到那個 reply。沒 reply 時出口留空（驗證會擋）。
  const replyIdx = nodes.findIndex(n => n.type === 'reply')
  const reply = nodes[replyIdx] as ScriptReplyNode | undefined
  const nextId = reply?.id ?? ''
  const newNode: ScriptCollectNode | ScriptBranchNode | ScriptQuickReplyNode | ScriptTagNode | ScriptSaveLeadNode
    = type === 'collect' ? defaultCollectNode(nextId)
      : type === 'branch' ? defaultBranchNode(nextId)
        : type === 'quickReply' ? defaultQuickReplyNode(nextId)
          : type === 'tag' ? defaultTagNode(nextId)
            : defaultSaveLeadNode(nextId)

  if (!reply) {
    nodes.push(newNode)
    return
  }
  // 找「目前指到 reply 的那個節點」改指到新節點（涵蓋 trigger/collect 的 next、branch 的 defaultNext、
  // quickReply 的某個選項），讓新節點自動串進線性流程，避免變孤兒。
  const beforeReply = nodes.find(n =>
    ((n.type === 'trigger' || n.type === 'collect') && n.next === reply.id)
    || (n.type === 'branch' && n.defaultNext === reply.id)
    || (n.type === 'quickReply' && n.options.some(o => o.next === reply.id)),
  )
  if (beforeReply) {
    if (beforeReply.type === 'branch') beforeReply.defaultNext = newNode.id
    else if (beforeReply.type === 'quickReply') {
      const opt = beforeReply.options.find(o => o.next === reply.id)
      if (opt) opt.next = newNode.id
    }
    else if (beforeReply.type === 'trigger' || beforeReply.type === 'collect') beforeReply.next = newNode.id
  }
  nodes.splice(replyIdx, 0, newNode)
}

function removeNode(id: string) {
  const nodes = form.value.nodes
  const idx = nodes.findIndex(n => n.id === id)
  if (idx < 0) return
  const removed = nodes[idx]
  if (!removed || removed.type === 'trigger') return // trigger 不可移除

  // 接替出口：單一出口節點→其 next；branch→defaultNext；quickReply→首選項 next；reply→空
  const fallback = (removed.type === 'collect' || removed.type === 'tag' || removed.type === 'saveLead')
    ? removed.next
    : removed.type === 'branch'
      ? removed.defaultNext
      : removed.type === 'quickReply' ? (removed.options[0]?.next ?? '') : ''

  // 修補所有指向 removed.id 的出口（trigger/collect 的 next、branch defaultNext+cases、quickReply options）
  for (const n of nodes) {
    if ((n.type === 'trigger' || n.type === 'collect') && n.next === id) n.next = fallback
    if (n.type === 'branch') {
      if (n.defaultNext === id) n.defaultNext = fallback
      for (const c of n.cases) if (c.next === id) c.next = fallback
    }
    if (n.type === 'quickReply') {
      for (const o of n.options) if (o.next === id) o.next = fallback
    }
  }
  nodes.splice(idx, 1)
}

// ── Load / Save / Delete ────────────────────────────────────────────
onMounted(() => {
  loadScripts(true)
  loadTags({ status: 'active' }).catch(() => {})
})

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

<!-- 樣式見 app/assets/scss/pages/_ai-scripts.scss（與其他 admin 頁一致，不寫在 .vue） -->
