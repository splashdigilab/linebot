/**
 * 新手教學 agent 狀態 + 教學內容。
 *
 * 模式：右下角常駐一顆 agent 按鈕，點開像聊天視窗，agent 拋出幾個主題按鈕；
 * 選了主題後，先導航到對應頁面，再用 Element Plus 的 el-tour 逐步高亮真實畫面元素。
 *
 * 跨頁做法：每個主題在開跑前先 router.push 到該頁，等目標元素出現再開 tour，
 * 因此整段導覽的 target 都落在「同一頁」（側欄在所有 admin 頁都在，可一併高亮），
 * 避免 tour 進行到一半換路由造成 target 找不到。
 */

export interface TutorialStep {
  /** CSS selector，對準頁面上標了 data-tour 的元素；留空字串＝置中說明卡（不高亮） */
  target: string
  /** 顯示這步之前，先點一下這個 selector 的元素（例如先進入新增模式，編輯區才會出現） */
  clickBefore?: string
  /** 在機器人模組頁示範這種訊息卡（會在示範草稿裡放一張該類型的卡，下一步自動換掉） */
  demoType?: string
  title: string
  /** 支援簡單 HTML（會以 v-html 呈現） */
  description: string
  placement?:
    | 'top' | 'top-start' | 'top-end'
    | 'bottom' | 'bottom-start' | 'bottom-end'
    | 'left' | 'left-start' | 'left-end'
    | 'right' | 'right-start' | 'right-end'
  /** 該步驟內附「帶我做這項」按鈕時，要啟動的教學主題 id（給缺項巡覽用） */
  actionTopicId?: string
  /** 此步驟依賴的功能旗標（關閉時整步跳過），對應 useFlowFeatures 的開關 */
  requiresFeature?: string
}

export interface TutorialTopic {
  id: string
  icon: string
  label: string
  /** agent 點此主題後說的話 */
  blurb: string
  /** 導覽開跑前要導航到的路由（吃 workspaceId） */
  route?: (workspaceId: string) => string
  /** 需要 owner/admin（設定類：組織、成員、AI 設定、腳本）才顯示 */
  requiresSettings?: boolean
  /** 需要操作權限（agent 以上，排除觀察者）的建立/編輯類教學才顯示 */
  requiresOperate?: boolean
  /** 依賴的功能旗標（關閉時整個教學隱藏），對應 useFlowFeatures 的開關 */
  requiresFeature?: string
  steps: TutorialStep[]
}

