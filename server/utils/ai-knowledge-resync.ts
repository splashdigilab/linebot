/**
 * Re-sync 流程：對既有的 source 重新抓內容、跑切卡、跟現有 chunk 對比後產生 diff，
 * 讓使用者人工選擇要保留 / 覆蓋 / 新增 / 刪除哪些卡。
 *
 * 設計重點：
 * - 不直接覆蓋，永遠出 diff 讓人類決定。
 * - 對「手動編輯過」的卡（manuallyEditedAt != null）預設 keep_old。
 * - 配對策略：用 title 完全相等比對。簡單可預期，title 改了就會出現「移除舊的 + 新增新的」配對，
 *   讓使用者自己決定要不要視為同一張。
 */
import type { Firestore } from 'firebase-admin/firestore'
import { listChunksBySource } from './ai-knowledge-sources'

export type DiffKind = 'new' | 'modified' | 'removed' | 'unchanged'
export type DiffAction = 'add_new' | 'use_new' | 'keep_old' | 'delete_old' | 'skip'

export interface DiffEntry {
  /** 穩定 ID，apply 時用 */
  id: string
  kind: DiffKind
  /** 後端建議的預設動作（前端可覆寫） */
  defaultAction: DiffAction
  /** 舊版本（kind=modified/removed/unchanged 才有） */
  oldChunk?: {
    id: string
    title: string
    content: string
    tags: string[]
    manuallyEdited: boolean
  }
  /** 新版本（kind=new/modified/unchanged 才有） */
  newChunk?: {
    title: string
    content: string
    tags: string[]
  }
}

export interface DiffSummary {
  added: number
  modified: number
  removed: number
  unchanged: number
}

interface OldChunk {
  id: string
  title: string
  content: string
  tags: string[]
  manuallyEditedAtMs: number
}
interface NewChunk {
  title: string
  content: string
  tags: string[]
}

export interface DiffResult {
  entries: DiffEntry[]
  summary: DiffSummary
}

export function computeDiff(oldChunks: OldChunk[], newChunks: NewChunk[]): DiffResult {
  const oldByTitle = new Map(oldChunks.map(c => [c.title, c]))
  const newByTitle = new Map(newChunks.map(c => [c.title, c]))

  const entries: DiffEntry[] = []
  const summary: DiffSummary = { added: 0, modified: 0, removed: 0, unchanged: 0 }

  // 走新版（new / modified / unchanged）
  for (let i = 0; i < newChunks.length; i++) {
    const n = newChunks[i]!
    const o = oldByTitle.get(n.title)
    if (!o) {
      entries.push({
        id: `new:${i}`,
        kind: 'new',
        defaultAction: 'add_new',
        newChunk: { title: n.title, content: n.content, tags: n.tags },
      })
      summary.added++
      continue
    }
    const contentSame = o.content === n.content
    const tagsSame = JSON.stringify([...o.tags].sort()) === JSON.stringify([...n.tags].sort())
    if (contentSame && tagsSame) {
      entries.push({
        id: `same:${o.id}`,
        kind: 'unchanged',
        defaultAction: 'keep_old',
        oldChunk: { id: o.id, title: o.title, content: o.content, tags: o.tags, manuallyEdited: o.manuallyEditedAtMs > 0 },
        newChunk: { title: n.title, content: n.content, tags: n.tags },
      })
      summary.unchanged++
    }
    else {
      const manuallyEdited = o.manuallyEditedAtMs > 0
      entries.push({
        id: `mod:${o.id}`,
        kind: 'modified',
        // 手動編輯過 → 預設保留人工版；沒編輯過 → 預設用新版
        defaultAction: manuallyEdited ? 'keep_old' : 'use_new',
        oldChunk: { id: o.id, title: o.title, content: o.content, tags: o.tags, manuallyEdited },
        newChunk: { title: n.title, content: n.content, tags: n.tags },
      })
      summary.modified++
    }
  }

  // 走舊版找出新版沒有的（removed）
  for (const o of oldChunks) {
    if (newByTitle.has(o.title)) continue
    const manuallyEdited = o.manuallyEditedAtMs > 0
    entries.push({
      id: `rem:${o.id}`,
      kind: 'removed',
      // 手動編輯過 → 預設保留；沒有 → 預設刪除
      defaultAction: manuallyEdited ? 'keep_old' : 'delete_old',
      oldChunk: { id: o.id, title: o.title, content: o.content, tags: o.tags, manuallyEdited },
    })
    summary.removed++
  }

  return { entries, summary }
}

/** 把 Firestore 拉出來的 raw chunks 轉成 diff 函式吃的格式 */
export async function loadOldChunksForDiff(
  db: Firestore,
  workspaceId: string,
  sourceId: string,
): Promise<OldChunk[]> {
  const chunks = await listChunksBySource(db, workspaceId, sourceId)
  return chunks.map(c => ({
    id: c.id,
    title: c.title,
    content: c.content,
    tags: c.tags,
    manuallyEditedAtMs: c.manuallyEditedAtMs,
  }))
}
