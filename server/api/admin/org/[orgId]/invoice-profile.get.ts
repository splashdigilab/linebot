import { getDb } from '~~/server/utils/firebase'
import { requireOrgAdmin } from '~~/server/utils/workspace-auth'
import type { InvoiceProfile, OrganizationDoc } from '~~/shared/types/organization'

/** GET /api/admin/org/:orgId/invoice-profile — 讀回組織層級的發票資訊。 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.params?.orgId
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId is required' })

  await requireOrgAdmin(event, orgId)

  const snap = await getDb().collection('organizations').doc(orgId).get()
  if (!snap.exists) throw createError({ statusCode: 404, statusMessage: '找不到此組織' })

  const profile: InvoiceProfile = (snap.data() as OrganizationDoc).invoiceProfile ?? {}
  return { profile }
})