/** 目前提供的教學主題。要新增教學，往這個陣列加一筆即可。 */
function buildTopics(): TutorialTopic[] {
  return [
    {
      id: 'organization',
      icon: '🏢',
      label: '設定組織與 LINE',
      blurb:
        '我帶你把 LINE 官方帳號接上系統，總共 8 步。準備好就開始，過程中可以隨時點「結束」離開。',
      requiresSettings: true,
      route: wid => `/admin/${wid}/settings/organization`,
      steps: [
        {
          target: '[data-tour="nav-organization"]',
          title: '第 1 步：這裡是入口',
          description:
            '左側選單的 <strong>設定 → 組織與 LINE</strong> 就是這頁。之後要改 LINE 憑證、Webhook，都從這裡進來。',
          placement: 'right',
        },
        {
          target: '[data-tour="org-identity"]',
          title: '第 2 步：先確認身分',
          description:
            '這張卡顯示你的<strong>組織名稱、官方帳號名稱</strong>，以及<strong>你的角色</strong>。只有「擁有者／管理員」能改這頁設定。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="org-liff"]',
          title: '第 3 步：填預設 LIFF（必填）',
          description:
            '先到 <strong>LINE Developers</strong> 建一個 LIFF App，把它的 LIFF ID 貼進來（例：2007123456-AbCdEfGh）。LIFF 的 Endpoint URL 要設成下方「活動 LIFF 頁」，<strong>不要</strong>填 Webhook 路徑。',
          placement: 'top',
        },
        {
          target: '[data-tour="org-token"]',
          title: '第 4 步：貼 Channel Access Token',
          description:
            '到 <strong>LINE Developers → Messaging API</strong> 複製 Channel Access Token，貼進這欄。存過之後會以黑點隱藏，點黑點可重新輸入。',
          placement: 'top',
        },
        {
          target: '[data-tour="org-secret"]',
          title: '第 5 步：貼 Channel Secret',
          description:
            '同一個 channel 的 <strong>Channel Secret</strong> 貼這裡。<strong>一定要跟 LINE 後台同一組</strong>，填錯的話 LINE 會拒絕連線、機器人就收不到客人訊息。',
          placement: 'top',
        },
        {
          target: '[data-tour="org-webhook"]',
          title: '第 6 步：把 Webhook 網址貼回 LINE',
          description:
            '點「複製」拿到這串網址，貼到 <strong>LINE Developers → Messaging API → Webhook URL</strong>，並把 Webhook 設為啟用。',
          placement: 'top',
        },
        {
          target: '[data-tour="org-verify"]',
          title: '第 7 步：測試有沒有通',
          description:
            '按「<strong>測試連線</strong>」用現在的 Token 問 LINE，確認網站連得到、驗簽過。測試有額度，別狂按。',
          placement: 'top',
        },
        {
          target: '[data-tour="org-save"]',
          title: '第 8 步：儲存',
          description:
            '最後按右上角「<strong>儲存</strong>」。系統會順手再驗一次 Webhook。看到成功提示就完成囉 🎉',
          placement: 'bottom-end',
        },
      ],
    },
    {
      id: 'ai-settings',
      requiresSettings: true,
      icon: '🤖',
      label: '開啟 AI 自動回覆',
      blurb: '我帶你把 AI 客服打開、選好回覆模式與語氣，共 3 步。',
      route: wid => `/admin/${wid}/ai-settings`,
      steps: [
        {
          target: '[data-tour="ais-toggle"]',
          title: '第 1 步：打開總開關',
          description:
            '先把「<strong>啟用 AI 自動回覆</strong>」打開——關著的話，知識庫和腳本都不會生效。下面的「回覆模式」<strong>新導入建議先選「草稿」</strong>跑一兩週：AI 只給客服建議、不直接回客人，穩了再切「全自動」。',
          placement: 'right',
        },
        {
          target: '[data-tour="ais-style"]',
          title: '第 2 步：調回答風格',
          description:
            '在這裡設定 AI 的<strong>語氣與人設</strong>，讓它講話像你們品牌。可以直接套用預設風格，或自己微調。',
          placement: 'right',
        },
        {
          target: '[data-tour="ais-save"]',
          title: '第 3 步：儲存設定',
          description: '改完一定要按右上「<strong>儲存設定</strong>」才會生效 🎉',
          placement: 'bottom-end',
        },
      ],
    },
    {
      id: 'knowledge',
      requiresOperate: true,
      icon: '📚',
      label: '知識庫：建立與匯入',
      blurb: '我帶你看怎麼把知識餵給 AI，四種來源一次搞懂，共 7 步。',
      route: wid => `/admin/${wid}/knowledge/sources`,
      steps: [
        {
          target: '[data-tour="kb-import"]',
          title: '第 1 步：從「匯入」開始',
          description:
            '知識庫是由一份份「<strong>來源</strong>」組成的，AI 只會用這些來源裡的內容回答。點「<strong>📥 匯入</strong>」開始——有 <strong>4 種餵料方式</strong>，我一個一個帶你看。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-tab-file"]',
          clickBefore: '[data-tour="kb-import"]',
          title: '方式 1：上傳檔案（PDF、Excel）',
          description:
            '把現成的檔案丟進來（單檔 10MB 內）。<br><strong>Excel 表格</strong>：跟 Google Sheet 一樣「<strong>一列變成一張卡</strong>」——第一欄當卡片標題、其餘欄位當內容。商品表、問答表最適合。<br><strong>PDF 或內容零散的檔案</strong>：由 AI 幫你分段（用拍的、掃的檔案會由 AI 認字，記得核對數字、價格）。<br>提醒：檔案<strong>上傳一次就固定</strong>，之後改了要重傳；想「改了自動更新」請用 Google Sheet。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-tab-url"]',
          clickBefore: '[data-tour="kb-tab-url"]',
          title: '方式 2：貼網址',
          description:
            '貼一個網頁網址，系統會抓網頁上的<strong>文字</strong>做成卡片。如果抓不到（例如那個網頁要先登入、或要按按鈕才會顯示內容），就改用上傳檔案。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-tab-gsheet"]',
          clickBefore: '[data-tour="kb-tab-gsheet"]',
          title: '方式 3：Google Sheet（會自動同步）',
          description:
            '最適合「常常在改」的資料（商品、價目表）。規則是<strong>一列一張卡</strong>：<strong>第一欄當卡片標題</strong>，其餘欄位當內容。所以第一欄要放「看得懂的名字」（例：商品名），<strong>不要放編號</strong>。記得先把 Sheet <strong>分享給畫面上那個服務帳號</strong>，之後改內容會定期自動同步（你手動改過的卡不會被蓋掉）。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-tab-text"]',
          clickBefore: '[data-tour="kb-tab-text"]',
          title: '方式 4：貼整段文字',
          description:
            '手邊只有一段文字（FAQ、政策原文）就貼這裡，<strong>AI 幫你切成多張卡</strong>。最快、不用準備檔案。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-overview"]',
          clickBefore: '[data-tour="kb-tab-file"]',
          title: '列表頁記得勾「總覽卡」',
          description:
            '如果這份是<strong>商品型錄 / 列表頁</strong>，勾這個會多做一張「總覽卡」，客人問「你們有賣什麼」時 AI 能一次答完，不會被一項項問倒。（Google Sheet 免勾。）',
          placement: 'top',
        },
        {
          target: '[data-tour="kb-preview"]',
          title: '最後：預覽切卡再匯入',
          description:
            '選好來源後按這裡，AI 會先<strong>切好卡片給你預覽</strong>。你可以逐張改標題／內容、取消不要的，確認沒問題再匯入——<strong>不會直接上線亂答</strong>。',
          placement: 'top',
        },
      ],
    },
    {
      id: 'knowledge-manage',
      requiresOperate: true,
      icon: '🗂️',
      label: '知識庫：整理與更新',
      blurb: '匯入之後，怎麼分類、微調、讓知識自動保持最新，我帶你看一遍，共 4 步。',
      route: wid => `/admin/${wid}/knowledge/sources`,
      steps: [
        {
          target: '[data-tour="kb-sources"]',
          title: '第 1 步：匯入的知識都在這裡管理',
          description:
            '你匯入的每一份資料，都會變成一筆「<strong>來源</strong>」列在這份清單。<strong>點一份</strong>進去，右邊就能看它的內容、改東西、或設定更新。這一頁就是你日後照顧知識庫的地方。',
          placement: 'right',
        },
        {
          target: '[data-tour="kb-folder-new"]',
          title: '第 2 步：來源變多了，用資料夾分類',
          description:
            '來源一多就會找不到。點「<strong>📂</strong>」開資料夾（例如：商品、退換貨、活動），再把來源<strong>拖進去</strong>歸類。這只是後台整理方便你找，不影響 AI 回答。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="kb-chunks"]',
          title: '第 3 步：AI 把資料切成一張張「卡片」，你能微調',
          description:
            '每份來源會被拆成一張張「<strong>卡片</strong>」，AI 就是一張卡一張卡地找答案。覺得哪張不對，按「<strong>✏️ 編輯</strong>」改標題和內容，或用「<strong>AI 整理一下</strong>」讓它更好被找到。<strong>你親手改過的卡會標上 🔒</strong>，日後自動更新時不會被蓋掉，可以放心改。',
          placement: 'left',
        },
        {
          target: '[data-tour="kb-sync-settings"]',
          title: '第 4 步：原始資料改了，知識會自動跟上',
          description:
            '從<strong>網址</strong>或 <strong>Google Sheet</strong> 來的知識，萬一原始網頁 / 表格改了怎麼辦？系統會<strong>定期自動重讀</strong>（多久讀一次可以自己設）。你也能隨時在該來源右上按「<strong>重新同步</strong>」，它會先<strong>列出哪裡不一樣</strong>、讓你確認後再套用——<strong>不會偷偷覆蓋</strong>你的知識庫。（用檔案、手打文字建立的來源不會自動更新，改了要重新匯入。）',
          placement: 'left',
        },
      ],
    },
    {
      id: 'ai-scripts',
      requiresSettings: true,
      icon: '🧩',
      label: '建立客服腳本',
      blurb: '腳本用來把多步驟流程自動化（預約、報名…）。我帶你開第一條，共 2 步。',
      route: wid => `/admin/${wid}/ai-scripts`,
      steps: [
        {
          target: '[data-tour="scr-new"]',
          title: '第 1 步：新增一條腳本',
          description:
            '腳本能把固定流程自動化，例如<strong>預約、報名、領優惠</strong>。點「<strong>➕ 新增</strong>」開一條新的。',
          placement: 'right',
        },
        {
          target: '[data-tour="scr-templates"]',
          title: '第 2 步：從範本開始最快',
          description:
            '不知道怎麼開始？挑一個<strong>範本</strong>，系統幫你把流程骨架建好再改。建立後記得把狀態切成「<strong>啟用</strong>」才會對客人生效。',
          placement: 'top',
        },
      ],
    },
    {
      id: 'ai-playground',
      icon: '🎮',
      label: '試一下 AI 怎麼回答',
      blurb: '上線前先在這裡試答幾題，確認 AI 答得對，共 2 步。',
      route: wid => `/admin/${wid}/ai-playground`,
      steps: [
        {
          target: '[data-tour="pg-chat"]',
          title: '第 1 步：這是試答模式',
          description:
            '在這裡用「真實 LINE 對話」的方式測 AI，<strong>不會影響正式對話</strong>。遇到模糊問題它會反問、出選項，你可以點來模擬客人回答。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="pg-composer"]',
          title: '第 2 步：輸入問題試答',
          description:
            '在這裡打客人可能會問的問題，按「<strong>🚀 送出</strong>」看 AI 怎麼答。多試幾題刁鑽的；確認答得穩，再到 AI 設定切「全自動」上線。',
          placement: 'top',
        },
      ],
    },
    {
      id: 'conversations',
      icon: '💬',
      label: '看懂對話收件匣',
      blurb: '帶你看客人對話怎麼進來、怎麼接手回覆，共 2 步。',
      route: wid => `/admin/${wid}/conversations`,
      steps: [
        {
          target: '[data-tour="conv-list"]',
          title: '第 1 步：對話都在左邊',
          description:
            '客人傳來的訊息會列在左邊這份清單，<strong>點一個</strong>就能看完整紀錄、直接回覆。',
          placement: 'right',
        },
        {
          target: '[data-tour="conv-tabs"]',
          title: '第 2 步：用狀態分頁分流',
          description:
            '這排分頁幫你分流：<strong>待處理</strong>是 AI 轉真人、等你接手的；接手後在<strong>處理中</strong>；談完按「結束會話」。要接手客人就先看「待處理」。',
          placement: 'right',
        },
      ],
    },
    {
      id: 'flow',
      requiresOperate: true,
      icon: '🤖',
      label: '認識機器人模組',
      blurb: '一種一種帶你看：每介紹一個就先幫你選到它的實際畫面，共 6 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="flow-title"]',
          title: '第 1 步：模組是「要回什麼」的積木',
          description:
            '一個模組 = 一組要回給客人的訊息。上面兩個是<strong>系統模組</strong>（🔒，一定在、不能刪），下面是你自己加的。接下來我一個一個帶你看 👇',
          placement: 'right',
        },
        {
          target: '[data-tour="flow-type"]',
          clickBefore: '[data-tour="flow-sys-welcome"]',
          title: '① 歡迎模組 🔒',
          description:
            '我幫你選到「<strong>歡迎模組</strong>」了。它在客人<strong>加好友的當下</strong>自動發第一組訊息——通常放品牌介紹、優惠或常見問答入口。系統內建，你只要編內容。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="flow-type"]',
          clickBefore: '[data-tour="flow-sys-live_agent"]',
          title: '② 真人客服 🔒',
          description:
            '這是「<strong>真人客服</strong>」模組。當對話<strong>轉給真人</strong>時會發這組訊息——例如「已為您轉接專人，請稍候」。一樣系統內建，編好內容即可。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="flow-type"]',
          clickBefore: '[data-tour="flow-new"]',
          title: '③ + ④ 你自己加的兩種',
          description:
            '我幫你按了「➕」進入新增。你能建的有兩種，在這裡選：<strong>機器人流程</strong>（一般自動回覆，最常用）、<strong>系統通知</strong>（公告型訊息）。先取個名再選類型。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="flow-messages"]',
          title: '第 5 步：加要回的訊息',
          description:
            '不管哪種模組，內容都在這排按鈕加：點一下就多一則回覆，想回幾則都行。<strong>每種訊息怎麼填</strong>，主選單有「基本訊息」和各種訊息類型的專屬教學可以跑。',
          placement: 'bottom',
        },
        {
          target: '',
          title: '第 6 步：什麼時候會回？',
          description:
            '模組只管「<strong>回什麼</strong>」；「<strong>什麼時候回</strong>」要另外綁：到「<strong>自動回覆</strong>」用關鍵字指向這個模組（歡迎模組例外，加好友時自動發）。編好按右上「<strong>建立／儲存</strong>」就生效 🎉',
        },
      ],
    },
    {
      id: 'msg-basic',
      requiresOperate: true,
      icon: '💬',
      label: '基本訊息（文字/圖片/影片）',
      blurb: '最常用的三種訊息，我一顆一顆按給你看、卡片也開出來，共 3 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="fmt-text"]',
          demoType: 'text',
          title: '📝 文字',
          description:
            '點「<strong>＋ 文字</strong>」加一則純文字（可放表情符號、自動帶入客人暱稱，文字下還能加按鈕）。下方就是它的卡片。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="fmt-image"]',
          demoType: 'image',
          title: '🖼️ 圖片',
          description:
            '點「<strong>＋ 圖片</strong>」加一張圖，上傳即可（海報、菜單、活動圖），系統自動處理預覽。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="fmt-video"]',
          demoType: 'video',
          title: '🎬 影片',
          description:
            '點「<strong>＋ 影片</strong>」加一段影片，再給一張預覽縮圖，客人按了才播放。',
          placement: 'bottom',
        },
      ],
    },
    {
      id: 'msg-rich',
      requiresOperate: true,
      icon: '📰',
      label: '圖文訊息怎麼填',
      blurb: '一張大圖切成多個可點區塊。我打開一張卡帶你填，共 3 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="fmt-rich"]',
          demoType: 'richMessage',
          title: '📰 圖文訊息',
          description:
            '點「<strong>＋ 圖文訊息</strong>」這顆就會加一張。我幫你開好了，往下教你填每個欄位 →',
          placement: 'bottom',
        },
        {
          target: '[data-tour="rich-layout"]',
          demoType: 'richMessage',
          title: '📰 圖文訊息：① 選版型',
          description:
            '圖文訊息是一張大圖、切成多個<strong>可點區塊</strong>。先選一個<strong>版型</strong>，決定要切成幾塊。',
          placement: 'top',
        },
        {
          target: '[data-tour="rich-hero"]',
          demoType: 'richMessage',
          title: '📰 圖文訊息：② 上傳大圖 + 綁動作',
          description:
            '在這裡上傳底圖。<strong>上傳後</strong>，圖上每個區塊就能各自綁一個動作（開網址、觸發模組、傳訊息…）——這是圖文訊息最強的地方。',
          placement: 'top',
        },
      ],
    },
    {
      id: 'msg-carousel',
      requiresOperate: true,
      icon: '🎠',
      label: '輪播訊息怎麼填',
      blurb: '多張卡片左右滑。我打開一張帶你填，共 4 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="fmt-carousel"]',
          demoType: 'flexImageCarousel',
          title: '🎠 輪播訊息',
          description:
            '點「<strong>＋ 輪播訊息</strong>」這顆就會加一張。我幫你開好了，往下教你填每個欄位 →',
          placement: 'bottom',
        },
        {
          target: '[data-tour="flex-enable-image"]',
          demoType: 'flexImageCarousel',
          title: '🎠 輪播訊息：① 要不要放圖',
          description:
            '輪播訊息是多張卡片可<strong>左右滑</strong>。先決定每張卡<strong>要不要放圖片</strong>（開了就能上傳圖、設比例）。',
          placement: 'top',
        },
        {
          target: '[data-tour="flex-col-title"]',
          demoType: 'flexImageCarousel',
          title: '🎠 輪播訊息：② 填卡片內容',
          description:
            '每張卡填<strong>標題、內文</strong>；若有開圖還能上傳圖片、加最多 3 顆<strong>按鈕</strong>。',
          placement: 'top',
        },
        {
          target: '[data-tour="flex-add-column"]',
          demoType: 'flexImageCarousel',
          title: '🎠 輪播訊息：③ 多加幾張卡',
          description:
            '按這顆「＋」就多一張卡，客人在聊天室能<strong>左右滑</strong>看更多。商品、方案並排介紹最好用。',
          placement: 'left',
        },
      ],
    },
    {
      id: 'msg-quick',
      requiresOperate: true,
      icon: '⚡',
      label: '快速回覆怎麼填',
      blurb: '訊息下方一排建議按鈕。我打開一張帶你填，共 4 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="fmt-quick"]',
          demoType: 'quickReply',
          title: '⚡ 快速回覆',
          description:
            '點「<strong>＋ 快速回覆</strong>」這顆就會加一張。我幫你開好了，往下教你填每個欄位 →',
          placement: 'bottom',
        },
        {
          target: '[data-tour="quick-prompt"]',
          demoType: 'quickReply',
          title: '⚡ 快速回覆：① 主要文字',
          description:
            '快速回覆是在訊息<strong>下方冒出一排建議按鈕</strong>。先在這裡打主要的回覆文字。',
          placement: 'top',
        },
        {
          target: '[data-tour="quick-button"]',
          demoType: 'quickReply',
          title: '⚡ 快速回覆：② 每顆按鈕',
          description:
            '一顆按鈕 = 一個建議選項：設<strong>顯示文字</strong>、選客人點了要做什麼（回傳訊息／開網址／觸發模組）。',
          placement: 'top',
        },
        {
          target: '[data-tour="quick-add"]',
          demoType: 'quickReply',
          title: '⚡ 快速回覆：③ 加更多選項',
          description: '要更多選項就按這顆「＋」加一顆按鈕（最多 13 顆）。',
          placement: 'left',
        },
      ],
    },
    {
      id: 'msg-userinput',
      requiresOperate: true,
      requiresFeature: 'userInput',
      icon: '✍️',
      label: '用戶輸入卡怎麼填',
      blurb: '問問題、收答案、還能觸發下一步。我打開一張帶你填，共 4 步。',
      route: wid => `/admin/${wid}/flow`,
      steps: [
        {
          target: '[data-tour="fmt-userinput"]',
          demoType: 'userInput',
          title: '✍️ 用戶輸入卡',
          description:
            '點「<strong>＋ 用戶輸入</strong>」這顆就會加一張。我幫你開好了，往下教你填每個欄位 →',
          placement: 'bottom',
        },
        {
          target: '[data-tour="ui-question"]',
          demoType: 'userInput',
          title: '✍️ 用戶輸入卡：① 提問',
          description:
            '用戶輸入卡能<strong>問客人問題、收答案</strong>。先在這裡打你要問的問題。',
          placement: 'top',
        },
        {
          target: '[data-tour="ui-attribute"]',
          demoType: 'userInput',
          requiresFeature: 'userInputAttribute',
          title: '✍️ 用戶輸入卡：② 存成屬性（特殊）',
          description:
            '把客人的回答<strong>存成一個屬性</strong>（例：phone、email）。存了之後，其他地方就能帶入這個值重複使用。',
          placement: 'top',
        },
        {
          target: '[data-tour="ui-next-module"]',
          demoType: 'userInput',
          title: '✍️ 用戶輸入卡：③ 觸發下一步（特殊）',
          description:
            '客人回答後，<strong>自動接著跑哪個模組</strong>——這就是把多步驟串成流程的關鍵，做表單、預約都靠它。看完囉，按「結束」我會幫你把示範草稿清掉。',
          placement: 'top',
        },
      ],
    },
    {
      id: 'auto-reply',
      requiresOperate: true,
      icon: '⚡',
      label: '設定自動回覆',
      blurb: '關鍵字一命中就自動回。我帶你建第一條，共 2 步。',
      route: wid => `/admin/${wid}/auto-reply`,
      steps: [
        {
          target: '[data-tour="ar-title"]',
          title: '第 1 步：什麼是自動回覆',
          description:
            '自動回覆讓客人訊息<strong>一命中關鍵字</strong>就立刻自動回覆——適合常見問答、營業時間、地址這類固定回應。',
          placement: 'right',
        },
        {
          target: '[data-tour="ar-new"]',
          title: '第 2 步：建第一條規則',
          description:
            '點「<strong>➕ 新增</strong>」：設好「關鍵字」和「要回什麼」，存檔後把狀態切成「<strong>啟用</strong>」就生效。',
          placement: 'right',
        },
      ],
    },
    {
      id: 'richmenu',
      requiresOperate: true,
      icon: '🗂️',
      label: '建立圖文選單',
      blurb: '聊天室下方的圖片選單。我直接幫你進新增畫面、一個欄位一個欄位教你填。',
      route: wid => `/admin/${wid}/richmenu`,
      steps: [
        {
          target: '[data-tour="rm-title"]',
          title: '圖文選單是什麼',
          description:
            '圖文選單是 LINE 聊天室<strong>下方的圖片選單</strong>，客人點一個區塊就觸發動作（開網址、送訊息…），是很常用的固定入口。我直接帶你進新增畫面示範 →',
          placement: 'right',
        },
        {
          target: '[data-tour="rm-chatbar"]',
          clickBefore: '[data-tour="rm-new"]',
          title: '① 選單標籤文字',
          description:
            '聊天室左下角會顯示的<strong>小標籤文字</strong>（例如「選單」「menu」，LINE 稱為 Chat Bar），客人點它才會展開選單。',
          placement: 'right',
        },
        {
          target: '[data-tour="rm-default"]',
          title: '② 設為預設選單',
          description:
            '打開的話，<strong>新加好友會自動顯示</strong>這個選單。一個帳號同時只會有一個預設選單。',
          placement: 'right',
        },
        {
          target: '[data-tour="rm-image"]',
          title: '③ 上傳背景圖（必要）',
          description:
            '上傳<strong>整張選單的底圖</strong>（建議 2500×1686 或 2500×843）。客人看到的就是這張圖。',
          placement: 'right',
        },
        {
          target: '[data-tour="rm-layout"]',
          title: '④ 選版型',
          description:
            '選一個<strong>版型</strong>，決定整張圖要切成幾個可點區塊（例如 2×3 六格）。要完全自訂就選「自訂」。',
          placement: 'right',
        },
        {
          target: '',
          title: '⑤ 幫每個區塊綁動作',
          description:
            '上傳背景圖後，下方會出現「<strong>區塊設定</strong>」：幫每一個區塊綁一個動作——<strong>開網址、傳訊息、觸發模組、切換到另一個選單</strong>都行。',
        },
        {
          target: '[data-tour="rm-save"]',
          title: '⑥ 建立',
          description: '都填好後按右上「<strong>建立圖文選單</strong>」就生效 🎉',
          placement: 'bottom-end',
        },
      ],
    },
    {
      id: 'broadcasts',
      requiresOperate: true,
      icon: '📣',
      label: '發一則推播',
      blurb: '主動群發訊息給好友。我帶你認識怎麼發，共 2 步。',
      route: wid => `/admin/${wid}/broadcasts`,
      steps: [
        {
          target: '[data-tour="bc-title"]',
          title: '第 1 步：推播是主動群發',
          description:
            '推播是<strong>主動群發</strong>訊息給好友——活動、公告都靠它。注意推播會耗用 LINE 的月推播額度。',
          placement: 'right',
        },
        {
          target: '[data-tour="bc-new"]',
          title: '第 2 步：建一則推播',
          description:
            '點「<strong>➕ 新增</strong>」：寫內容、選對象（可用標籤篩選名單），還能<strong>排程</strong>定時發送。',
          placement: 'right',
        },
      ],
    },
    {
      id: 'support-presets',
      requiresOperate: true,
      icon: '📦',
      label: '建立客服預存',
      blurb: '常用回覆存起來，對話時一選即送。共 2 步。',
      route: wid => `/admin/${wid}/support-presets`,
      steps: [
        {
          target: '[data-tour="sp-title"]',
          title: '第 1 步：什麼是客服預存',
          description:
            '客服預存是把<strong>常用回覆</strong>（或模組捷徑）先存好，客服在「對話」頁<strong>一選即送</strong>，不用每次重打。',
          placement: 'right',
        },
        {
          target: '[data-tour="sp-new"]',
          title: '第 2 步：新增一筆',
          description:
            '點「<strong>➕ 新增</strong>」設好內容。只有切「<strong>啟用</strong>」的預存，才會出現在對話頁的選單。',
          placement: 'right',
        },
      ],
    },
    {
      id: 'conversation-stats',
      icon: '📊',
      label: '看對話統計',
      blurb: '看 AI 幫你擋掉多少、哪裡要優化。共 2 步。',
      route: wid => `/admin/${wid}/conversation-stats`,
      steps: [
        {
          target: '[data-tour="cs-filter"]',
          title: '第 1 步：選日期範圍與統計單位',
          description:
            '選<strong>日期範圍</strong>和統計單位（<strong>日／週／月</strong>），下面的數字會跟著變；右邊可「<strong>匯出報表</strong>」存成 Excel 檔。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="cs-kpi"]',
          title: '第 2 步：看關鍵數字',
          description:
            '這排是重點：總對話數、<strong>機器人先接住的比例</strong>（客人第一句就由 AI 回答）、轉真人和結案的比例——看 AI 幫你分擔了多少、哪裡還要再補知識或腳本。',
          placement: 'bottom',
        },
      ],
    },
    {
      id: 'members',
      icon: '👥',
      label: '邀請團隊成員',
      blurb: '把同事加進來、分配角色權限。共 2 步。',
      requiresSettings: true,
      route: wid => `/admin/${wid}/settings/members`,
      steps: [
        {
          target: '[data-tour="mem-list"]',
          title: '第 1 步：誰能進這個後台',
          description:
            '這裡管理成員與權限。每個人有角色：<strong>管理員</strong>（可改設定）、<strong>客服</strong>（能處理對話）、<strong>觀察者</strong>（只能看）。',
          placement: 'bottom',
        },
        {
          target: '[data-tour="mem-invite"]',
          title: '第 2 步：用 Email 邀請',
          description:
            '點「<strong>邀請成員</strong>」輸入 Email——對方<strong>不用先註冊</strong>，等他建帳號首次登入就自動生效。',
          placement: 'bottom-end',
        },
      ],
    },
  ]
}

