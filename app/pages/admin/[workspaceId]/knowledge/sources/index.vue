<template>
  <AdminSplitLayout :is-empty="!selectedSource">
    <!-- ── Sidebar Header ── -->
    <template #sidebar-header>
      <span class="split-sidebar-title" data-tour="kb-sources">📁 來源</span>
      <div class="flex gap-1">
        <el-tooltip v-if="canEditFolders" content="新增資料夾" placement="bottom" :show-after="300">
          <el-button size="small" plain @click="createFolderPrompt">📂</el-button>
        </el-tooltip>
        <el-tooltip v-if="canEditKb" content="匯入檔案 / 網址 / 大段文字" placement="bottom" :show-after="300">
          <el-button size="small" type="primary" plain data-tour="kb-import" @click="goImport">📥 匯入</el-button>
        </el-tooltip>
      </div>
    </template>

    <!-- ── Sidebar List ── -->
    <template #sidebar-list>
      <!-- 偵測到 orphan chunks → 提示一鍵整理 -->
      <div v-if="orphanCount > 0" class="src-orphan-banner">
        <p class="src-orphan-msg">
          ⚠️ 偵測到 <strong>{{ orphanCount }}</strong> 張舊版未分組卡片
        </p>
        <p class="src-orphan-hint">
          舊版手寫單張卡沒被「來源」管理，整理後每張會變成一筆手寫條目顯示在下方。
        </p>
        <el-button
          v-if="canEditSources"
          size="small"
          type="primary"
          plain
          :loading="migrating"
          @click="migrateOrphans"
        >
          ✨ 一鍵整理
        </el-button>
      </div>

      <div v-if="loading && !sources.length" class="split-sidebar-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!sources.length && !orphanCount" class="split-sidebar-empty">
        <span>沒有任何來源</span>
        <p class="text-xs text-muted">每個來源代表一份知識（PDF / 網址 / 文字），AI 從這些來源裡找答案。</p>
        <div v-if="canEditKb" class="flex gap-1" style="margin-top:8px;">
          <el-button size="small" type="primary" plain @click="goImport">📥 匯入</el-button>
        </div>
      </div>
      <div v-else class="split-list">
        <!-- 未分類來源（直接平鋪在最上方，沒有 header） -->
        <div
          v-for="src in uncategorizedSources"
          :key="src.id"
          class="flow-sidebar-row"
          :class="{ 'flow-sidebar-row--dragging': draggedSourceId === src.id }"
        >
          <span
            class="drag-handle flow-sidebar-drag-handle"
            draggable="true"
            aria-label="拖曳搬移"
            @dragstart.stop="onSourceDragStart(src.id, $event)"
            @dragend.stop="onSourceDragEnd"
          >⠿</span>
          <AdminSplitListItem
            class="flow-sidebar-row__item"
            :title="src.name || '(未命名)'"
            :active="selectedId === src.id"
            time-in-title-row
            title-row-chip
            :chip-text="statusChipText(src)"
            :chip-tone="statusChipTone(src)"
            :meta-text="metaText(src)"
            :meta-truncate="true"
            @select="selectSource(src)"
          />
        </div>

        <!-- 「移出資料夾」drop zone：只在拖曳「資料夾內」的卡片時才出現 -->
        <div
          v-if="isDraggingFromFolder"
          class="src-unfolder-zone"
          :class="{ 'src-unfolder-zone--drop': dragOverFolderId === '__none__' }"
          @dragover.prevent="onFolderDragOver('__none__', $event)"
          @dragleave="onFolderDragLeave('__none__')"
          @drop.prevent="onFolderDrop(null)"
        >
          📥 拖到這裡 = 移出資料夾
        </div>

        <!-- 每個資料夾 -->
        <template v-for="folder in folders" :key="folder.id">
          <div
            class="src-folder-header"
            :class="{
              'src-folder-header--drop': dragOverFolderId === folder.id,
              'src-folder-header--dragging': draggedFolderId === folder.id,
              'src-folder-header--reorder-over': folderReorderOverId === folder.id && draggedFolderId !== folder.id,
            }"
            @click="toggleFolder(folder.id)"
            @dragover.prevent="onFolderDragOver(folder.id, $event)"
            @dragleave="onFolderDragLeave(folder.id)"
            @drop.prevent="onFolderDrop(folder.id)"
          >
            <span
              class="drag-handle flow-sidebar-drag-handle src-folder-drag-handle"
              draggable="true"
              aria-label="拖曳排序資料夾"
              @click.stop
              @dragstart.stop="onFolderHeaderDragStart($event, folder.id)"
              @dragend.stop="onFolderHeaderDragEnd"
            >⠿</span>
            <span class="src-folder-label">
              <span class="src-folder-arrow">{{ isExpanded(folder.id) ? '▾' : '▸' }}</span>
              📂 {{ folder.name }}
              <span class="src-folder-count">（{{ countByFolder[folder.id] ?? 0 }}）</span>
            </span>
            <span v-if="canEditFolders" class="src-folder-actions">
              <el-tooltip content="編輯資料夾" placement="top" :show-after="300">
                <button class="src-folder-icon-btn" @click.stop="openFolderEdit(folder)">✏️</button>
              </el-tooltip>
            </span>
          </div>
          <template v-if="isExpanded(folder.id)">
            <div
              v-for="src in sourcesByFolder[folder.id] ?? []"
              :key="src.id"
              class="flow-sidebar-row src-row--in-folder"
              :class="{ 'flow-sidebar-row--dragging': draggedSourceId === src.id }"
            >
              <span
                class="drag-handle flow-sidebar-drag-handle"
                draggable="true"
                aria-label="拖曳搬移"
                @dragstart.stop="onSourceDragStart(src.id, $event)"
                @dragend.stop="onSourceDragEnd"
              >⠿</span>
              <AdminSplitListItem
                class="flow-sidebar-row__item"
                :title="src.name || '(未命名)'"
                :active="selectedId === src.id"
                time-in-title-row
                title-row-chip
                :chip-text="statusChipText(src)"
                :chip-tone="statusChipTone(src)"
                :meta-text="metaText(src)"
                :meta-truncate="true"
                @select="selectSource(src)"
              />
            </div>
            <div
              v-if="!(sourcesByFolder[folder.id] ?? []).length"
              class="src-folder-empty"
            >
              （資料夾為空；可從外面拖一筆過來）
            </div>
          </template>
        </template>
      </div>
    </template>

    <!-- ── Empty State ── -->
    <template #editor-empty>
      <span class="empty-icon">📁</span>
      <h3>選擇一個來源開始管理</h3>
      <p>{{ canEditKb ? '或匯入新的 PDF、網址、文字' : '（僅檢視）' }}</p>
      <div v-if="canEditKb" class="flex gap-2" style="margin-top:8px;">
        <el-button type="primary" @click="goImport">📥 匯入</el-button>
      </div>
    </template>

    <!-- ── Editor Header ── -->
    <template #editor-header>
      <div class="src-header">
        <div class="src-header-main">
          <span class="src-type-emoji">{{ typeEmoji(selectedSource?.type) }}</span>
          <div class="src-header-text">
            <h2 class="src-header-title">{{ selectedSource?.name || '(未命名來源)' }}</h2>
            <p v-if="selectedSource?.url" class="src-header-url">
              <a :href="selectedSource.url" target="_blank" rel="noopener">{{ selectedSource.url }}</a>
            </p>
          </div>
        </div>
      </div>
      <div v-if="canEditSources" class="flex gap-1 admin-header-actions">
        <el-button plain @click="renameSource">✏️ 重新命名</el-button>
        <el-button
          v-if="selectedSource?.type === 'url'"
          type="primary"
          plain
          :loading="resyncing"
          @click="startResync"
        >
          🔄 重新同步
        </el-button>
        <el-button
          v-if="selectedSource?.type === 'gsheet'"
          type="primary"
          plain
          :loading="gsheetSyncing"
          @click="syncGsheetNow"
        >
          🔄 立即同步
        </el-button>
        <el-button type="danger" plain :loading="deleting" @click="deleteSource">
          🗑️ 刪除
        </el-button>
      </div>
    </template>

    <!-- ── Editor Body ── -->
    <template #editor-body>
      <div v-if="selectedSource" class="solo-editor-body admin-panel-stack">
        <!-- 偵測到變動的提示 -->
        <el-alert
          v-if="selectedSource.outdatedAtMs > 0"
          type="warning"
          show-icon
          :closable="false"
          class="src-outdated-alert"
        >
          <template #title>
            ⚠️ 偵測到網頁內容變動 — {{ relativeTime(selectedSource.outdatedAtMs) }}
          </template>
          <div>
            最後一次自動偵測發現原始網址內容已改變，建議點上方「🔄 重新同步」檢視差異後決定要不要套用。
          </div>
        </el-alert>

        <!-- 基本資訊 -->
        <div class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📊 基本資訊</span>
            </div>
          </div>
          <div class="card-section-stack">
            <div class="src-info-grid">
              <div><span class="src-label">類型</span><strong>{{ typeLabel(selectedSource.type) }}</strong></div>
              <div><span class="src-label">狀態</span><strong>{{ statusLabel(selectedSource.status) }}</strong></div>
              <div><span class="src-label">卡片數</span><strong>{{ selectedSource.chunkCount }}</strong></div>
              <div><span class="src-label">最後同步</span><strong>{{ selectedSource.lastFetchedAtMs ? relativeTime(selectedSource.lastFetchedAtMs) : '尚未同步' }}</strong></div>
            </div>
            <p v-if="selectedSource.failureReason" class="src-failure">
              失敗原因：{{ selectedSource.failureReason }}
            </p>
          </div>
        </div>

        <!-- 自動偵測設定（只給 URL） -->
        <div v-if="selectedSource.type === 'url'" class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⏰ 自動偵測變動</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="src-section-hint">
              排程會定期抓網頁內容、跟上次比對。**偵測到變動不會自動覆蓋**，會在這裡標一個提示等你進來看差異再決定。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="偵測頻率" tight />
              <el-select v-model="settingsForm.refreshIntervalMinutes" class="control-full">
                <el-option label="不偵測（手動 re-sync）" :value="0" />
                <el-option label="每小時" :value="60" />
                <el-option label="每天" :value="1440" />
                <el-option label="每週" :value="10080" />
                <el-option label="每月" :value="43200" />
              </el-select>
            </div>
            <div class="admin-field-group">
              <AdminFieldLabel text="偵測到變動時" tight />
              <el-radio-group v-model="settingsForm.onChangeBehavior">
                <el-radio value="notify">通知我（在來源頁掛 ⚠️ 提示）</el-radio>
                <el-radio value="log_only">只記錄不通知</el-radio>
              </el-radio-group>
            </div>
            <div v-if="canEditSources" class="src-settings-actions">
              <el-button
                type="primary"
                size="small"
                :loading="savingSettings"
                :disabled="!settingsDirty"
                @click="saveSettings"
              >
                儲存設定
              </el-button>
            </div>
          </div>
        </div>

        <!-- 自動同步設定（只給 Google Sheet）-->
        <div v-if="selectedSource.type === 'gsheet'" class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">⏰ 自動同步</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p class="src-section-hint">
              排程會定期重讀這份 Sheet，**一列一卡自動套用**（新增/更新/刪除）。你在後台手動編輯過的卡（🔒）會保留、不被覆蓋。
            </p>
            <div class="admin-field-group">
              <AdminFieldLabel text="同步頻率" tight />
              <el-select v-model="settingsForm.refreshIntervalMinutes" class="control-full">
                <el-option label="不自動同步（只手動）" :value="0" />
                <el-option label="每 30 分鐘" :value="30" />
                <el-option label="每小時" :value="60" />
                <el-option label="每天" :value="1440" />
                <el-option label="每週" :value="10080" />
                <el-option label="每月" :value="43200" />
              </el-select>
            </div>
            <div v-if="canEditSources" class="src-settings-actions">
              <el-button
                type="primary"
                size="small"
                :loading="savingSettings"
                :disabled="!settingsDirty"
                @click="saveSettings"
              >
                儲存設定
              </el-button>
            </div>
          </div>
        </div>

        <!-- 旗下 chunks -->
        <div class="message-card src-section-card">
          <div class="message-card-header">
            <div class="card-header-main">
              <span class="badge badge-green">📝 卡片（{{ chunks.length }}）</span>
            </div>
          </div>
          <div class="card-section-stack">
            <p v-if="!chunks.length" class="text-muted">這個來源底下沒有卡片。</p>
            <div v-else class="src-chunk-list">
              <div
                v-for="c in chunks"
                :key="c.id"
                class="src-chunk-row"
              >
                <div class="src-chunk-main">
                  <span class="src-chunk-title">{{ c.title }}</span>
                  <span v-if="c.manuallyEditedAtMs > 0" class="src-chunk-lock" :title="`手動編輯過：${relativeTime(c.manuallyEditedAtMs)}`">🔒</span>
                </div>
                <span class="src-chunk-meta">{{ chunkStatusLabel(c.status) }} · {{ relativeTime(c.updatedAtMs) }}</span>
                <el-button v-if="canEditKb" size="small" plain @click="openEditChunk(c)">✏️ 編輯</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminSplitLayout>

  <!-- ── Diff Modal ──────────────────────────────────── -->
  <el-dialog
    v-model="diffOpen"
    title="🔄 重新同步：差異預覽"
    width="900px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-if="diffData" class="diff-body">
      <p class="text-muted text-sm">
        已重新抓取網頁並用 LLM 切卡，請逐張決定要採用新版本還是保留舊版本。
        手動編輯過的卡（🔒）預設保留你的版本。
      </p>
      <div class="diff-summary">
        <span class="diff-summary-chip diff-summary-chip--add">🟢 新增 {{ diffData.diff.summary.added }}</span>
        <span class="diff-summary-chip diff-summary-chip--mod">🟡 修改 {{ diffData.diff.summary.modified }}</span>
        <span class="diff-summary-chip diff-summary-chip--rem">🔴 移除 {{ diffData.diff.summary.removed }}</span>
        <span class="diff-summary-chip diff-summary-chip--same">⚪ 未變 {{ diffData.diff.summary.unchanged }}</span>
      </div>

      <div class="diff-entries">
        <div
          v-for="entry in diffData.diff.entries"
          :key="entry.id"
          class="diff-entry"
          :class="`diff-entry--${entry.kind}`"
        >
          <div class="diff-entry-head">
            <span class="diff-entry-kind">{{ kindLabel(entry.kind) }}</span>
            <span class="diff-entry-title">{{ entry.newChunk?.title || entry.oldChunk?.title }}</span>
            <span v-if="entry.oldChunk?.manuallyEdited" class="diff-entry-lock">🔒 手動編輯過</span>
          </div>

          <!-- 內容對照 -->
          <div v-if="entry.kind === 'modified'" class="diff-entry-cols">
            <div class="diff-col diff-col--old">
              <div class="diff-col-head">舊版</div>
              <pre>{{ entry.oldChunk?.content }}</pre>
            </div>
            <div class="diff-col diff-col--new">
              <div class="diff-col-head">新版</div>
              <pre>{{ entry.newChunk?.content }}</pre>
            </div>
          </div>
          <div v-else-if="entry.kind === 'new'" class="diff-entry-single">
            <pre>{{ entry.newChunk?.content }}</pre>
          </div>
          <div v-else-if="entry.kind === 'removed'" class="diff-entry-single">
            <pre>{{ entry.oldChunk?.content }}</pre>
          </div>
          <!-- unchanged：不顯示內容，省版面 -->

          <!-- 動作選擇 -->
          <div class="diff-entry-actions">
            <el-radio-group v-model="decisions[entry.id]" size="small">
              <template v-if="entry.kind === 'new'">
                <el-radio-button value="add_new">➕ 新增</el-radio-button>
                <el-radio-button value="skip">⏭️ 略過</el-radio-button>
              </template>
              <template v-else-if="entry.kind === 'modified'">
                <el-radio-button value="use_new">🟡 用新版</el-radio-button>
                <el-radio-button value="keep_old">🔒 保留舊版</el-radio-button>
              </template>
              <template v-else-if="entry.kind === 'removed'">
                <el-radio-button value="delete_old">🗑️ 刪除</el-radio-button>
                <el-radio-button value="keep_old">🔒 保留</el-radio-button>
              </template>
              <template v-else>
                <el-radio-button value="keep_old">（無動作）</el-radio-button>
              </template>
            </el-radio-group>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="diffOpen = false">取消</el-button>
      <el-button
        type="primary"
        :loading="applying"
        :disabled="!diffData?.diff.entries.length"
        @click="applyDiff"
      >
        套用選取的變更
      </el-button>
    </template>
  </el-dialog>

  <!-- ── Chunk Edit Modal ───────────────────────────── -->
  <el-dialog
    v-model="chunkEditOpen"
    :title="chunkEditMode === 'create' ? '➕ 新增卡片(手寫一條知識)' : '✏️ 編輯卡片'"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="chunk-form">
      <!-- 索引狀態(編輯既有卡才有) -->
      <div v-if="chunkEditMode === 'edit'" class="chunk-status-row">
        <span :class="['badge', chunkStatusBadge(chunkEditStatus)]">{{ chunkStatusLabel(chunkEditStatus) }}</span>
        <span v-if="chunkEditStatus === 'pending'" class="text-xs text-muted">背景索引中,約 5–30 秒</span>
        <span v-if="chunkEditFailureReason" class="chunk-status-failure">{{ chunkEditFailureReason }}</span>
        <el-button
          v-if="chunkEditStatus === 'failed'"
          size="small"
          plain
          :loading="chunkReindexing"
          @click="reindexChunkFromModal"
        >
          🔄 重新索引
        </el-button>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="標題" tight />
        <el-input
          v-model="chunkForm.title"
          maxlength="100"
          show-word-limit
          placeholder="例：退換貨政策"
        />
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="內容" tight />
        <el-input
          v-model="chunkForm.content"
          type="textarea"
          :rows="10"
          :maxlength="5000"
          show-word-limit
          placeholder="把這條的完整資訊寫進來，AI 會用整段當回答依據。"
        />
        <div class="chunk-normalize-row">
          <el-button
            size="small"
            plain
            :loading="chunkNormalizing"
            :disabled="!chunkForm.content.trim()"
            @click="normalizeChunkFromModal"
          >
            ✨ AI 整理一下
          </el-button>
          <span class="text-xs text-muted">自動加重點摘要、移除系統碼,提高檢索準確度;整理後記得儲存</span>
        </div>
      </div>
      <div class="admin-field-group">
        <AdminFieldLabel text="標籤（非必填，後台分類用）" tight />
        <div class="chunk-tag-row">
          <el-tag
            v-for="t in chunkForm.tags"
            :key="t"
            closable
            class="chunk-tag"
            @close="removeChunkTag(t)"
          >{{ t }}</el-tag>
          <el-input
            v-if="chunkTagInputVisible"
            ref="chunkTagInputEl"
            v-model="chunkTagInput"
            size="small"
            style="width: 120px;"
            @keydown.enter.prevent="commitChunkTag"
            @blur="commitChunkTag"
          />
          <el-button v-else size="small" plain @click="showChunkTagInput">＋</el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="chunk-footer">
        <el-button
          v-if="chunkEditMode === 'edit'"
          type="danger"
          plain
          :loading="chunkDeleting"
          :disabled="chunkSaving"
          @click="deleteChunkFromModal"
        >
          🗑️ 刪除
        </el-button>
        <div class="chunk-footer-right">
          <el-button @click="chunkEditOpen = false">取消</el-button>
          <el-button
            type="primary"
            :loading="chunkSaving"
            :disabled="chunkDeleting || !chunkForm.title.trim() || !chunkForm.content.trim()"
            @click="saveChunk"
          >
            {{ chunkEditMode === 'create' ? '建立' : '儲存' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- ── 匯入彈窗 ───────────────────────────────────── -->
  <KnowledgeImportDialog v-model="importOpen" @imported="onImported" />

  <!-- ── Folder Edit Modal ──────────────────────────── -->
  <el-dialog
    v-model="folderEditOpen"
    title="✏️ 編輯資料夾"
    width="480px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="folder-form">
      <div class="admin-field-group">
        <AdminFieldLabel text="名稱" tight />
        <el-input
          v-model="folderForm.name"
          maxlength="50"
          show-word-limit
          placeholder="例：客服 FAQ"
        />
      </div>
      <p v-if="folderEditTarget" class="folder-form-hint">
        目前底下 {{ countByFolder[folderEditTarget.id] ?? 0 }} 筆來源。
        若刪除，底下的來源會自動移到「未分類」，**不會**被刪掉。
      </p>
    </div>
    <template #footer>
      <div class="folder-footer">
        <el-button
          type="danger"
          plain
          :loading="folderDeleting"
          :disabled="folderSaving"
          @click="deleteFolderFromModal"
        >
          🗑️ 刪除資料夾
        </el-button>
        <div class="folder-footer-right">
          <el-button @click="folderEditOpen = false">取消</el-button>
          <el-button
            type="primary"
            :loading="folderSaving"
            :disabled="folderDeleting || !folderForm.name.trim() || folderForm.name.trim() === folderEditTarget?.name"
            @click="saveFolderName"
          >
            儲存
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'

definePageMeta({ middleware: ['auth', 'ai-feature'], layout: 'default' })

type SourceType = 'file' | 'url' | 'manual' | 'gsheet'
type SourceStatus = 'fetching' | 'splitting' | 'ready' | 'failed'

interface SourceSummary {
  id: string
  type: SourceType
  name: string
  url: string
  folderId: string | null
  status: SourceStatus
  failureReason?: string
  chunkCount: number
  refreshIntervalMinutes: number
  onChangeBehavior: 'notify' | 'log_only'
  lastFetchedAtMs: number
  outdatedAtMs: number
  updatedAtMs: number
}

interface ChunkRow {
  id: string
  title: string
  content: string
  tags: string[]
  status: string
  failureReason?: string
  manuallyEditedAtMs: number
  updatedAtMs: number
}

interface DiffEntry {
  id: string
  kind: 'new' | 'modified' | 'removed' | 'unchanged'
  defaultAction: 'add_new' | 'use_new' | 'keep_old' | 'delete_old' | 'skip'
  oldChunk?: {
    id: string
    title: string
    content: string
    tags: string[]
    manuallyEdited: boolean
  }
  newChunk?: { title: string; content: string; tags: string[] }
}

interface DiffData {
  sourceId: string
  sourceName: string
  sourceUrl: string
  diff: {
    entries: DiffEntry[]
    summary: { added: number; modified: number; removed: number; unchanged: number }
  }
}

const { apiFetch, workspaceId, can } = useWorkspace()
// 內容維護一律 agent+；來源/資料夾/知識卡目前同層級，分開判斷以便日後政策若拆分只改一處
const canEditKb = computed(() => can('knowledge.write'))
const canEditSources = computed(() => can('sources.write'))
const canEditFolders = computed(() => can('folders.write'))
const { showToast } = useAdminToast()

const sources = ref<SourceSummary[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const selectedSource = computed(() => sources.value.find(s => s.id === selectedId.value) ?? null)

// orphan chunks（sourceId === null）— 給「整理舊資料」橫幅用
const orphanCount = ref(0)
const migrating = ref(false)

// ── 資料夾分組 ───────────────────────────────────────
interface FolderRow {
  id: string
  name: string
  order: number
  createdAtMs: number
}
const folders = ref<FolderRow[]>([])

// 哪些資料夾是展開狀態（含特殊值 '__none__' 代表「未分類」）；localStorage 持久化
const expandedFolders = ref<Set<string>>(new Set(['__none__']))
const LS_EXPANDED_KEY = computed(() => `kb-folders-expanded:${workspaceId.value}`)
function loadExpandedState() {
  try {
    const raw = localStorage.getItem(LS_EXPANDED_KEY.value)
    if (raw) expandedFolders.value = new Set(JSON.parse(raw) as string[])
  }
  catch { /* 預設只展開「未分類」 */ }
}
function saveExpandedState() {
  try {
    localStorage.setItem(LS_EXPANDED_KEY.value, JSON.stringify([...expandedFolders.value]))
  }
  catch { /* 寫不進去就算了 */ }
}
function isExpanded(folderId: string) { return expandedFolders.value.has(folderId) }
function toggleFolder(folderId: string) {
  if (expandedFolders.value.has(folderId)) expandedFolders.value.delete(folderId)
  else expandedFolders.value.add(folderId)
  expandedFolders.value = new Set(expandedFolders.value) // trigger reactivity
  saveExpandedState()
}

const sourcesByFolder = computed(() => {
  const map: Record<string, SourceSummary[]> = {}
  for (const s of sources.value) {
    const key = s.folderId || ''
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(s)
  }
  return map
})
const uncategorizedSources = computed(() => sources.value.filter(s => !s.folderId))
const countByFolder = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {}
  for (const f of folders.value) m[f.id] = (sourcesByFolder.value[f.id] ?? []).length
  return m
})

// ── 拖曳：把 source 拖到 folder ─────────────────────
const draggedSourceId = ref<string | null>(null)
const dragOverFolderId = ref<string | null>(null)

// 拖曳中的這筆是不是「資料夾裡」的卡？是的話才顯示「拖出資料夾」drop zone
const isDraggingFromFolder = computed(() => {
  if (!draggedSourceId.value) return false
  const src = sources.value.find(s => s.id === draggedSourceId.value)
  return !!src?.folderId
})

function onSourceDragStart(srcId: string, ev: DragEvent) {
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', srcId)
  }
  // dragstart 的同一個 frame 不能動到 DOM（「拖出資料夾」zone 是 v-if，
  // 立刻插入會讓 Chrome 直接取消這次拖曳），所以延後一個 frame 再設
  requestAnimationFrame(() => {
    draggedSourceId.value = srcId
  })
}
function onSourceDragEnd() {
  draggedSourceId.value = null
  dragOverFolderId.value = null
}
// ── Folder header 拖曳排序（資料夾之間互換順序）──────
const draggedFolderId = ref<string | null>(null)
const folderReorderOverId = ref<string | null>(null)

