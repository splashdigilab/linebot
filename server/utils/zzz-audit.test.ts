import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'

const cfg = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
}
;(globalThis as any).useRuntimeConfig = () => cfg
;(globalThis as any).createError = (o: any) => new Error(typeof o === 'string' ? o : o?.message)

const WS = 'f2d418e2-9f5a-4123-86db-2d9d5bc6a779'
const OUT = '/private/tmp/claude-501/-Users-kevin-Documents-Github-linebot/39a5990d-aa85-400a-8b27-b9b78c0e674a/scratchpad/audit-results.json'

type Turn = { role: 'user' | 'bot'; text: string }
type Case = { id: string; dim: string; q: string; history?: Turn[]; note: string }

const H = (...t: [string, string][]): Turn[] => t.map(([r, x]) => ({ role: r as any, text: x }))

const CASES: Case[] = [
  // A. 指名 / 諧音 / 錯字（本次修正重點）
  { id: 'A1', dim: '指名-精確', q: '有賣粒粒安嗎', note: '精確中文品名→直答' },
  { id: 'A2', dim: '指名-諧音', q: '有賣莉莉安嗎', note: '諧音粒粒安→單一確認卡' },
  { id: 'A3', dim: '指名-拆源保固', q: '粒粒安的保固多久', note: '粒粒安保固卡在無品牌來源，能否答對' },
  { id: 'A4', dim: '指名-威技退化', q: '威技除濕機保固多久', note: '指名威技卻反問選品牌?(舊退化案例)' },
  { id: 'A5', dim: '指名-型號', q: 'WDH31B16E 這台多少錢', note: '英數型號指名' },
  { id: 'A6', dim: '指名-中文', q: '奇美燈保固怎麼算', note: '兩全奇美燈 中文指名' },
  { id: 'A7', dim: '指名-中文', q: '小獴友什麼時候出貨', note: 'Poketomo小獴友出貨' },
  { id: 'A8', dim: '指名-諧音', q: '小蒙友可以陪聊天嗎', note: '諧音小獴友' },
  { id: 'A9', dim: '指名-latin', q: 'ibarista濾掛包可以用嗎', note: 'iBarista濾掛' },
  { id: 'A10', dim: '指名-EH碼', q: '粒粒安電子鍋顯示EH是什麼意思', note: '保護代碼EH卡(無品牌來源)' },
  { id: 'A11', dim: '指名-頂級A咖', q: '頂級A咖咖啡機好用嗎', note: 'SHARP頂級A咖 iBarista別名' },

  // B. 反問澄清（該反問 vs 不該反問）
  { id: 'B1', dim: '反問-合理', q: '除濕機保固多久', note: '三品牌除濕機→該反問' },
  { id: 'B2', dim: '反問-合理', q: '咖啡機多少錢', note: 'iBarista vs Balzano→該反問' },
  { id: 'B3', dim: '列舉', q: '你們有賣哪些除濕機', note: 'list意圖→直接列出不反問' },
  { id: 'B4', dim: '列舉', q: '有什麼產品', note: '總覽卡' },
  { id: 'B5', dim: '反問-空清', q: '空氣清淨機濾網多久換', note: '毛小奈Lite/抗敏/LG小蘑菇' },

  // C. 意圖路由
  { id: 'C1', dim: '社交', q: '你好', note: 'greeting罐頭' },
  { id: 'C2', dim: '社交', q: '謝謝你', note: 'thanks罐頭' },
  { id: 'C3', dim: '社交', q: '掰掰', note: 'farewell罐頭' },
  { id: 'C4', dim: '找真人', q: '我要找真人', note: 'user_request handoff' },
  { id: 'C5', dim: '敏感', q: '你們是不是詐騙我要檢舉', note: 'sensitive handoff' },
  { id: 'C6', dim: '商業', q: '我要團購批發100台可以談價嗎', note: 'commercial→轉真人' },
  { id: 'C7', dim: '比較', q: 'iBarista跟Balzano哪個好', note: 'compare客觀差異' },

  // D. Grounding / 亂掰防護
  { id: 'D1', dim: '不存在', q: '有賣iPhone嗎', note: '不該亂掰' },
  { id: 'D2', dim: '不存在', q: '有賣大同電鍋嗎', note: '不該亂掰' },
  { id: 'D3', dim: '療效', q: '記憶枕可以治好我的頸椎病嗎', note: 'DEAR.min記憶枕療效宣稱→擋' },
  { id: 'D4', dim: '療效', q: '紅光儀可以治療癌症嗎', note: 'W1 REGEN療效→擋' },
  { id: 'D5', dim: '不存在', q: '有掃地機器人推薦嗎', note: '有洗衣機無掃地機' },

  // E. 物流 / 訂單（來源 d4bbc0 現已存在）
  { id: 'E1', dim: '訂單', q: '我的訂單到現在還沒收到怎麼辦', note: '訂單狀態' },
  { id: 'E2', dim: '訂單', q: '運費怎麼算', note: 'KB可能無' },
  { id: 'E3', dim: '訂單', q: '可以分期付款嗎', note: 'KB可能無' },
  { id: 'E4', dim: '訂單', q: '退款大概多久會入帳', note: '有卡→直答' },
  { id: 'E5', dim: '訂單', q: '我想取消訂單', note: '有卡→直答' },
  { id: 'E6', dim: '訂單', q: '出貨可以提前嗎', note: '有卡→直答' },

  // F. 政策 / 單一正解
  { id: 'F1', dim: '政策', q: '可以開統編嗎', note: '發票統編' },
  { id: 'F2', dim: '政策', q: '發票怎麼拿', note: '發票' },
  { id: 'F3', dim: '政策', q: '節能家電的退稅怎麼申請', note: '退還減徵貨物稅' },

  // G. 價格 / 購買連結
  { id: 'G1', dim: '購買', q: '咖啡機要去哪裡買', note: '連結' },
  { id: 'G2', dim: '購買', q: '奇美燈多少錢', note: '價格/連結' },

  // H. 多輪對話
  { id: 'H1', dim: '多輪-followup', q: '那多少錢', history: H(['user', '有賣iBarista咖啡機嗎'], ['bot', '有的，SHARP iBarista 智慧咖啡機。']), note: '追問價格→iBarista' },
  { id: 'H2', dim: '多輪-換產品', q: '那咖啡機呢', history: H(['user', 'GPLUS除濕機的濾網多久換'], ['bot', 'GPLUS 除濕機濾網屬長效型…']), note: '換產品是否卡住(memory)' },
  { id: 'H3', dim: '多輪-選項', q: '威技', history: H(['user', '除濕機保固多久'], ['bot', '請問您想了解哪一款除濕機呢？']), note: '回反問選品牌' },
  { id: 'H4', dim: '多輪-修正', q: '喔不是，我是要問水箱容量', history: H(['user', 'iBarista濾掛怎麼用'], ['bot', 'iBarista 濾掛包模式…']), note: '修正主題' },

  // I. 口語 / persona / 注音 / 長輩
  { id: 'I1', dim: '長輩口語', q: '欸那個電子鍋煮粥都會滿出來是怎樣啦', note: '電子鍋溢出卡' },
  { id: 'I2', dim: '注音', q: 'ㄋㄧˇ ㄏㄠˇ 我想問顯微鏡', note: '注音混雜' },
  { id: 'I3', dim: '口語', q: '那個推車能載多重', note: 'Squall Beast推車' },

  // J. 邊界 / 惡意 / 一句多問
  { id: 'J1', dim: '一句多問', q: '咖啡機保固多久，還有濾掛怎麼用', note: '一句兩問(同iBarista)' },
  { id: 'J2', dim: '身份', q: '你是誰', note: 'identity' },
  { id: 'J3', dim: '單字', q: '?', note: '無意義' },
  { id: 'J4', dim: '單字', q: '在嗎', note: 'greeting邊界' },
  { id: 'J5', dim: '閒聊', q: '今天天氣真好', note: '無關閒聊' },

  // K. 隱私 / 敏感
  { id: 'K1', dim: '隱私', q: '小獴友的鏡頭會不會偷拍我', note: '小獴友鏡頭隱私卡' },
  { id: 'K2', dim: '隱私', q: '你們會不會亂用我的個資', note: 'privacy' },
]

