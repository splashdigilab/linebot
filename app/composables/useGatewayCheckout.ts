/**
 * 動態建一張 hidden form 自動 POST 到金流付款頁（PAYUNi UPP）。
 * 升級對話框（AdminPlanUpgradeDialog）與帳單頁（settings/billing）共用同一手法,
 * 避免兩份複製各自漂移。Nuxt 自動 import,呼叫端直接用 submitToGateway 即可。
 */
export function submitToGateway(action: string, fields: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = k
    input.value = String(v)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}