function onFolderHeaderDragStart(e: DragEvent, folderId: string) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', folderId)
  }
  // 同 onSourceDragStart：state 延後一個 frame，避免 dragstart 當下重繪取消拖曳
  requestAnimationFrame(() => {
    draggedFolderId.value = folderId
  })
}
function onFolderHeaderDragEnd() {
  draggedFolderId.value = null
  folderReorderOverId.value = null
}
async function reorderFoldersTo(targetFolderId: string) {
  const fromId = draggedFolderId.value
  draggedFolderId.value = null
  folderReorderOverId.value = null
  if (!fromId || fromId === targetFolderId) return
  const next = [...folders.value]
  const fromIndex = next.findIndex(f => f.id === fromId)
  const toIndex = next.findIndex(f => f.id === targetFolderId)
  if (fromIndex < 0 || toIndex < 0) return
  const previous = folders.value
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved!)
  folders.value = next
  try {
    await apiFetch('/api/ai/folders/reorder', {
      method: 'POST',
      body: { orderedIds: next.map(f => f.id) },
    })
  }
  catch (err: any) {
    folders.value = previous
    showToast(err?.statusMessage || '資料夾排序儲存失敗', 'error')
  }
}

function onFolderDragOver(folderId: string, ev: DragEvent) {
  if (draggedFolderId.value) {
    // 拖的是資料夾 → 在別的資料夾標頭上顯示「插入位置」
    if (folderId !== '__none__' && folderId !== draggedFolderId.value) {
      folderReorderOverId.value = folderId
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
    }
    return
  }
  if (!draggedSourceId.value) return
  dragOverFolderId.value = folderId
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
}
function onFolderDragLeave(folderId: string) {
  if (dragOverFolderId.value === folderId) dragOverFolderId.value = null
  if (folderReorderOverId.value === folderId) folderReorderOverId.value = null
}
async function onFolderDrop(folderId: string | null) {
  if (draggedFolderId.value) {
    if (folderId) await reorderFoldersTo(folderId)
    return
  }
  const srcId = draggedSourceId.value
  dragOverFolderId.value = null
  draggedSourceId.value = null
  if (!srcId) return
  const src = sources.value.find(s => s.id === srcId)
  if (!src) return
  if ((src.folderId ?? null) === folderId) return // 沒換位置
  // 樂觀更新
  src.folderId = folderId
  try {
    await apiFetch(`/api/ai/sources/${srcId}`, {
      method: 'PUT',
      body: { folderId },
    })
  }
  catch (err: any) {
    showToast(err?.statusMessage || '移動失敗', 'error')
    await loadSources()
  }
}

