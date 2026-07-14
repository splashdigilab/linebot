import { getDb } from '~~/server/utils/firebase'
import { requireWorkspaceAccess } from '~~/server/utils/workspace-auth'
import type { InvoiceProfile, WorkspaceDoc } from '~~/shared/types/organization'

/** GET /api/payment/invoice-profile — 讀回發票開立資訊，供帳單頁的表單帶入。 */
export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireWorkspaceAccess(event, 'admin')
  const snap = await getDb().collection('workspaces').doc(workspaceId).get()
  const profile: InvoiceProfile = (snap.exists ? (snap.data() as WorkspaceDoc).invoiceProfile : null) ?? {}
  return { profile }
})
