import type { H3Event } from 'h3'
import type { DecodedIdToken } from 'firebase-admin/auth'
import type { WorkspaceMemberRole, OrgMemberRole } from '~~/shared/types/organization'
import { getFirebaseAuth, getDb } from './firebase'

// ── 角色層級（數字越大權限越高）────────────────────────────────────

const ROLE_LEVEL: Record<WorkspaceMemberRole, number> = {
  viewer: 1,
  agent: 2,
  admin: 3,
  owner: 4,
}

// ── In-memory caches（TTL 60s）──────────────────────────────────────

const CACHE_TTL_MS = 60_000

// workspace member cache（UID-based）
interface CachedMember { role: WorkspaceMemberRole; expiresAt: number }
const memberCache = new Map<string, CachedMember>()

function getCachedMember(uid: string, workspaceId: string): WorkspaceMemberRole | null {
  const key = `${uid}:${workspaceId}`
  const c = memberCache.get(key)
  if (c && c.expiresAt > Date.now()) return c.role
  memberCache.delete(key)
  return null
}

function setCachedMember(uid: string, workspaceId: string, role: WorkspaceMemberRole) {
  memberCache.set(`${uid}:${workspaceId}`, { role, expiresAt: Date.now() + CACHE_TTL_MS })
}

// org member cache（email-based：以 email 查詢，不需要 UID）
interface CachedOrgMember { role: OrgMemberRole | null; expiresAt: number }
const orgMemberCache = new Map<string, CachedOrgMember>()

function getCachedOrgMember(email: string, orgId: string): OrgMemberRole | null | undefined {
  const key = `org:${email}:${orgId}`
  const c = orgMemberCache.get(key)
  if (c && c.expiresAt > Date.now()) return c.role
  orgMemberCache.delete(key)
  return undefined // undefined = cache miss
}