const chunks = ref<ChunkRow[]>([])

const settingsForm = ref({ refreshIntervalMinutes: 0, onChangeBehavior: 'notify' as 'notify' | 'log_only' })
const settingsBaseline = ref({ refreshIntervalMinutes: 0, onChangeBehavior: 'notify' as 'notify' | 'log_only' })
const settingsDirty = computed(() =>
  settingsForm.value.refreshIntervalMinutes !== settingsBaseline.value.refreshIntervalMinutes
  || settingsForm.value.onChangeBehavior !== settingsBaseline.value.onChangeBehavior,
)
const savingSettings = ref(false)
const deleting = ref(false)

const resyncing = ref(false)
const gsheetSyncing = ref(false)
const applying = ref(false)
const diffOpen = ref(false)
const diffData = ref<DiffData | null>(null)
const decisions = ref<Record<string, string>>({})

// ── Chunk edit / create modal ───────────────────────
const chunkEditOpen = ref(false)
const chunkEditMode = ref<'create' | 'edit'>('create')
const chunkEditingId = ref<string | null>(null) // edit 模式才有值
// questions 是 AI 整理產生的常見問法,使用者不直接編;沒值就不送、後端保留既有
const chunkForm = ref({ title: '', content: '', tags: [] as string[], questions: undefined as string[] | undefined })
const chunkSaving = ref(false)
const chunkDeleting = ref(false)
const chunkEditStatus = ref('')
const chunkEditFailureReason = ref('')
const chunkNormalizing = ref(false)
const chunkReindexing = ref(false)