/** 教學主題的分類（給「想複習教學」分組收合用）；對應 topic id */
const TOPIC_CATEGORY: Record<string, string> = {
  organization: 'setup',
  members: 'setup',
  // AI 客服一整組：開機 → 餵知識 → 維護 → 腳本 → 測試（獨立於平台接通的「開始設定」）
  'ai-settings': 'ai',
  knowledge: 'ai',
  'knowledge-manage': 'ai',
  'ai-scripts': 'ai',
  'ai-playground': 'ai',
  conversations: 'daily',
  flow: 'bot',
  'msg-basic': 'bot',
  'msg-rich': 'bot',
  'msg-carousel': 'bot',
  'msg-quick': 'bot',
  'msg-userinput': 'bot',
  'auto-reply': 'growth',
  richmenu: 'growth',
  broadcasts: 'growth',
  'support-presets': 'growth',
  'conversation-stats': 'growth',
}

/** 分類顯示順序與名稱 */
const CATEGORY_META: { id: string, label: string }[] = [
  { id: 'setup', label: '開始設定' },
  { id: 'ai', label: 'AI 客服' },
  { id: 'daily', label: '日常客服' },
  { id: 'bot', label: '機器人模組' },
  { id: 'growth', label: '經營工具' },
]

export interface TutorialCategoryGroup {
  id: string
  label: string
  topics: TutorialTopic[]
}

