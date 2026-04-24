import { v4 as uuidv4 } from 'uuid'

/** 產生符合 leadCampaigns.campaignCode 規則（小寫英數與底線）的唯一代碼 */
export function generateLeadCampaignCode(): string {
  return `c_${uuidv4().replace(/-/g, '')}`
}