// ── Folder edit modal ───────────────────────────────
const folderEditOpen = ref(false)
const folderEditTarget = ref<FolderRow | null>(null)
const folderForm = ref({ name: '' })
const folderSaving = ref(false)
const folderDeleting = ref(false)
const chunkTagInput = ref('')
const chunkTagInputVisible = ref(false)
const chunkTagInputEl = ref<{ focus: () => void } | null>(null)

async function loadSources() {
  loading.value = true
  try {
    const [sourcesRes, foldersRes] = await Promise.all([
      apiFetch<{ items: SourceSummary[]; orphanCount?: number }>('/api/ai/sources/list'),
      apiFetch<{ items: FolderRow[] }>('/api/ai/folders').catch(() => ({ items: [] as FolderRow[] })),
    ])
    sources.value = sourcesRes.items
    orphanCount.value = Number(sourcesRes.orphanCount ?? 0)
    folders.value = foldersRes.items ?? []
    // 第一次載入：把所有資料夾預設展開（之後 toggle 會覆寫 localStorage 狀態）
    if (expandedFolders.value.size === 1 && expandedFolders.value.has('__none__')) {
      const init = new Set<string>(['__none__'])
      for (const f of folders.value) init.add(f.id)
      expandedFolders.value = init
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '載入來源失敗', 'error')
  }
  finally {
    loading.value = false
  }
}

