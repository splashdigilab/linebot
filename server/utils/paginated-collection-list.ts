import type { Firestore, Query } from 'firebase-admin/firestore'
import { parseAdminListPagination, paginateArray } from '~~/server/utils/admin-pagination'

export type PaginatedListResult<T> = {
  items: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export function isPaginatedListQuery(query: Record<string, unknown>): boolean {
  return parseAdminListPagination(query).paginate
}

export function buildPaginatedListResult<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedListResult<T> {
  const offset = (page - 1) * limit
  return {
    items,
    total,
    page,
    limit,
    hasMore: offset + items.length < total,
  }
}

export function paginateInMemoryList<T>(
  items: T[],
  query: Record<string, unknown>,
): T[] | PaginatedListResult<T> {
  const { page, limit, offset, paginate } = parseAdminListPagination(query)
  if (!paginate) return items
  const slice = paginateArray(items, offset, limit)
  return buildPaginatedListResult(slice, page, limit, items.length)
}

export async function queryCollectionPage<T>(
  db: Firestore,
  buildQuery: (col: FirebaseFirestore.CollectionReference) => Query,
  collectionName: string,
  query: Record<string, unknown>,
  mapRow: (id: string, data: FirebaseFirestore.DocumentData) => T,
): Promise<T[] | PaginatedListResult<T>> {
  const { page, limit, offset, paginate } = parseAdminListPagination(query)

  const baseRef = buildQuery(db.collection(collectionName))

  if (!paginate) {
    const snap = await baseRef.get()
    return snap.docs.map(d => mapRow(d.id, d.data()))
  }

  const countSnap = await baseRef.count().get()
  const total = countSnap.data().count

  let pageRef = baseRef
  if (offset > 0) pageRef = pageRef.offset(offset)
  const pageSnap = await pageRef.limit(limit).get()
  const items = pageSnap.docs.map(d => mapRow(d.id, d.data()))

  return buildPaginatedListResult(items, page, limit, total)
}
