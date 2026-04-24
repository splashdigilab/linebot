import { getLineWorkspaceCredentials } from '~~/server/utils/line-workspace-credentials'

export default defineEventHandler(async () => {
  const { defaultLiffId } = await getLineWorkspaceCredentials()
  return { liffId: defaultLiffId }
})
