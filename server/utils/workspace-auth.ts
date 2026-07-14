import type { H3Event } from 'h3'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import type { WorkspaceMemberRole, OrgMemberRole } from '~~/shared/types/organization'
import type { Capability } from '~~/shared/permissions'
import { ROLE_LEVEL, CAPABILITIES } from '~~/shared/permissions'
import { getFirebaseAuth, getDb } from './firebase'
import { capMapSize } from './bounded-cache'

// 以 uid / email 為 key 的快取會隨用戶數成長，設上限防無上限增長
const AUTH_CACHE_MAX_ENTRIES = 2000

// 角色層級與能力對照表為權限單一事實來源，見 ~~/shared/permissions.ts

// ── In-memory caches ────────────────────────────────────────────────
// 注意：serverless 多實例下 invalidate 只作用於單一實例，其他實例要等 TTL 過期。
// 角色／成員資格是安全邊界，TTL 收緊到 15s 縮短「移除成員後仍可存取」的空窗；
// workspace→org 對應與 org 停用狀態變動頻率低，維持 60s。

const CACHE_TTL_MS = 60_000
const MEMBER_CACHE_TTL_MS = 15_000

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
  memberCache.set(`${uid}:${workspaceId}`, { role, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS })
  capMapSize(memberCache, AUTH_CACHE_MAX_ENTRIES)
}

export function invalidateWorkspaceMemberCache(uid: string, workspaceId: string) {
  memberCache.delete(`${uid}:${workspaceId}`)
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
  orgMemberCache.set(`org:${email}:${orgId}`, { role, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS })
  capMapSize(orgMemberCache, AUTH_CACHE_MAX_ENTRIES)
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

/**
 * 組織層權限守衛（email-based）：super admin 直接放行，否則需為該 org 的 orgMembers.admin。
 * 用於「建立官方帳號 / 查組織配額」等組織級操作——這類操作跨越單一 workspace，
 * 不走 requireWorkspaceAccess。組織停用檢查交由呼叫端視情況處理。
 */
export async function requireOrgAdmin(event: H3Event, orgId: string) {
  const token = await verifyToken(event)
  if (isSuperAdmin(token)) {
    return { uid: token.uid, email: token.email?.trim().toLowerCase() ?? null, token, isSuperAdmin: true }
  }
  const email = token.email?.trim().toLowerCase()
  if (!email || await getOrgMember(email, orgId) !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '你不是此組織的管理員' })
  }
  return { uid: token.uid, email, token, isSuperAdmin: false }
}

/**
 * requireOrgAdmin + **組織必須是啟用中**。組織後台的每一支端點都該用這個。
 *
 * `requireOrgAdmin` 刻意不檢查停用（有些流程需要在停用狀態下仍能讀），但那意味著
 * 每個呼叫端都得自己記得檢查——而「忘記檢查」的後果是：組織因為欠費 / 濫用被停用之後，
 * 它的管理員照樣讀得到帳務、改得動發票抬頭、刪得掉其他管理員。停用等於沒停。
 * 所以把「停用即擋」收斂成一個函式，不要散在每支端點裡靠人記得。
 *
 * super admin 不受限（他就是去處理被停用的組織的人）。
 */
export async function requireActiveOrgAdmin(event: H3Event, orgId: string) {
  const ctx = await requireOrgAdmin(event, orgId)
  if (!ctx.isSuperAdmin && await isOrgDisabled(orgId)) {
    throw createError({ statusCode: 403, statusMessage: '此組織已停用，請聯繫客服' })
  }
  return ctx
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

/**
 * 若有 email 對應的 workspaceInvites，建立 workspaceMembers 並刪除邀請（與 orgMembers 邀請模式一致）。
 */
export async function materializeWorkspaceInviteIfAny(
  uid: string,
  emailNormalized: string,
  workspaceId: string,
): Promise<WorkspaceMemberRole | null> {
  const db = getDb()
  const invites = await db.collection('workspaceInvites')
    .where('workspaceId', '==', workspaceId)
    .where('email', '==', emailNormalized)
    .limit(1)
    .get()

  const invDoc = invites.docs[0]
  if (!invDoc) return null
  const inv = invDoc.data()
  const role = inv.role as WorkspaceMemberRole
  const memberRef = db.collection('workspaceMembers').doc(`${uid}_${workspaceId}`)
  const existingMember = await memberRef.get()
  if (existingMember.exists) {
    await invDoc.ref.delete()
    invalidateWorkspaceMemberCache(uid, workspaceId)
    return existingMember.data()!.role as WorkspaceMemberRole
  }

  const organizationIdFromInv = inv.organizationId as string | null | undefined
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get()
  const organizationId = organizationIdFromInv !== undefined && organizationIdFromInv !== null
    ? organizationIdFromInv
    : (wsSnap.data()?.organizationId ?? null)

  await db.runTransaction(async (tx) => {
    const mSnap = await tx.get(memberRef)
    if (mSnap.exists) {
      tx.delete(invDoc.ref)
      return
    }
    tx.set(memberRef, {
      uid,
      workspaceId,
      organizationId,
      role,
      invitedBy: (inv.invitedBy as string) ?? null,
      invitedEmail: emailNormalized,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.delete(invDoc.ref)
  })

  invalidateWorkspaceMemberCache(uid, workspaceId)
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

  const role = (snap.docs[0]?.data()?.role as OrgMemberRole | undefined) ?? null
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

  // 非 workspace 直接成員 → 改用 email 查 org admin（組織管理員可存取組織內全部 workspace）
  // orgMembers 的 email 一律以小寫正規化儲存，查詢也要正規化，否則大小寫不符會漏查
  if (!role && orgId && token.email) {
    const orgRole = await getOrgMember(token.email.trim().toLowerCase(), orgId)
    if (orgRole === 'admin') {
      role = 'admin'
      isOrgAdmin = true
    }
  }

  // 再以 email 邀請（workspaceInvites）轉成正式成員（對方註冊 Firebase 後首次存取即生效）
  if (!role && token.email) {
    const emailNorm = token.email.trim().toLowerCase()
    role = await materializeWorkspaceInviteIfAny(uid, emailNorm, workspaceId)
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
      statusMessage: ROLE_DENIED_MESSAGE[minRole],
    })
  }

  return { uid, workspaceId, role, token, isSuperAdmin: false, isOrgAdmin }
}

// 角色不足時回給前端的人性化訊息（保底：正常情況 UI 已依角色隱藏，不該按到）
const ROLE_DENIED_MESSAGE: Record<WorkspaceMemberRole, string> = {
  viewer: '此操作需要成員權限',
  agent: '此操作需要客服（含）以上權限',
  admin: '此操作需要管理員權限',
  owner: '此操作需要擁有者權限',
}

/**
 * 以「能力」為單位的權限守衛，門檻由 ~~/shared/permissions.ts 的 CAPABILITIES 決定。
 * 前端 can() 與此處讀同一張表，確保「看得到＝改得動」。
 */
export async function requireCapability(
  event: H3Event,
  capability: Capability,
): Promise<WorkspaceAuthContext> {
  return requireWorkspaceAccess(event, CAPABILITIES[capability])
}