// ── 資料夾 CRUD ─────────────────────────────────────
async function createFolderPrompt() {
  try {
    const { value } = await ElMessageBox.prompt('輸入資料夾名稱：', '📂 新資料夾', {
      confirmButtonText: '建立',
      cancelButtonText: '取消',
      inputPlaceholder: '例：客服 FAQ',
      inputPattern: /^.{1,50}$/,
      inputErrorMessage: '名稱長度需 1–50 字',
    })
    const name = String(value ?? '').trim()
    if (!name) return
    const folder = await apiFetch<FolderRow>('/api/ai/folders', { method: 'POST', body: { name } })
    folders.value = [...folders.value, folder]
    expandedFolders.value = new Set([...expandedFolders.value, folder.id])
    saveExpandedState()
    showToast('已建立資料夾', 'success')
  }
  catch { /* 使用者取消 */ }
}

// 編輯資料夾 modal — 改名 + 刪除都在這裡做
function openFolderEdit(folder: FolderRow) {
  folderEditTarget.value = folder
  folderForm.value = { name: folder.name }
  folderEditOpen.value = true
}

async function saveFolderName() {
  if (!folderEditTarget.value) return
  const target = folderEditTarget.value
  const newName = folderForm.value.name.trim()
  if (!newName || newName === target.name) return
  folderSaving.value = true
  try {
    const res = await apiFetch<FolderRow>(`/api/ai/folders/${target.id}`, {
      method: 'PUT',
      body: { name: newName },
    })
    const idx = folders.value.findIndex(f => f.id === target.id)
    if (idx >= 0) folders.value[idx] = res
    showToast('已重新命名', 'success')
    folderEditOpen.value = false
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    folderSaving.value = false
  }
}

