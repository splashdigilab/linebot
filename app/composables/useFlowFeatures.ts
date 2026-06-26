/**
 * 機器人模組「訊息類型」的可用性開關（單一真相來源）。
 *
 * 目前是固定值（沿用原本 flow.vue 的寫死常數）；抽出來是為了讓「教學 agent」能據此
 * 隱藏不可用功能的教學（例如關掉 showUserInput，「用戶輸入卡怎麼填」就自動消失）。
 * 之後若要做成 per-workspace，只要在這裡改成讀 workspace/aiSettings 即可，flow 頁與教學會一起生效。
 */
export function useFlowFeatures() {
  return {
    showUserInput: true,
    showUserInputAttribute: false,
    showLegacyImageCarousel: true,
    showLegacyCarousel: false,
  }
}
