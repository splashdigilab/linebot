/**
 * Firestore `workspaces/{id}` 文件（預設 id：`default`）
 * 用於單一部署先存一組 LINE OA，之後可擴充多 workspace。
 */
export type LineWorkspaceDoc = {
  name?: string
  channelAccessToken?: string
  channelSecret?: string
  /** 活動未填 liffId 時可 fallback（選填） */
  defaultLiffId?: string
  /** 所屬組織 ID（選填；未設定時為獨立 workspace） */
  organizationId?: string
  updatedAt?: unknown
}

export const DEFAULT_LINE_WORKSPACE_ID = 'default'
