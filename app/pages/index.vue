<template>
  <div
    ref="root"
    class="lp"
    :class="{ 'is-stuck': stuck, 'is-anim': anim, 'is-menu-open': menuOpen }"
  >
    <!-- ── Nav ─────────────────────────────────────────── -->
    <nav class="lp-nav">
      <div class="lp-wrap lp-nav__in">
        <a class="lp-brand" href="#top"><span class="lp-brand__mark">M</span>MYFEEL</a>
        <div class="lp-nav__links">
          <a href="#value" @click="closeMenu">產品</a>
          <a href="#diff" @click="closeMenu">差異</a>
          <a href="#pricing" @click="closeMenu">定價</a>
          <a href="#faq" @click="closeMenu">常見問題</a>
        </div>
        <div class="lp-nav__right">
          <NuxtLink to="/login" class="lp-nav__signin">登入</NuxtLink>
          <a class="lp-btn lp-btn--primary" href="#demo">預約 Demo</a>
          <button class="lp-nav__burger" aria-label="選單" @click="menuOpen = !menuOpen"><span /></button>
        </div>
      </div>
    </nav>

    <!-- ── Hero ────────────────────────────────────────── -->
    <header id="top" class="lp-hero">
      <span class="lp-hero__blob lp-hero__blob--1" />
      <span class="lp-hero__blob lp-hero__blob--2" />
      <div class="lp-wrap lp-hero__grid">
        <div class="lp-hero__text">
          <span class="lp-eyebrow">LINE AI 客服 · CRM · 再行銷</span>
          <h1>讓 AI 幫店主<br><span class="g">做生意</span></h1>
          <p class="lp-hero__sub">套用現成範本快速設定,15 分鐘接上你的 LINE 官方帳號——AI 依你的知識庫即時回客服、依腳本導購,幫你記住每一位客人。</p>
          <div class="lp-hero__actions">
            <a class="lp-btn lp-btn--primary" href="#demo">預約 Demo</a>
            <a class="lp-btn lp-btn--ghost" href="#demo">加入試銷名單 →</a>
          </div>
          <div class="lp-stats">
            <div class="lp-stat"><b>80%</b><span>日常客服自動接走</span></div>
            <div class="lp-stat"><b>15 分鐘</b><span>店主自己就能上手</span></div>
            <div class="lp-stat"><b>3 招</b><span>自動喚醒沉睡老客</span></div>
          </div>
        </div>

        <div class="lp-hero__visual">
          <div class="lp-phone lp-float">
            <span class="lp-aitag"><i />AI 自動回覆中</span>
            <div class="lp-chat">
              <div class="lp-chat__hd">
                <span class="lp-chat__back">‹</span>
                <span class="lp-chat__ava">品</span>
                <span class="lp-chat__title"><b>你的品牌</b><small>LINE 官方帳號</small></span>
                <span class="lp-chat__icons">☰</span>
              </div>
              <div class="lp-chat__scroll">
                <span class="lp-chat__day">今天</span>
                <div class="lp-row lp-row--in">
                  <span class="lp-row__ava">🙂</span>
                  <div class="lp-bubble lp-bubble--in">這款有現貨嗎?</div>
                  <span class="lp-row__time">14:32</span>
                </div>
                <div class="lp-row lp-row--out">
                  <div class="lp-bubble lp-bubble--out">有的,還有 3 件,要幫你保留嗎?</div>
                  <span class="lp-row__meta"><b>已讀</b>14:32</span>
                </div>
                <div class="lp-row lp-row--in">
                  <span class="lp-row__ava">🙂</span>
                  <div class="lp-bubble lp-bubble--in">好,謝謝</div>
                  <span class="lp-row__time">14:33</span>
                </div>
                <div class="lp-row lp-row--out">
                  <div class="lp-bubble lp-bubble--out">已為你保留 👍 這是結帳連結 →</div>
                  <span class="lp-row__meta"><b>已讀</b>14:33</span>
                </div>
              </div>
              <div class="lp-chat__input">
                <span class="ic">＋</span>
                <span class="lp-chat__box">輸入訊息…</span>
                <span class="ic">☺</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- ── Pain ────────────────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-reveal">
          <span class="lp-eyebrow lp-eyebrow--plain">你不是不想做,是分身乏術</span>
          <h2 class="lp-h2">人少、事多,<br>生意卡在同一雙手上</h2>
        </div>
        <div class="lp-cards3">
          <div class="lp-pcard lp-reveal">
            <div class="lp-pcard__ic">💬</div>
            <h3>客服回不完</h3>
            <p>顧客晚上敲門、假日敲門,漏回一則,可能就少一單。</p>
          </div>
          <div class="lp-pcard lp-reveal">
            <div class="lp-pcard__ic">🚪</div>
            <h3>老客默默流失</h3>
            <p>買過一次就再也沒下文,你根本沒空一個一個追回來。</p>
          </div>
          <div class="lp-pcard lp-reveal">
            <div class="lp-pcard__ic">📣</div>
            <h3>想行銷卻沒人做</h3>
            <p>節慶、上新、回購提醒,每次都想做,每次都沒時間。</p>
          </div>
        </div>
        <div class="lp-note lp-reveal">
          <span class="q">💭</span>
          <span>現在你可能是「訊息一則一則手動回、老客靠印象追」——<b>有空才做,沒空就放掉。</b>這正是 AI 該接手的地方。</span>
        </div>
      </div>
    </section>

    <!-- ── Value × Capability ──────────────────────────── -->
    <section id="value" class="lp-section">
      <div class="lp-wrap">
        <div class="lp-reveal">
          <span class="lp-eyebrow">從省錢一路做到賺錢</span>
          <h2 class="lp-h2">一套 AI,把客服、再行銷、忠誠度一次顧好</h2>
          <p class="lp-lede">三件事層層遞進——每個階段,都有對應的功能實際在幫你動手。</p>
        </div>
        <div class="lp-pillars">
          <div class="lp-pillar lp-reveal">
            <span class="lp-pillar__step"><i>1</i>客服 · 止血</span>
            <h3>接走 8 成日常客服</h3>
            <p class="lp-pillar__lede">疑難排解、產品諮詢、基礎導購,AI 即時回覆。</p>
            <ul class="lp-flist">
              <li><span class="ic">🧩</span><span><b>腳本</b><small>訂單查詢、退換貨、收資料、條件分支</small></span></li>
              <li><span class="ic">📚</span><span><b>知識庫客服</b><small>依你上傳的內容回答,不亂編</small></span></li>
              <li><span class="ic">📊</span><span><b>對話統計 ＋ 一鍵轉真人</b><small>機器人 / 真人分流一目了然</small></span></li>
            </ul>
          </div>
          <div class="lp-pillar lp-reveal">
            <span class="lp-pillar__step"><i>2</i>再行銷 · 造血</span>
            <h3>3 招喚醒老客</h3>
            <p class="lp-pillar__lede">興趣再導購、定頻喚醒、節日與重要日主動關心。</p>
            <ul class="lp-flist">
              <li><span class="ic">📣</span><span><b>分眾推播</b><small>對的訊息,送給對的人</small></span></li>
              <li><span class="ic">🎯</span><span><b>名單收集</b><small>LIFF 表單 ＋ 標籤,互動變名單</small></span></li>
              <li><span class="ic">📋</span><span><b>活動貼標 × 成效追蹤</b><small>每檔活動,看得到轉換</small></span></li>
            </ul>
          </div>
          <div class="lp-pillar lp-pillar--pro lp-reveal">
            <span class="lp-pillar__step"><i>3</i>忠誠度 · 資產</span>
            <h3>把買家養成熟客</h3>
            <p class="lp-pillar__lede">客服 × 再行銷長期整合,累積客戶 LTV。</p>
            <ul class="lp-flist">
              <li><span class="ic">🔗</span><span><b>客服與行銷資料打通</b><small>同一位客人,前後文都在</small></span></li>
              <li><span class="ic">🏷️</span><span><b>標籤分群</b><small>依行為與興趣自動分眾</small></span></li>
              <li><span class="ic">🔁</span><span><b>定頻喚醒與客戶重要日<span class="lp-soon">即將推出</span></b><small>該溝通的時機,AI 幫你記得</small></span></li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Diff + Roadmap ──────────────────────────────── -->
    <section id="diff" class="lp-section">
      <div class="lp-wrap">
        <div class="lp-reveal">
          <span class="lp-eyebrow lp-eyebrow--plain">為什麼不是「又一套 LINE 工具」</span>
          <h2 class="lp-h2">別家要你從零設規則,<br>MYFEEL 用範本 ＋ 知識庫,快速上線</h2>
        </div>

        <div class="lp-vs lp-reveal">
          <div class="lp-vs__card lp-vs__card--old">
            <span class="lp-vs__k">一般行銷工具</span>
            <p class="lp-vs__cap">功能都給你,但每一步的工,還是你自己做。</p>
            <ul class="lp-vs__list">
              <li><span class="m m--x">✕</span>策略自己想</li>
              <li><span class="m m--x">✕</span>腳本自己拉</li>
              <li><span class="m m--x">✕</span>旅程自己設</li>
              <li><span class="m m--x">✕</span>你以為導入,要先接一堆設定</li>
            </ul>
          </div>
          <div class="lp-vs__badge">VS</div>
          <div class="lp-vs__card lp-vs__card--new">
            <span class="lp-vs__brand"><span class="lp-vs__mark">M</span>MYFEEL</span>
            <p class="lp-vs__cap">範本 ＋ 知識庫,把設定的工也一起做掉。</p>
            <ul class="lp-vs__list">
              <li><span class="m m--v">✓</span>套用現成腳本範本,不用從零寫規則</li>
              <li><span class="m m--v">✓</span>客服 × CRM × 再行銷,一個後台全包</li>
              <li><span class="m m--v">✓</span>AI 依你的知識庫回答,不亂編</li>
              <li><span class="m m--v">✓</span>15 分鐘就能讓 AI 上線接客</li>
            </ul>
          </div>
        </div>

        <div class="lp-roadmap lp-reveal">
          <div class="lp-roadmap__top">
            <span class="lp-roadmap__badge">🔜 即將推出</span>
            <h3>接下來,AI 從「幫你設定」變成「主動幫你經營」</h3>
          </div>
          <div class="lp-roadmap__grid">
            <div class="lp-modes">
              <div class="lp-mode">
                <h4>對話式設定｜<span>用聊天完成所有設定</span></h4>
                <p>不用進後台一頁頁點,跟 AI 說需求,設定自動到位。</p>
              </div>
              <div class="lp-mode">
                <h4>主動式 AI｜<span>AI 端菜,你點頭</span></h4>
                <p>AI 主動分析你的經營資料、提出建議,你只要決策。</p>
              </div>
              <div class="lp-mode">
                <h4>被動式 AI｜<span>你出題,AI 策劃</span></h4>
                <p>一句話丟給 AI,它幫你補完受眾、文案、排程,一次到位。</p>
              </div>
              <p class="lp-roadmap__cta">現在 <a href="#demo">加入試銷名單</a>,第一批搶先體驗。</p>
            </div>

            <div class="lp-assist">
              <div class="lp-assist__hd">
                <span class="lp-assist__spark">✦</span>
                <span><b>MYFEEL AI</b><small>給店主的經營建議</small></span>
              </div>
              <div class="lp-assist__body">
                <div class="lp-assist__msg">有 <b>142 位老客</b>已經 60 天沒回購了,到了該再溝通的階段——要不要喚醒?</div>
                <span class="lp-exec">好,執行 ✓</span>
                <div class="lp-assist__done"><span class="dot" />已排程,今晚 8:00 送出分眾訊息 · 預估觸及 142 人</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Steps ───────────────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-reveal">
          <span class="lp-eyebrow">15 分鐘上手</span>
          <h2 class="lp-h2">店主的第一個 15 分鐘</h2>
          <p class="lp-lede">有引導設定精靈帶你走,不用懂技術。</p>
        </div>
        <div class="lp-steps">
          <div class="lp-step lp-reveal">
            <div class="lp-step__n">1</div>
            <h3>套用腳本範本</h3>
            <p>從訂單查詢、退換貨等範本挑一個,再逐句改成你的說法。</p>
          </div>
          <div class="lp-step lp-reveal">
            <div class="lp-step__n">2</div>
            <h3>上傳知識庫</h3>
            <p>把 FAQ 與商品資料丟進去,AI 就依你的內容回答,不亂編。</p>
          </div>
          <div class="lp-step lp-reveal">
            <div class="lp-step__n">3</div>
            <h3>貼一組網址接通</h3>
            <p>複製一組網址貼到 LINE 官方帳號,即刻接通。</p>
          </div>
          <div class="lp-step lp-reveal">
            <div class="lp-step__n">4</div>
            <h3>開始真實對話</h3>
            <p>客人傳來第一句話,AI 就替你回覆與導購。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Pricing + FAQ ───────────────────────────────── -->
    <section id="pricing" class="lp-section">
      <div class="lp-wrap">
        <div class="lp-reveal">
          <span class="lp-eyebrow">定價</span>
          <h2 class="lp-h2">軟體近免費,生意越好才付越多</h2>
          <p class="lp-price__intro">每個帳號都有免費額度,之後按 AI 回覆的則數計價。<b>用量在後台看得清清楚楚,超量才以固定單價加購——花多少一目了然。</b></p>
        </div>

        <div class="lp-plans">
          <div class="lp-plan lp-reveal">
            <span class="lp-plan__name">入門</span>
            <div class="lp-plan__price">NT$300–500 <small>／月</small></div>
            <p class="lp-plan__for">適合剛導入、想先讓 AI 接客服的店家。</p>
            <ul class="lp-plan__list">
              <li><span class="tick">✓</span> AI 即時客服</li>
              <li><span class="tick">✓</span> 腳本設定</li>
              <li><span class="tick">✓</span> 基礎推播</li>
              <li><span class="tick">✓</span> 一鍵轉真人</li>
            </ul>
            <a class="lp-btn lp-btn--ghost lp-btn--block" href="#demo">預約 Demo</a>
          </div>
          <div class="lp-plan lp-plan--pro lp-reveal">
            <span class="lp-plan__ribbon">最完整</span>
            <span class="lp-plan__name">進階</span>
            <div class="lp-plan__price">NT$1,000 <small>內／月</small></div>
            <p class="lp-plan__for">適合要做完整再行銷與忠誠度經營的品牌。</p>
            <ul class="lp-plan__list">
              <li><span class="tick">✓</span> 入門的全部功能</li>
              <li><span class="tick">✓</span> 分眾再行銷</li>
              <li><span class="tick">✓</span> 活動成效追蹤</li>
              <li><span class="tick">✓</span> 對話統計</li>
            </ul>
            <a class="lp-btn lp-btn--primary lp-btn--block" href="#demo">預約 Demo</a>
          </div>
        </div>
        <p class="lp-price__fine lp-reveal">＊試銷期價格,實際方案與額度以洽談為準。</p>

        <div id="faq" class="lp-faq lp-reveal">
          <h3 class="lp-faq__h">常見問題</h3>
          <div class="lp-faq__grid">
            <div>
              <details class="lp-q">
                <summary>我不懂技術,也能設定嗎?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">可以。挑一個現成範本套用、逐句改成你的說法,再把 FAQ 與商品資料丟進知識庫——全程不用寫程式,還有引導設定精靈帶著走。</div>
              </details>
              <details class="lp-q">
                <summary>我的客戶資料安全嗎?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">資料存在你自己的工作區,你擁有、可管理與刪除,我們不會另作他用。</div>
              </details>
              <details class="lp-q">
                <summary>按用量計價,會不會爆帳單?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">每個帳號都有免費額度,之後按 AI 回覆則數計價。用量在後台看得到,超量才以固定單價加購,不會無預警扣款。</div>
              </details>
            </div>
            <div>
              <details class="lp-q">
                <summary>需要綁約嗎?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">試銷期不綁約,隨時可停用。</div>
              </details>
              <details class="lp-q">
                <summary>支援哪種 LINE 帳號?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">LINE 官方帳號(OA),貼一組 Webhook 網址即可接通。</div>
              </details>
              <details class="lp-q">
                <summary>客人想找真人怎麼辦?<span class="plus" v-html="plusIcon" /></summary>
                <div class="a">可一鍵轉真人,對話統計也會記錄轉真人的情況。</div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── CTA band ────────────────────────────────────── -->
    <section id="demo" class="lp-section lp-cta">
      <span class="lp-cta__blob lp-cta__blob--1" />
      <span class="lp-cta__blob lp-cta__blob--2" />
      <div class="lp-wrap lp-cta__grid">
        <div>
          <span class="lp-cta__eyebrow">預約 Demo</span>
          <h2>用 15 分鐘,<br>讓 AI 開始替你顧客人</h2>
          <p class="lp-cta__sub">我們正在邀請第一批店家試用。留下聯絡方式,我們幫你把 AI 接上你的 LINE。</p>
          <ul class="lp-rr">
            <li><span class="tick">✓</span> 試銷期免費</li>
            <li><span class="tick">✓</span> 不綁約,隨時停用</li>
            <li><span class="tick">✓</span> 資料你擁有</li>
            <li><span class="tick">✓</span> 15 分鐘上手</li>
          </ul>
        </div>

        <div>
          <form v-if="!submitted" class="lp-form" novalidate @submit.prevent="submitted = true">
            <div class="lp-form__row">
              <div class="lp-field">
                <label for="f-name">稱呼</label>
                <input id="f-name" v-model="form.name" class="lp-input" type="text" placeholder="王小姐">
              </div>
              <div class="lp-field">
                <label for="f-contact">Email / LINE ID</label>
                <input id="f-contact" v-model="form.contact" class="lp-input" type="text" placeholder="you@shop.com">
              </div>
            </div>
            <div class="lp-form__row">
              <div class="lp-field">
                <label for="f-industry">產業別</label>
                <select id="f-industry" v-model="form.industry" class="lp-input">
                  <option>電商</option><option>自有品牌</option><option>O2O</option>
                  <option>餐飲</option><option>美業</option><option>其他</option>
                </select>
              </div>
              <div class="lp-field">
                <label for="f-need">最想先解決</label>
                <select id="f-need" v-model="form.need" class="lp-input">
                  <option>客服回不完</option><option>老客流失</option>
                  <option>沒人做行銷</option><option>想全部整合</option>
                </select>
              </div>
            </div>
            <button class="lp-btn lp-btn--primary lp-btn--block" type="submit">預約 Demo</button>
            <p class="lp-form__hint">送出即表示同意我們與你聯繫,不會有其他用途。</p>
          </form>

          <div v-else class="lp-form">
            <div class="lp-form__ok">
              <div class="big">✓</div>
              <h4>收到了{{ form.name ? '，' + form.name : '' }}!</h4>
              <p>我們會在 1 個工作天內與你聯繫,幫你把 AI 接上你的 LINE 官方帳號。</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Footer ──────────────────────────────────────── -->
    <footer class="lp-foot">
      <div class="lp-wrap lp-foot__in">
        <span class="lp-foot__brand"><span class="lp-brand__mark">M</span>MYFEEL INC · 讓 AI 幫店主做生意</span>
        <div class="lp-foot__links">
          <a href="#value">產品</a>
          <a href="#pricing">定價</a>
          <a href="#faq">常見問題</a>
          <a href="#demo">預約 Demo</a>
          <NuxtLink to="/login">登入</NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