export function useTutorial() {
  const router = useRouter()
  const { workspaceId, canManageSettings, canOperate } = useWorkspace()
  const { setDemo } = useFlowDemo()
  const flowFeatures = useFlowFeatures()

  // 功能旗標查表（topic / step 的 requiresFeature 對到這裡）
  const FEATURES: Record<string, boolean> = {
    userInput: flowFeatures.showUserInput,
    userInputAttribute: flowFeatures.showUserInputAttribute,
  }
  const featureOn = (key?: string) => !key || FEATURES[key] === true

  // 全域狀態（沿用本專案 useState 模式，跨元件共享）
  const panelOpen = useState('tutorial-panel-open', () => false)
  const tourOpen = useState('tutorial-tour-open', () => false)
  const tourStep = useState('tutorial-tour-step', () => 0)
  // 目前導覽的步驟（由 startTopic 或 startAdHocTour 設定，是唯一真相來源）
  const activeSteps = useState<TutorialStep[]>('tutorial-active-steps', () => [])
  // 最近一次啟動的主題 id（ad-hoc 巡覽為 null）；給導覽結束後的閉環判斷用
  const lastTopicId = useState<string | null>('tutorial-last-topic', () => null)

  const allTopics = buildTopics()

  /** 過濾步驟：關閉的功能旗標對應的步驟跳過 */
  const visibleSteps = (steps: TutorialStep[]) => steps.filter(s => featureOn(s.requiresFeature))

  /** 依角色＋功能旗標過濾出可見主題：沒權限／沒開的功能就不顯示其教學 */
  const topics = computed(() =>
    allTopics.filter((t) => {
      if (!featureOn(t.requiresFeature))
        return false
      if (t.requiresSettings)
        return canManageSettings.value
      if (t.requiresOperate)
        return canOperate.value
      return true
    }),
  )

  /** 依分類分組（已過濾角色、按 CATEGORY_META 順序、空組不顯示） */
  const groupedTopics = computed<TutorialCategoryGroup[]>(() =>
    CATEGORY_META
      .map(c => ({
        id: c.id,
        label: c.label,
        topics: topics.value.filter(t => TOPIC_CATEGORY[t.id] === c.id),
      }))
      .filter(g => g.topics.length > 0),
  )

  function openPanel() {
    panelOpen.value = true
  }
  function closePanel() {
    panelOpen.value = false
  }
  function togglePanel() {
    panelOpen.value = !panelOpen.value
  }

  /** 等到 selector 對應的元素出現（最多等 ~3s），給跨頁導覽用 */
  function waitForElement(selector: string, timeout = 3000): Promise<boolean> {
    if (typeof document === 'undefined' || !selector) return Promise.resolve(false)
    return new Promise((resolve) => {
      const start = Date.now()
      const tick = () => {
        if (document.querySelector(selector)) return resolve(true)
        if (Date.now() - start > timeout) return resolve(false)
        requestAnimationFrame(tick)
      }
      tick()
    })
  }

  /** 選了某個主題：導航到該頁 → 等元素出現 → 開 tour */
  async function startTopic(topic: TutorialTopic) {
    const wid = workspaceId.value
    if (!wid) return
    const steps = visibleSteps(topic.steps)
    if (!steps.length) return
    activeSteps.value = steps
    lastTopicId.value = topic.id
    tourStep.value = 0
    closePanel()

    if (topic.route) {
      const to = topic.route(wid)
      if (router.currentRoute.value.path !== to)
        await router.push(to)
    }

    // 第一步若要示範訊息卡，先觸發示範，讓欄位元素出現（否則 waitForElement 會逾時）
    const first = steps[0]
    if (first?.demoType)
      setDemo(first.demoType)
    if (first?.target)
      await waitForElement(first.target)

    tourOpen.value = true
  }

  /** 依 topic id 啟動導覽（給健康摘要的「帶我做」按鈕用）；找不到回傳 false */
  function startTopicById(id: string): boolean {
    const topic = allTopics.find(t => t.id === id)
    if (!topic)
      return false
    void startTopic(topic)
    return true
  }

  /**
   * 臨時導覽：直接給一組步驟在「當前頁面」高亮（不換頁）。
   * 給「缺項巡覽」用——依即時狀態組裝、逐一高亮側欄上還沒做完的入口。
   */
  async function startAdHocTour(steps: TutorialStep[]) {
    if (!steps.length) return
    activeSteps.value = steps
    lastTopicId.value = null
    tourStep.value = 0
    closePanel()
    const firstTarget = steps[0]?.target
    if (firstTarget)
      await waitForElement(firstTarget)
    tourOpen.value = true
  }

  function endTour() {
    tourOpen.value = false
    activeSteps.value = []
    tourStep.value = 0
  }

  return {
    // state
    panelOpen,
    tourOpen,
    tourStep,
    topics,
    groupedTopics,
    activeSteps,
    lastTopicId,
    // actions
    openPanel,
    closePanel,
    togglePanel,
    startTopic,
    startTopicById,
    startAdHocTour,
    endTour,
  }
}
