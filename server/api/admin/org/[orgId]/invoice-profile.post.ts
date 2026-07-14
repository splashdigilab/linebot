import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from '~~/server/utils/firebase'
import { requireOrgAdmin } from '~~/server/utils/workspace-auth'
import { normalizeInvoiceProfile } from '~~/server/utils/ezpay-invoice'

/**
 * POST /api/admin/org/:orgId/invoice-profile — 組織層級的發票資訊（**預設值**）。
 *
 * 統一編號與公司抬頭幾乎一定是組織層級的東西：一家公司開 3 個官方帳號，
 * 不會想填 3 次統編。所以填一次在這裡，底下所有 OA 自動沿用；
 * 個別 OA 要開不同抬頭時才去帳單頁覆寫。
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  await requireOrgAdmin(event, orgId)
  const profile = normalizeInvoiceProfile(await readBody(event))

  await getDb().collection('organizations').doc(orgId).update({
    invoiceProfile: profile,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { ok: true, profile }
})
