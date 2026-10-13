// Cliente da API da campanha (/api, Hono + Neon). O token de sessão fica no aparelho (localStorage);
// sem servidor (ex.: GitHub Pages) ou sem banco, as chamadas falham com uma mensagem amigável e o resto
// do app segue funcionando.

const CHAVE_TOKEN = 'campanha:token'
const BASE = (() => {
  // em produção /api é relativo ao site; VITE_API_URL permite apontar para outro servidor (ex.: Pages → Vercel)
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || ''
  return String(base).replace(/\/$/, '')
})()

let token = null
try {
  token = localStorage.getItem(CHAVE_TOKEN)
} catch {}

export const apiLogado = () => !!token
export function apiToken(novo) {
  token = novo || null
  try {
    novo ? localStorage.setItem(CHAVE_TOKEN, novo) : localStorage.removeItem(CHAVE_TOKEN)
  } catch {}
}

export class ErroApi extends Error {
  constructor(msg, status, indisponivel = false) {
    super(msg)
    this.status = status
    this.indisponivel = indisponivel
  }
}

async function chamar(metodo, rota, corpo, opcoes = {}) {
  const cab = { Accept: 'application/json' }
  if (corpo !== undefined) cab['Content-Type'] = 'application/json'
  if (token) cab.Authorization = `Bearer ${token}`
  let r
  try {
    r = await fetch(`${BASE}/api${rota}`, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: opcoes.signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new ErroApi('Sem conexão com o servidor da campanha.', 0, true)
  }
  const texto = await r.text()
  let j = null
  try {
    j = texto ? JSON.parse(texto) : null
  } catch {}
  if (!r.ok) {
    if (r.status === 401 && token && !rota.startsWith('/auth/')) apiToken(null) // sessão vencida
    const indisponivel = r.status === 503 || r.status === 404 || (r.status >= 500 && !j?.erro)
    throw new ErroApi(j?.erro || (indisponivel ? 'O servidor da campanha está indisponível neste site.' : `Erro ${r.status}`), r.status, indisponivel)
  }
  return j
}

export const api = {
  get: (rota, opcoes) => chamar('GET', rota, undefined, opcoes),
  post: (rota, corpo, opcoes) => chamar('POST', rota, corpo ?? {}, opcoes),
  put: (rota, corpo, opcoes) => chamar('PUT', rota, corpo ?? {}, opcoes),
  patch: (rota, corpo, opcoes) => chamar('PATCH', rota, corpo ?? {}, opcoes),
  del: (rota, opcoes) => chamar('DELETE', rota, undefined, opcoes),
}