useSeoMeta({
  title: 'MYFEEL — 讓 AI 幫店主做生意｜LINE AI 客服 × CRM × 再行銷',
  description:
    '套用現成範本快速設定,15 分鐘接上 LINE 官方帳號,AI 依你的知識庫即時回客服、依腳本導購。專為人少事多的中小店家打造。',
  ogTitle: 'MYFEEL — 讓 AI 幫店主做生意',
  ogDescription: '接走 8 成日常客服、分眾喚醒老客、把買過一次的人養成熟客。範本 ＋ 知識庫,快速讓 AI 上線接客。',
  ogType: 'website',
})

const plusIcon
  = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3v12M3 9h12"/></svg>'

const root = ref<HTMLElement | null>(null)
const stuck = ref(false)
const anim = ref(false)
const menuOpen = ref(false)
const submitted = ref(false)
const form = reactive({ name: '', contact: '', industry: '電商', need: '客服回不完' })

function closeMenu() { menuOpen.value = false }
function onScroll() { stuck.value = window.scrollY > 8 }

let io: IntersectionObserver | undefined

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) return

  document.documentElement.style.scrollBehavior = 'smooth'
  anim.value = true
  nextTick(() => {
    const els = root.value?.querySelectorAll<HTMLElement>('.lp-reveal') ?? []
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io?.unobserve(e.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    els.forEach(el => io?.observe(el))
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  io?.disconnect()
  document.documentElement.style.scrollBehavior = ''
})
</script>
