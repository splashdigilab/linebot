/**
 * 腳本（情境）執行引擎。
 *
 * 流程：
 *   1. 找到匹配的腳本（依 trigger 關鍵字、priority 最高的勝出）
 *   2. 在 user doc 上寫入 activeScript 狀態，並執行第一步
 *   3. 後續訊息進來：把使用者輸入存到 collected[currentField]，跳下一個節點
 *   4. 遇到 reply 節點：渲染 {{變數}} 後回傳訊息給 webhook 層送出
 *   5. 結束：清 activeScript；若 thenHandoff=true 由 webhook 層觸發 live_agent
 *
 * 與 [shared/auto-reply-rule.ts](../../shared/auto-reply-rule.ts) 的差別：
 *   - 自動回覆是「一問一答」單步驟；腳本是多步驟有狀態
 *   - activeScript 是 user-level 的；同個使用者同時間只能在一條腳本中
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getDb } from './firebase'
import type {
  ActiveScriptState,
  ScriptCollectNode,
  ScriptDoc,
  ScriptNode,
  ScriptReplyNode,
  ScriptTriggerNode,
} from '~~/shared/types/ai-script'
import {
  matchesScriptTrigger,
  renderScriptTemplate,
} from '~~/shared/types/ai-script'

export const SCRIPTS_COLLECTION = 'scripts'

// ── In-memory cache（60 秒），減少每則訊息打 Firestore ────────────────────
const CACHE_TTL_MS = 60_000
interface ScriptCache { data: Array<ScriptDoc & { id: string }>; expires: number }
const cache = new Map<string, ScriptCache>()

export function invalidateScriptsCache(workspaceId: string) {
  cache.delete(workspaceId)
}

export async function loadActiveScripts(workspaceId: string, db: Firestore = getDb()): Promise<Array<ScriptDoc & { id: string }>> {
  const cached = cache.get(workspaceId)
  if (cached && cached.expires > Date.now()) return cached.data

  const snap = await db.collection(SCRIPTS_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .where('enabled', '==', true)
    .orderBy('priority', 'desc')
    .get()
  const rows: Array<ScriptDoc & { id: string }> = snap.docs.map(d => ({
    id: d.id,
    ...(d.data() as ScriptDoc),
  }))
  cache.set(workspaceId, { data: rows, expires: Date.now() + CACHE_TTL_MS })
  return rows
}

/**
 * 找到第一個（priority 最高）能被觸發的腳本。
 * scripts 必須已依 priority 降序排列（loadActiveScripts 已處理）。
 */
export function findMatchingScript(
  scripts: Array<ScriptDoc & { id: string }>,
  inputText: string,
): (ScriptDoc & { id: string }) | null {
  for (const s of scripts) {
    if (matchesScriptTrigger(s, inputText)) return s
  }
  return null
}

// ── Active script lifecycle ──────────────────────────────────────────────

export interface ScriptStepResult {
  /** 要送給使用者的訊息（reply 節點才有；collect 節點是「問問題」） */
  replyText: string
  /** 流程結束後是否要 handoff 到 live_agent */
  thenHandoff: boolean
  /** 流程結束（reply 節點被執行 / 流程錯誤）→ 呼叫方應清 activeScript */
  finished: boolean
}

const EMPTY_RESULT: ScriptStepResult = { replyText: '', thenHandoff: false, finished: true }

function findNode(script: ScriptDoc, id: string): ScriptNode | undefined {
  return script.nodes.find(n => n.id === id)
}