function setCachedOrgMember(email: string, orgId: string, role: OrgMemberRole | null) {
  orgMemberCache.set(`org:${email}:${orgId}`, { role, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function invalidateOrgMemberCache(email: string, orgId: string) {
  orgMemberCache.delete(`org:${email}:${orgId}`)
}

// workspace → organizationId cache
interface CachedWorkspaceOrg { organizationId: string | null; expiresAt: number }
const workspaceOrgCache = new Map<string, CachedWorkspaceOrg>()

async function getWorkspaceOrgId(workspaceId: string): Promise<string | null> {
  const c = workspaceOrgCache.get(workspaceId)
  if (c && c.expiresAt > Date.now()) return c.organizationId
  const snap = await getDb().collection('workspaces').doc(workspaceId).get()
  const organizationId = snap.exists ? (snap.data()?.organizationId ?? null) : null
  workspaceOrgCache.set(workspaceId, { organizationId, expiresAt: Date.now() + CACHE_TTL_MS })
  return organizationId
}

// org disabled status cache
interface CachedOrgStatus { disabled: boolean; expiresAt: number }
const orgStatusCache = new Map<string, CachedOrgStatus>()

async function isOrgDisabled(orgId: string): Promise<boolean> {
  const c = orgStatusCache.get(orgId)
  if (c && c.expiresAt > Date.now()) return c.disabled
  const snap = await getDb().collection('organizations').doc(orgId).get()
  const disabled = snap.exists ? (snap.data()?.disabled === true) : false
  orgStatusCache.set(orgId, { disabled, expiresAt: Date.now() + CACHE_TTL_MS })
  return disabled
}

export function invalidateOrgStatusCache(orgId: string) {
  orgStatusCache.delete(orgId)
}

// ── Super admin 判斷（Firebase custom claim）────────────────────────

export function isSuperAdmin(token: DecodedIdToken): boolean {
  return token['superAdmin'] === true
}

export async function requireSuperAdmin(event: H3Event) {
  const token = await verifyToken(event)
  if (!isSuperAdmin(token)) {
    throw createError({ statusCode: 403, statusMessage: 'Super admin only' })
  }
  return { uid: token.uid, token }
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

// ── Core: 查詢 workspaceMembers（UID-based）──────────────────────

export async function getWorkspaceMember(
  uid: string,
  workspaceId: string,
): Promise<WorkspaceMemberRole | null> {
  const cached = getCachedMember(uid, workspaceId)
  if (cached) return cached
  const snap = await getDb().collection('workspaceMembers').doc(`${uid}_${workspaceId}`).get()
  if (!snap.exists) return null
  const role = snap.data()!.role as WorkspaceMemberRole
  setCachedMember(uid, workspaceId, role)
  return role
}

// ── Core: 查詢 orgMembers（email-based）──────────────────────────
// 以 Firebase token 的 email 查詢，無需 UID，支援尚未建立帳號的情境

export async function getOrgMember(
  email: string,
  orgId: string,
): Promise<OrgMemberRole | null> {
  const cached = getCachedOrgMember(email, orgId)
  if (cached !== undefined) return cached

  const snap = await getDb().collection('orgMembers')
    .where('orgId', '==', orgId)
    .where('email', '==', email)
    .limit(1)
    .get()

  const role = snap.empty ? null : (snap.docs[0].data().role as OrgMemberRole)
  setCachedOrgMember(email, orgId, role)
  return role
}

// ── 解析 workspaceId from request ───────────────────────────────

async function resolveWorkspaceId(event: H3Event): Promise<string | null> {
  const params = event.context.params
  if (params?.workspaceId) return params.workspaceId
  const query = getQuery(event)
  if (query.workspaceId) return String(query.workspaceId)
  try {
    const body = await readBody(event)
    if (body?.workspaceId) return String(body.workspaceId)
  } catch { /* body might not exist or already consumed */ }
  return null
}

// ── Public API ────────────────────────────────────────────────────

export interface WorkspaceAuthContext {
  uid: string
  workspaceId: string
  role: WorkspaceMemberRole
  token: DecodedIdToken
  isSuperAdmin: boolean
  isOrgAdmin: boolean
}

/**
 * 驗證完整權限鏈：
 * Firebase token → workspaceId → workspace 成員角色 or org admin（email-based） → 組織停用檢查 → 最低角色比對
 *
 * 存取來源優先順序：
 *   1. Super admin（完全繞過）
 *   2. Workspace 直接成員（UID-based）
 *   3. Org admin（email-based，對組織內所有 workspace 享有 admin 級存取）
 */
export async function requireWorkspaceAccess(
  event: H3Event,
  minRole: WorkspaceMemberRole = 'viewer',
): Promise<WorkspaceAuthContext> {
  const token = await verifyToken(event)
  const uid = token.uid

  // Super admin：完全繞過，不受停用組織限制
  if (isSuperAdmin(token)) {
    const workspaceId = await resolveWorkspaceId(event) ?? ''
    return { uid, workspaceId, role: 'owner', token, isSuperAdmin: true, isOrgAdmin: false }
  }

  const workspaceId = await resolveWorkspaceId(event)
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspaceId is required' })
  }

  // 並行取得 workspace 成員角色 + org ID
  const [wsRole, orgId] = await Promise.all([
    getWorkspaceMember(uid, workspaceId),
    getWorkspaceOrgId(workspaceId),
  ])

  let role: WorkspaceMemberRole | null = wsRole
  let isOrgAdmin = false

  // 非 workspace 直接成員 → 改用 email 查 org admin（支援尚未建立帳號的邀請）
  if (!role && orgId && token.email) {
    const orgRole = await getOrgMember(token.email, orgId)
    if (orgRole === 'admin') {
      role = 'admin'
      isOrgAdmin = true
    }
  }

  if (!role) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: not a member of this workspace' })
  }

  // 組織停用檢查
  if (orgId && await isOrgDisabled(orgId)) {
    throw createError({ statusCode: 403, statusMessage: '此組織已停用，請聯繫系統管理員' })
  }

  if (ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
    throw createError({
      statusCode: 403,
      statusMessage: `Forbidden: requires at least '${minRole}' role`,
    })
  }

  return { uid, workspaceId, role, token, isSuperAdmin: false, isOrgAdmin }
}
