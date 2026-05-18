export const ADMIN_LIST_DEFAULT_LIMIT = 50
export const ADMIN_LIST_MAX_LIMIT = 100

export type AdminListPagination = {
  page: number
  limit: number
  offset: number
  /** 是否為分頁模式（有帶 page 或 limit） */
  paginate: boolean
}

export function parseAdminListPagination(
  query: Record<string, unknown>,
  defaults?: { limit?: number },
): AdminListPagination {
  const hasPage = query.page !== undefined && query.page !== null && String(query.page) !== ''
  const hasLimit = query.limit !== undefined && query.limit !== null && String(query.limit) !== ''
  const paginate = hasPage || hasLimit

  const page = Math.max(1, Number(query.page) || 1)
  const defaultLimit = defaults?.limit ?? ADMIN_LIST_DEFAULT_LIMIT
  const limit = Math.min(
    ADMIN_LIST_MAX_LIMIT,
    Math.max(1, Number(query.limit) || defaultLimit),
  )
  const offset = (page - 1) * limit

  return { page, limit, offset, paginate }
}

export function paginateArray<T>(items: T[], offset: number, limit: number): T[] {
  return items.slice(offset, offset + limit)
}