function runNonInteractiveSteps(
  script: ScriptDoc,
  startNodeId: string,
  state: ActiveScriptState,
  attributes: Record<string, string>,
): { nextState: ActiveScriptState | null; result: ScriptStepResult } {
  // 從 startNodeId 開始，盡量往前推到「需要使用者輸入」（collect 節點的 question）或「結束」
  let cursor: string = startNodeId
  let nextState: ActiveScriptState | null = { ...state, currentNodeId: cursor }

  for (let i = 0; i < 50; i++) { // 防無限迴圈
    const node = findNode(script, cursor)
    if (!node) return { nextState: null, result: EMPTY_RESULT }

    if (node.type === 'trigger') {
      cursor = node.next
      nextState = { ...nextState!, currentNodeId: cursor }
      continue
    }

    if (node.type === 'collect') {
      // 問問題給使用者；停在這裡等下一則訊息
      return {
        nextState: { ...nextState!, currentNodeId: node.id, expiresAt: Date.now() + (node.expireMs || 600_000) },
        result: {
          replyText: renderScriptTemplate(node.question, {
            collected: nextState!.collected,
            attributes,
          }),
          thenHandoff: false,
          finished: false,
        },
      }
    }

    if (node.type === 'reply') {
      // 立刻回覆並結束流程
      return {
        nextState: null,
        result: {
          replyText: renderScriptTemplate(node.text, {
            collected: nextState!.collected,
            attributes,
          }),
          thenHandoff: node.thenHandoff,
          finished: true,
        },
      }
    }

    // 未知節點型別 → 結束
    return { nextState: null, result: EMPTY_RESULT }
  }
  return { nextState: null, result: EMPTY_RESULT }
}

/**
 * 啟動腳本：寫入 activeScript 並執行第一步。
 */
export async function startScript(
  script: ScriptDoc & { id: string },
  userDocId: string,
  attributes: Record<string, string>,
  db: Firestore = getDb(),
): Promise<ScriptStepResult> {
  const trigger = script.nodes.find(n => n.id === script.rootNodeId) as ScriptTriggerNode | undefined
  if (!trigger) return EMPTY_RESULT

  const state: ActiveScriptState = {
    scriptId: script.id,
    currentNodeId: script.rootNodeId,
    collected: {},
    startedAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000, // 預設一小時 TTL
  }
  const { nextState, result } = runNonInteractiveSteps(script, trigger.next, state, attributes)
  await persistActiveScript(db, userDocId, nextState)
  return result
}

/**
 * 接收使用者輸入：填到 currentNode（必為 collect）的 fieldName，然後跳下一個。
 */
export async function advanceScript(
  state: ActiveScriptState,
  userMessage: string,
  attributes: Record<string, string>,
  userDocId: string,
  db: Firestore = getDb(),
): Promise<ScriptStepResult> {
  // 過期 → 直接清掉、丟回讓主流程走 rule / AI fallback
  if (state.expiresAt && state.expiresAt < Date.now()) {
    await persistActiveScript(db, userDocId, null)
    return EMPTY_RESULT
  }

  const script = await loadScript(db, state.scriptId)
  if (!script) {
    await persistActiveScript(db, userDocId, null)
    return EMPTY_RESULT
  }

  const current = findNode(script, state.currentNodeId)
  if (!current || current.type !== 'collect') {
    // 狀態壞了，清掉
    await persistActiveScript(db, userDocId, null)
    return EMPTY_RESULT
  }

  const collected = {
    ...state.collected,
    [(current as ScriptCollectNode).fieldName]: String(userMessage || '').trim(),
  }
  const newState: ActiveScriptState = { ...state, collected, currentNodeId: current.id }
  const { nextState, result } = runNonInteractiveSteps(
    script,
    (current as ScriptCollectNode).next,
    newState,
    attributes,
  )
  await persistActiveScript(db, userDocId, nextState)
  return result
}

async function loadScript(db: Firestore, scriptId: string): Promise<ScriptDoc | null> {
  const snap = await db.collection(SCRIPTS_COLLECTION).doc(scriptId).get()
  return snap.exists ? (snap.data() as ScriptDoc) : null
}

async function persistActiveScript(db: Firestore, userDocId: string, state: ActiveScriptState | null): Promise<void> {
  await db.collection('users').doc(userDocId).update({
    activeScript: state ?? FieldValue.delete(),
  }).catch((e) => {
    console.error('[ai-scripts] persistActiveScript failed:', e)
  })
}

// 注意：ScriptNode 等型別請從 ~~/shared/types/ai-script 取（Nuxt auto-import）
