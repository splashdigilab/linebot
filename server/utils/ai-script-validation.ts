/**
 * 從外部 body 收斂出乾淨的腳本 input。
 * 任何不合法欄位都會被預設值取代；不確定的 type 直接丟掉。
 */
import {
  DEFAULT_COLLECT_EXPIRE_MS,
  DEFAULT_SCRIPT_PRIORITY,
  type ScriptCollectNode,
  type ScriptDoc,
  type ScriptNode,
  type ScriptReplyNode,
  type ScriptTriggerNode,
} from '~~/shared/types/ai-script'

export interface ScriptInput {
  name: string
  enabled: boolean
  priority: number
  nodes: ScriptNode[]
  rootNodeId: string
}

export function normalizeScriptInput(raw: any): ScriptInput {
  const name = String(raw?.name ?? '').trim().slice(0, 100)
  const enabled = raw?.enabled !== false
  const priority = clampInt(raw?.priority, 1, 100, DEFAULT_SCRIPT_PRIORITY)
  const rootNodeId = String(raw?.rootNodeId ?? '').trim()
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.map(normalizeNode).filter(Boolean) as ScriptNode[] : []
  return { name, enabled, priority, nodes, rootNodeId }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeNode(raw: any): ScriptNode | null {
  const id = String(raw?.id ?? '').trim()
  const type = String(raw?.type ?? '').trim()
  if (!id || !type) return null

  if (type === 'trigger') {
    const node: ScriptTriggerNode = {
      id,
      type: 'trigger',
      keywords: Array.isArray(raw?.keywords)
        ? raw.keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 20)
        : [],
      priority: clampInt(raw?.priority, 1, 100, DEFAULT_SCRIPT_PRIORITY),
      next: String(raw?.next ?? '').trim(),
    }
    return node
  }

  if (type === 'collect') {
    const node: ScriptCollectNode = {
      id,
      type: 'collect',
      question: String(raw?.question ?? '').trim().slice(0, 500),
      fieldName: String(raw?.fieldName ?? '').trim().replace(/[^\w一-龥]/g, '').slice(0, 32),
      expireMs: clampInt(raw?.expireMs, 30_000, 24 * 60 * 60 * 1000, DEFAULT_COLLECT_EXPIRE_MS),
      next: String(raw?.next ?? '').trim(),
    }
    return node
  }

  if (type === 'reply') {
    const node: ScriptReplyNode = {
      id,
      type: 'reply',
      text: String(raw?.text ?? '').trim().slice(0, 2000),
      thenHandoff: raw?.thenHandoff === true,
    }
    return node
  }

  return null
}

/** 提供呼叫端取得 ScriptDoc 的工具型別（不含 timestamp） */
export type ScriptDocWritePayload = Omit<ScriptDoc, 'createdAt' | 'updatedAt'>
