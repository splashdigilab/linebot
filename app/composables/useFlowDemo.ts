/**
 * 教學 agent ↔ 機器人模組頁的「示範」橋接。
 *
 * 「認識回覆訊息類型」這個 tour 想直接把每種訊息卡片打開給使用者看怎麼填，
 * 但卡片只在編輯器裡才有。為了不靠 DOM 亂點（刪卡會有確認框、很脆），改用這個
 * 共享狀態：tour 設定要示範哪一種訊息，flow 頁監看後在「只屬於示範的空白草稿」裡
 * 放一張那種卡（絕不動到既有/真實模組）；下一步換一種、結束時清掉。
 */
export function useFlowDemo() {
  // 目前要示範的訊息類型（null = 沒有在示範）
  const demoType = useState<string | null>('flow-demo-type', () => null)
  // 每次 set/clear 都遞增，確保「設同一個類型」也會觸發 flow 頁重放（否則 Vue 對相同值不觸發 watch）
  const demoNonce = useState('flow-demo-nonce', () => 0)

  function setDemo(type: string) {
    demoType.value = type
    demoNonce.value++
  }
  function clearDemo() {
    demoType.value = null
    demoNonce.value++
  }

  return { demoType, demoNonce, setDemo, clearDemo }
}