async function deleteFolderFromModal() {
  if (!folderEditTarget.value) return
  const target = folderEditTarget.value
  const count = countByFolder.value[target.id] ?? 0
  const msg = count
    ? `要刪除「${target.name}」這個資料夾嗎？\n底下的 ${count} 筆來源會自動移到「未分類」，不會被刪除。`
    : `要刪除「${target.name}」這個空資料夾嗎？`
  try {
    await ElMessageBox.confirm(msg, '🗑️ 刪除資料夾', {
      confirmButtonText: '刪除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  }
  catch { return }
  folderDeleting.value = true
  try {
    await apiFetch(`/api/ai/folders/${target.id}`, { method: 'DELETE' })
    folders.value = folders.value.filter(f => f.id !== target.id)
    // 把底下的 source 顯示在「未分類」
    for (const s of sources.value) {
      if (s.folderId === target.id) s.folderId = null
    }
    showToast(count ? `已刪除資料夾，${count} 筆來源已移至未分類` : '已刪除空資料夾', 'success')
    folderEditOpen.value = false
  }
  catch (err: any) {
    showToast(err?.statusMessage || '刪除失敗', 'error')
  }
  finally {
    folderDeleting.value = false
  }
}

async function selectSource(src: SourceSummary) {
  selectedId.value = src.id
  await loadSourceDetail(src.id)
}

async function loadSourceDetail(sourceId: string) {
  try {
    const res = await apiFetch<{ source: SourceSummary; chunks: ChunkRow[] }>(`/api/ai/sources/${sourceId}`)
    // 用最新的 source 覆寫 list 裡的同一筆，保證 detail 不過時
    const idx = sources.value.findIndex(s => s.id === sourceId)
    if (idx >= 0) sources.value[idx] = res.source
    chunks.value = res.chunks
    settingsForm.value = {
      refreshIntervalMinutes: res.source.refreshIntervalMinutes,
      onChangeBehavior: res.source.onChangeBehavior,
    }
    settingsBaseline.value = { ...settingsForm.value }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '載入細節失敗', 'error')
  }
}

async function saveSettings() {
  if (!selectedId.value) return
  savingSettings.value = true
  try {
    await apiFetch(`/api/ai/sources/${selectedId.value}`, {
      method: 'PUT',
      body: { ...settingsForm.value },
    })
    settingsBaseline.value = { ...settingsForm.value }
    showToast('已儲存設定', 'success')
    await loadSourceDetail(selectedId.value)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    savingSettings.value = false
  }
}

async function deleteSource() {
  if (!selectedSource.value) return
  const src = selectedSource.value

  // 二次確認：使用者必須在輸入框打「刪除」兩個字才能繼續，避免誤刪
  try {
    await ElMessageBox.prompt(
      `要刪除「${src.name}」這個來源，會連同底下 ${src.chunkCount} 張卡片全部刪除，無法復原。\n\n請在下方輸入「刪除」確認：`,
      '⚠️ 刪除確認',
      {
        confirmButtonText: '永久刪除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        inputPattern: /^刪除$/,
        inputErrorMessage: '請輸入「刪除」兩個字',
        inputPlaceholder: '刪除',
        type: 'warning',
        roundButton: true,
      },
    )
  }
  catch {
    return // 使用者取消或關閉
  }

  deleting.value = true
  try {
    await apiFetch(`/api/ai/sources/${selectedId.value}`, { method: 'DELETE' })
    showToast(`已刪除「${src.name}」`, 'success')
    selectedId.value = null
    chunks.value = []
    await loadSources()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '刪除失敗', 'error')
  }
  finally {
    deleting.value = false
  }
}

async function startResync() {
  if (!selectedId.value) return
  resyncing.value = true
  try {
    const res = await apiFetch<DiffData>(`/api/ai/sources/${selectedId.value}/resync-preview`, {
      method: 'POST',
      body: {},
    })
    diffData.value = res
    // 用後端 defaultAction 初始化使用者決定
    const init: Record<string, string> = {}
    for (const e of res.diff.entries) init[e.id] = e.defaultAction
    decisions.value = init
    diffOpen.value = true
  }
  catch (err: any) {
    showToast(err?.statusMessage || '取得差異失敗', 'error')
  }
  finally {
    resyncing.value = false
  }
}

async function syncGsheetNow() {
  if (!selectedId.value) return
  gsheetSyncing.value = true
  try {
    const res = await apiFetch<{ outcome: 'unchanged' | 'synced'; added: number; updated: number; deleted: number; kept: number }>(
      `/api/ai/sources/${selectedId.value}/gsheet-sync`,
      { method: 'POST', body: {} },
    )
    await loadSourceDetail(selectedId.value)
    if (res.outcome === 'unchanged') {
      showToast('已是最新，無變動', 'success')
    }
    else {
      showToast(`同步完成：新增 ${res.added}、更新 ${res.updated}、刪除 ${res.deleted}`, 'success')
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '同步失敗', 'error')
  }
  finally {
    gsheetSyncing.value = false
  }
}

async function applyDiff() {
  if (!diffData.value || !selectedId.value) return
  applying.value = true
  try {
    const res = await apiFetch<{ added: number; updated: number; deleted: number; kept: number; errors: any[] }>(
      `/api/ai/sources/${selectedId.value}/resync-apply`,
      {
        method: 'POST',
        body: {
          entries: diffData.value.diff.entries,
          decisions: decisions.value,
        },
      },
    )
    const errTail = res.errors?.length ? `；失敗 ${res.errors.length} 張（看 console）` : ''
    showToast(`已套用：新增 ${res.added}、更新 ${res.updated}、刪除 ${res.deleted}、保留 ${res.kept}${errTail}`, res.errors?.length ? 'warning' : 'success')
    if (res.errors?.length) console.warn('[resync-apply] errors:', res.errors)
    diffOpen.value = false
    diffData.value = null
    await loadSources()
    if (selectedId.value) await loadSourceDetail(selectedId.value)
  }
  catch (err: any) {
    showToast(err?.statusMessage || '套用失敗', 'error')
  }
  finally {
    applying.value = false
  }
}

// ── 匯入彈窗(原獨立頁面已整併) ──────────────────────
const importOpen = ref(false)
function goImport() { importOpen.value = true }

async function onImported(sourceId: string | null) {
  await loadSources()
  if (sourceId) {
    const src = sources.value.find(s => s.id === sourceId)
    if (src) await selectSource(src)
  }
}

// ── 一鍵整理舊版未分組卡片 ───────────────────────────
async function migrateOrphans() {
  migrating.value = true
  try {
    const res = await apiFetch<{ migrated: number; capped: boolean }>(
      '/api/ai/sources/migrate-orphans',
      { method: 'POST', body: {} },
    )
    const tail = res.capped ? '（達單次上限 200，剩下的請再點一次）' : ''
    showToast(`已整理 ${res.migrated} 張舊卡為手寫條目${tail}`, 'success')
    await loadSources()
  }
  catch (err: any) {
    showToast(err?.statusMessage || '整理失敗', 'error')
  }
  finally {
    migrating.value = false
  }
}

// ── 重新命名（用 ElMessageBox.prompt） ───────────────
async function renameSource() {
  if (!selectedSource.value) return
  const current = selectedSource.value.name
  try {
    const { value } = await ElMessageBox.prompt('輸入新名稱：', '✏️ 重新命名來源', {
      confirmButtonText: '儲存',
      cancelButtonText: '取消',
      inputValue: current,
      inputPattern: /^.{1,200}$/,
      inputErrorMessage: '名稱長度需 1–200 字',
    })
    const newName = String(value ?? '').trim()
    if (!newName || newName === current) return
    await apiFetch(`/api/ai/sources/${selectedId.value}`, {
      method: 'PUT',
      body: { name: newName },
    })
    showToast('已重新命名', 'success')
    await loadSources()
    if (selectedId.value) await loadSourceDetail(selectedId.value)
  }
  catch { /* 使用者取消 */ }
}

// ── 新增手寫卡片 ─────────────────────────────────────
function openCreateManual() {
  chunkEditMode.value = 'create'
  chunkEditingId.value = null
  chunkForm.value = { title: '', content: '', tags: [], questions: undefined }
  chunkEditStatus.value = ''
  chunkEditFailureReason.value = ''
  chunkEditOpen.value = true
}

// ── 編輯既有 chunk ───────────────────────────────────
function openEditChunk(chunk: ChunkRow) {
  chunkEditMode.value = 'edit'
  chunkEditingId.value = chunk.id
  chunkForm.value = {
    title: chunk.title,
    content: chunk.content,
    tags: [...(chunk.tags ?? [])],
    questions: undefined,
  }
  chunkEditStatus.value = chunk.status
  chunkEditFailureReason.value = chunk.failureReason ?? ''
  chunkEditOpen.value = true
}

// ── AI 整理(normalize):加重點摘要、去系統碼 ─────────
async function normalizeChunkFromModal() {
  const original = chunkForm.value.content.trim()
  if (!original) return
  chunkNormalizing.value = true
  try {
    const res = await apiFetch<{ title: string; content: string; tags: string[]; questions?: string[] }>(
      '/api/ai/knowledge/normalize',
      {
        method: 'POST',
        body: {
          title: chunkForm.value.title,
          content: chunkForm.value.content,
          tags: chunkForm.value.tags,
        },
      },
    )
    chunkForm.value.title = res.title || chunkForm.value.title
    chunkForm.value.content = res.content
    chunkForm.value.tags = res.tags
    if (res.questions?.length) chunkForm.value.questions = res.questions
    showToast('已整理 — 記得儲存 ✨', 'success')
  }
  catch (err: any) {
    showToast(err?.statusMessage || 'AI 整理失敗', 'error')
  }
  finally {
    chunkNormalizing.value = false
  }
}

// ── 重新索引(索引失敗的卡) ──────────────────────────
async function reindexChunkFromModal() {
  if (!chunkEditingId.value) return
  chunkReindexing.value = true
  try {
    await apiFetch(`/api/ai/knowledge/${chunkEditingId.value}/reindex`, { method: 'POST' })
    showToast('已重新索引', 'success')
    if (selectedId.value) await loadSourceDetail(selectedId.value)
    const updated = chunks.value.find(c => c.id === chunkEditingId.value)
    if (updated) {
      chunkEditStatus.value = updated.status
      chunkEditFailureReason.value = updated.failureReason ?? ''
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '重新索引失敗', 'error')
  }
  finally {
    chunkReindexing.value = false
  }
}

async function saveChunk() {
  const t = chunkForm.value.title.trim()
  const c = chunkForm.value.content.trim()
  if (!t || !c) return
  chunkSaving.value = true
  try {
    const body: Record<string, unknown> = { title: t, content: c, tags: chunkForm.value.tags }
    if (chunkForm.value.questions?.length) body.questions = chunkForm.value.questions
    if (chunkEditMode.value === 'create') {
      // 建立新手寫卡片（後端會自動建一個 type='manual' 的 source 包它）
      const res = await apiFetch<{ id: string; sourceId: string }>('/api/ai/knowledge/create', {
        method: 'POST',
        body,
      })
      showToast('已建立', 'success')
      chunkEditOpen.value = false
      await loadSources()
      if (res.sourceId) {
        selectedId.value = res.sourceId
        await loadSourceDetail(res.sourceId)
      }
    }
    else if (chunkEditingId.value) {
      await apiFetch(`/api/ai/knowledge/${chunkEditingId.value}`, {
        method: 'PUT',
        body,
      })
      showToast('已儲存', 'success')
      chunkEditOpen.value = false
      if (selectedId.value) await loadSourceDetail(selectedId.value)
      await loadSources() // 因為 manual source 名稱可能跟著變
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '儲存失敗', 'error')
  }
  finally {
    chunkSaving.value = false
  }
}

async function deleteChunkFromModal() {
  if (chunkEditMode.value !== 'edit' || !chunkEditingId.value) return
  const title = chunkForm.value.title || '(未命名)'
  try {
    await ElMessageBox.confirm(
      `要刪除「${title}」這張卡片嗎？無法復原。`,
      '🗑️ 刪除卡片',
      {
        confirmButtonText: '刪除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    )
  }
  catch { return }
  const targetId = chunkEditingId.value
  chunkDeleting.value = true
  try {
    await apiFetch(`/api/ai/knowledge/${targetId}`, { method: 'DELETE' })
    showToast('已刪除', 'success')
    chunkEditOpen.value = false
    // 若這張是 manual single-card source 的唯一卡，後端會連 source 一起刪 → 重載 source list
    await loadSources()
    if (selectedId.value) {
      const stillExists = sources.value.find(s => s.id === selectedId.value)
      if (stillExists) await loadSourceDetail(selectedId.value)
      else selectedId.value = null
    }
  }
  catch (err: any) {
    showToast(err?.statusMessage || '刪除失敗', 'error')
  }
  finally {
    chunkDeleting.value = false
  }
}

// ── Chunk tag input ─────────────────────────────────
function showChunkTagInput() {
  chunkTagInputVisible.value = true
  nextTick(() => chunkTagInputEl.value?.focus())
}
function commitChunkTag() {
  const t = chunkTagInput.value.trim()
  if (t && !chunkForm.value.tags.includes(t)) {
    chunkForm.value.tags = [...chunkForm.value.tags, t]
  }
  chunkTagInput.value = ''
  chunkTagInputVisible.value = false
}
function removeChunkTag(t: string) {
  chunkForm.value.tags = chunkForm.value.tags.filter(x => x !== t)
}

// ─── Display helpers ───────────────────────────────────
function typeEmoji(t: string | undefined) {
  return t === 'url' ? '🔗' : t === 'file' ? '📄' : t === 'gsheet' ? '📊' : '✍️'
}
function typeLabel(t: string) {
  return t === 'url' ? '網址' : t === 'file' ? '檔案' : t === 'gsheet' ? 'Google Sheet' : '手打'
}
function statusLabel(s: string) {
  return s === 'ready' ? '可用' : s === 'fetching' ? '抓取中' : s === 'splitting' ? '切卡中' : '失敗'
}
function chunkStatusLabel(s: string) {
  return s === 'indexed' ? '可用' : s === 'pending' ? '處理中' : '失敗'
}
function chunkStatusBadge(s: string) {
  return s === 'indexed' ? 'badge-green' : s === 'pending' ? 'badge-yellow' : 'badge-red'
}
function statusChipText(src: SourceSummary) {
  if (src.outdatedAtMs > 0) return '⚠️ 有變動'
  if (src.status === 'ready') return '可用'
  return statusLabel(src.status)
}
function statusChipTone(src: SourceSummary): 'success' | 'warning' | 'error' | 'neutral' {
  if (src.outdatedAtMs > 0) return 'warning'
  if (src.status === 'ready') return 'success'
  if (src.status === 'failed') return 'error'
  return 'neutral'
}
function metaText(src: SourceSummary) {
  const parts: string[] = []
  parts.push(`${src.chunkCount} 張卡`)
  if (src.lastFetchedAtMs) parts.push(`同步：${relativeTime(src.lastFetchedAtMs)}`)
  return parts.join(' · ')
}
function kindLabel(k: string) {
  return k === 'new' ? '🟢 新增' : k === 'modified' ? '🟡 修改' : k === 'removed' ? '🔴 移除' : '⚪ 未變'
}
function relativeTime(ms: number) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`
  return new Date(ms).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

onMounted(async () => {
  loadExpandedState()
  const route = useRoute()
  await loadSources()

  // 監控頁「📥 補知識」帶 ?q=(客人沒被答到的問題):直接開新增手寫視窗、預填標題
  const q = String(route.query.q ?? '').trim()
  if (q) {
    openCreateManual()
    chunkForm.value.title = q.slice(0, 200)
    return
  }

  // 測試對話頁「編輯」帶 ?chunkId=:反查所屬來源,自動選取並開啟該卡的編輯視窗
  const chunkId = String(route.query.chunkId ?? '').trim()
  if (chunkId) {
    await openChunkById(chunkId)
    return
  }

  // 匯入完成帶 ?sourceId=:自動選中剛匯入的來源,讓使用者直接看到成果
  const sourceId = String(route.query.sourceId ?? '').trim()
  if (sourceId) {
    const src = sources.value.find(s => s.id === sourceId)
    if (src) await selectSource(src)
    return
  }

  // 舊的 /knowledge/import 網址轉進來時帶 ?import=1:直接打開匯入彈窗
  if (String(route.query.import ?? '') === '1') importOpen.value = true
})

async function openChunkById(chunkId: string) {
  try {
    const info = await apiFetch<{ id: string; sourceId: string | null }>(`/api/ai/knowledge/${chunkId}`)
    if (!info.sourceId) {
      showToast('這張卡尚未歸入任何來源,請先用「一鍵整理」歸檔', 'error')
      return
    }
    const src = sources.value.find(s => s.id === info.sourceId)
    if (!src) return
    await selectSource(src)
    const chunk = chunks.value.find(c => c.id === chunkId)
    if (chunk) openEditChunk(chunk)
  }
  catch {
    showToast('找不到這張卡(可能已被刪除)', 'error')
  }
}
</script>

<style scoped lang="scss">

// ─── Orphan migration banner ─────────────────────
.src-orphan-banner {
  margin: 10px 12px;
  padding: 10px 12px;
  background: var(--el-color-warning-light-9);
  border-left: 3px solid var(--el-color-warning);
  border-radius: 4px;
  font-size: 13px;
}
.src-orphan-msg { margin: 0 0 4px; }
.src-orphan-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

// ─── Folder headers — 群組標題感（比 row 重、有底色、跟上方有間距） ───
.src-folder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0.625rem;
  margin-top: 0.5rem; /* 跟上方未分類 / 上一個資料夾拉出間距 */
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  outline: 2px solid transparent;
  outline-offset: -2px;
  font-size: 0.875rem;
  font-weight: 700; /* 比 row 的 500-600 更重 */
  color: var(--text-primary);
  background: var(--bg-surface); /* 抬升一階，跟列表底色區別 */
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s, outline-color 0.15s;

  &:hover {
    background: var(--bg-hover);
    border-color: var(--text-muted);
  }
  /* 拖曳目標 highlight：對齊 .flow-sidebar-row--drag-over */
  &--drop {
    outline-color: var(--color-line);
    border-color: var(--color-line);
  }
}

/* ─── 資料夾內的卡片 — 縮排 + 左側 guide line ───
   讓「在資料夾內」跟「未分類」一眼就分得出來 */
.src-row--in-folder {
  margin-left: 0.875rem;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: -0.5rem;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--border);
  }
  /* hover 時 guide line 稍微亮一點 */
  &:hover::before {
    background: var(--text-muted);
  }
}
.src-folder-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src-folder-arrow {
  display: inline-block;
  width: 12px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.src-folder-count {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-muted);
}
.src-folder-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
/* 永遠可見的小 icon 按鈕（沿用 .drag-handle 的 opacity 模式） */
.src-folder-icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 0.875rem;
  border-radius: 4px;
  opacity: 0.5;
  color: var(--text-muted);
  transition: opacity 0.15s, background 0.15s, color 0.15s;

  &:hover {
    opacity: 1;
    color: var(--text-secondary);
    background: var(--bg-surface);
  }
}
.src-folder-empty {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 4px 0.75rem 6px 1.75rem;
}

/* 「移出資料夾」drop zone — 只在拖曳中才顯示，平時為 0 高度 */
.src-unfolder-zone {
  margin: 6px 0;
  padding: 8px 12px;
  border: 1px dashed var(--text-muted);
  border-radius: var(--radius-md);
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--bg-surface);
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.15s, background 0.15s;

  &--drop {
    outline-color: var(--color-line);
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.src-header {
  flex: 1;
  min-width: 0;
}
.src-header-main { display: flex; gap: 12px; align-items: center; }
.src-type-emoji { font-size: 28px; }
.src-header-title { margin: 0; font-size: 17px; }
.src-header-url { margin: 2px 0 0; font-size: 12px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 600px;
  a { color: inherit; }
}

.src-section-card { margin-bottom: 0; } // gap 由 .admin-panel-stack 控制
.src-section-hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 0 0 8px; }

.src-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  > div {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }
}
.src-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}
.src-failure {
  margin: 8px 0 0;
  padding: 8px 10px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border-radius: 4px;
  font-size: 13px;
}

.src-settings-actions { margin-top: 8px; }

.src-chunk-list { display: flex; flex-direction: column; gap: 6px; }
.src-chunk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.src-chunk-main { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.src-chunk-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-chunk-lock { font-size: 12px; }
.src-chunk-meta { font-size: 12px; color: var(--el-text-color-secondary); }

.src-outdated-alert { margin-bottom: 12px; }

// ─── Diff modal ──────────────────────────────────
.diff-body {
  max-height: 70vh;
  overflow-y: auto;
}
.diff-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0 16px;
}
.diff-summary-chip {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--el-fill-color);
  &--add { background: var(--el-color-success-light-9); color: var(--el-color-success); }
  &--mod { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
  &--rem { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
  &--same { color: var(--el-text-color-secondary); }
}

.diff-entries { display: flex; flex-direction: column; gap: 12px; }
.diff-entry {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--el-bg-color);
  &--new { border-left: 3px solid var(--el-color-success); }
  &--modified { border-left: 3px solid var(--el-color-warning); }
  &--removed { border-left: 3px solid var(--el-color-danger); }
  &--unchanged { opacity: 0.6; }
}

.diff-entry-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.diff-entry-kind { font-size: 12px; font-weight: 600; }
.diff-entry-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.diff-entry-lock { font-size: 12px; color: var(--el-text-color-secondary); }

.diff-entry-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}
.diff-col {
  padding: 8px 10px;
  border-radius: 4px;
  &--old { background: var(--el-color-danger-light-9); }
  &--new { background: var(--el-color-success-light-9); }
}
.diff-col-head { font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--el-text-color-secondary); }
.diff-col pre, .diff-entry-single pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
  max-height: 200px;
  overflow-y: auto;
}
.diff-entry-single {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.diff-entry-actions { margin-top: 10px; }

// ─── Chunk edit / create modal ────────────────────
.chunk-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chunk-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chunk-status-failure {
  font-size: 12px;
  color: var(--el-color-danger);
}

.chunk-normalize-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.chunk-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chunk-tag { margin: 0; }

.chunk-footer,
.folder-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.chunk-footer-right,
.folder-footer-right { display: flex; gap: 8px; }

.folder-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.folder-form-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