function top3(sources: any[]) {
  return (sources ?? []).slice(0, 3).map((s: any) => `${s.title}｜${(s.similarity ?? 0).toFixed(2)}`)
}

it('run AI conversation audit battery', async () => {
  const { answerWithAi } = await import('./ai-answer')
  const results: any[] = []
  for (const c of CASES) {
    const started = process.hrtime.bigint()
    try {
      const r: any = await answerWithAi({ workspaceId: WS, query: c.q, history: c.history, debug: false } as any)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      results.push({
        id: c.id, dim: c.dim, q: c.q, note: c.note,
        decision: r.decision,
        handoffReason: r.handoffReason ?? null,
        confidence: r.confidence != null ? Number(r.confidence.toFixed(3)) : null,
        answer: (r.answer ?? '').slice(0, 240),
        disambig: r.disambiguation
          ? { clar: r.disambiguation.clarification, opts: r.disambiguation.options.map((o: any) => o.label || o.title) }
          : null,
        top3: top3(r.sources),
        ms: Math.round(ms),
      })
    }
    catch (err: any) {
      results.push({ id: c.id, dim: c.dim, q: c.q, note: c.note, decision: 'ERROR', error: String(err?.message ?? err) })
    }
    writeFileSync(OUT, JSON.stringify(results, null, 2))
  }
  expect(results.length).toBe(CASES.length)
}, 900000)
