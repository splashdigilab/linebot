import type { H3Event } from 'h3'
import type { DecodedIdToken } from 'firebase-admin/auth'
import type { WorkspaceMemberRole } from '~~/shared/types/organization'
import { getFirebaseAuth, getDb } from './firebase'

// ── 角色層級（數字越大權限越高）────────────────────────────────────

const ROLE_LEVEL: Record<WorkspaceMemberRole, number> = {
  viewer: 1,
  agent: 2,
  admin: 3,
  owner: 4,
}

// ── In-memory membership cache（TTL 60s）────────────────────────────

interface CachedMember {
  role: WorkspaceMemberRole
  expiresAt: number
}

const memberCache = new Map<string, CachedMember>()
const CACHE_TTL_MS = 60_000

function getCachedMember(uid: string, workspaceId: string): WorkspaceMemberRole | null {
  const key = `${uid}:${workspaceId}`
  const cached = memberCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.role
  memberCache.delete(key)
  return null
}

function setCachedMember(uid: string, workspaceId: string, role: WorkspaceMemberRole) {
  memberCache.set(`${uid}:${workspaceId}`, {
    role,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

// ── Super admin 判斷（Firebase custom claim）────────────────────────

export function isSuperAdmin(token: DecodedIdToken): boolean {
  return token['superAdmin'] === true
}

// ── Core: 驗證 token ─────────────────────────────────────────────

async function verifyToken(event: H3Event): Promise<DecodedIdToken> {
  const header = getHeader(event, 'authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  try {
    return await getFirebaseAuth().verifyIdToken(token)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired token' })
  }
}

// ── Core: 查詢 workspaceMembers ──────────────────────────────────

export async function getWorkspaceMember(
  uid: string,
  workspaceId: string,
): Promise<WorkspaceMemberRole | null> {
  const cached = getCachedMember(uid, workspaceId)
  if (cached) return cached

  const db = getDb()
  const snap = await db.collection('workspaceMembers').doc(`${uid}_${workspaceId}`).get()
  if (!snap.exists) return null

  const role = snap.data()!.role as WorkspaceMemberRole
  setCachedMember(uid, workspaceId, role)
  return role
}

// ── 解析 workspaceId from request ───────────────────────────────
// 優先順序：URL path param → query param → body

async function resolveWorkspaceId(event: H3Event): Promise<string | null> {
  // 1. path param（e.g. /api/admin/workspaces/:workspaceId/...）
  const params = event.context.params
  if (params?.workspaceId) return params.workspaceId

  // 2. query string（e.g. ?workspaceId=xxx）
  const query = getQuery(event)
  if (query.workspaceId) return String(query.workspaceId)

  // 3. request body（POST/PUT）
  try {
    const body = await readBody(event)
    if (body?.workspaceId) return String(body.workspaceId)
  } catch {
    // body might not exist or already consumed
  }

  return null
}

// ── Public API ────────────────────────────────────────────────────

export interface WorkspaceAuthContext {
  uid: string
  workspaceId: string
  role: WorkspaceMemberRole
  token: DecodedIdToken
  isSuperAdmin: boolean
}

/**
 * 驗證完整權限鏈：Firebase token → 解析 workspaceId → 查成員角色 → 比對最低角色要求。
 *
 * @param minRole 最低所需角色（預設 'viewer'）
 */
export async function requireWorkspaceAccess(
  event: H3Event,
  minRole: WorkspaceMemberRole = 'viewer',
): Promise<WorkspaceAuthContext> {
  const token = await verifyToken(event)
  const uid = token.uid

  // Super admin 可跨 workspace 存取，不需 membership
  if (isSuperAdmin(token)) {
    const workspaceId = await resolveWorkspaceId(event) ?? ''
    return { uid, workspaceId, role: 'owner', token, isSuperAdmin: true }
  }

  const workspaceId = await resolveWorkspaceId(event)
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspaceId is required' })
  }

  const role = await getWorkspaceMember(uid, workspaceId)
  if (!role) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: not a member of this workspace' })
  }

  if (ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
    throw createError({
      statusCode: 403,
      statusMessage: `Forbidden: requires at least '${minRole}' role`,
    })
  }

  return { uid, workspaceId, role, token, isSuperAdmin: false }
}
