<template>
  <AdminSplitLayout solo :is-empty="false">
    <template #editor-header>
      <AdminSoloPageHeading
        field-label="Super Admin"
        title="潛在客戶名單"
        caption="落地頁「預約 Demo」與迎賓頁「加入候補」留下的名單，依此跟進與開通。"
      />
      <div class="flex gap-2 admin-header-actions">
        <el-button :loading="loading" @click="load">重新整理</el-button>
      </div>
    </template>

    <template #editor-body>
      <div class="solo-editor-body admin-panel-stack">
        <div class="message-card ar-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="section-title">所有名單</span>
            </div>
            <span class="text-xs text-muted">共 {{ leads.length }} 筆</span>
          </div>
          <div class="card-section-stack">
            <el-table v-loading="loading" :data="leads" size="small">
              <el-table-column label="時間" width="150">
                <template #default="{ row }">
                  <span class="text-xs text-muted">{{ fmtDate(row.createdAt) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="稱呼 / 聯絡方式" min-width="200">
                <template #default="{ row }">
                  <div class="text-sm font-bold">{{ row.name || '（未留稱呼）' }}</div>
                  <div class="text-xs">{{ row.contact }}</div>
                </template>
              </el-table-column>
              <el-table-column label="需求" min-width="180">
                <template #default="{ row }">
                  <div v-if="row.industry" class="text-xs text-muted">{{ row.industry }}</div>
                  <div v-if="row.need" class="text-sm">{{ row.need }}</div>
                  <el-tag v-if="row.interestedPlanId" size="small" type="success" effect="plain" class="mt-1">
                    對「{{ planName(row.interestedPlanId) }}」有興趣
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="來源" width="100">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" :type="sourceTagType(row.source)">
                    {{ sourceLabel(row.source) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="狀態" width="130">
                <template #default="{ row }">
                  <el-select
                    :model-value="row.status"
                    size="small"
                    @change="(v: string) => updateStatus(row, v)"
                  >
                    <el-option
                      v-for="s in STATUS_OPTIONS"
                      :key="s.value"
                      :label="s.label"
                      :value="s.value"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="備註" width="90" align="right">
                <template #default="{ row }">
                  <el-button size="small" plain @click="openNote(row)">
                    {{ row.note ? '備註✓' : '備註' }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <p v-if="!loading && leads.length === 0" class="text-sm text-muted">
              目前還沒有名單。落地頁預約 Demo 或迎賓頁加入候補後，會出現在這裡。
            </p>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- 備註 dialog -->
  <el-dialog v-model="showNote" title="名單備註" width="min(460px, 92vw)">
    <div class="admin-panel-stack">
      <div v-if="noteTarget" class="text-sm text-muted">
        {{ noteTarget.name || '（未留稱呼）' }} · {{ noteTarget.contact }}
      </div>
      <el-input
        v-model="noteDraft"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="業務跟進紀錄（例：已電聯、約下週 Demo…）"
      />
    </div>
    <template #footer>
      <el-button @click="showNote = false">取消</el-button>
      <el-button type="primary" :loading="noteSaving" @click="saveNote">儲存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { BILLING_PLANS, type BillingPlanId } from '~~/shared/billing/plans'

definePageMeta({ middleware: ['auth', 'super-admin'], layout: 'super-admin' })
useHead({ title: '潛在客戶名單 — Super Admin' })

const { apiFetch } = useSuperAdmin()
const { showToast } = useAdminToast()

interface Lead {
  id: string
  name: string
  contact: string
  industry: string
  need: string
  interestedPlanId: string | null
  source: string
  status: string
  note: string | null
  createdAt: number | null
}

const loading = ref(false)
const leads = ref<Lead[]>([])

const STATUS_OPTIONS = [
  { value: 'new', label: '新' },
  { value: 'contacted', label: '已聯繫' },
  { value: 'converted', label: '已成交' },
  { value: 'archived', label: '封存' },
]

const SOURCE_LABELS: Record<string, string> = {
  landing_demo: '落地頁',
  welcome_waitlist: '迎賓候補',
  other: '其他',
}

function sourceLabel(s: string) {
  return SOURCE_LABELS[s] ?? s
}

function sourceTagType(s: string): 'success' | 'warning' | 'info' {
  if (s === 'welcome_waitlist') return 'warning'
  if (s === 'landing_demo') return 'success'
  return 'info'
}

function planName(id: string) {
  return BILLING_PLANS[id as BillingPlanId]?.name ?? id
}

function fmtDate(ms: number | null) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

async function load() {
  loading.value = true
  try {
    leads.value = await apiFetch<Lead[]>('/api/admin/super/leads')
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '載入失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

async function updateStatus(row: Lead, status: string) {
  const prev = row.status
  row.status = status
  try {
    await apiFetch(`/api/admin/super/leads/${row.id}`, { method: 'PATCH', body: { status } })
    showToast('已更新狀態', 'success')
  }
  catch (e: any) {
    row.status = prev
    showToast(e?.data?.statusMessage || '更新失敗', 'error')
  }
}

// ── 備註 ──────────────────────────────────────────────────
const showNote = ref(false)
const noteSaving = ref(false)
const noteTarget = ref<Lead | null>(null)
const noteDraft = ref('')

function openNote(row: Lead) {
  noteTarget.value = row
  noteDraft.value = row.note ?? ''
  showNote.value = true
}

async function saveNote() {
  if (!noteTarget.value) return
  noteSaving.value = true
  try {
    await apiFetch(`/api/admin/super/leads/${noteTarget.value.id}`, {
      method: 'PATCH',
      body: { note: noteDraft.value },
    })
    noteTarget.value.note = noteDraft.value.trim()
    showNote.value = false
    showToast('已儲存備註', 'success')
  }
  catch (e: any) {
    showToast(e?.data?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    noteSaving.value = false
  }
}

onMounted(load)
</script>
