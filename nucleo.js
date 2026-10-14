// Núcleo do app: constantes, formatação, armazenamento local e elementos da página (sem dependências).

export const params = new URLSearchParams(location.search)

export const DEMO = params.has('demo')

export const TURNO = params.get('turno') === '2' ? 2 : 1

export const BASE = (params.get('base') || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '')

export const CICLO = 'ele2026'

export const UF = 'sc'

export const INTERVALO_MS = DEMO ? 5_000 : 30_000

export const fmt = new Intl.NumberFormat('pt-BR')

export const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(/\./g, '').replace(',', '.')) || 0)

export const pct = (s) => (s == null || s === '' ? null : Number(String(s).replace(',', '.')))

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const iniciais = (nome) =>
  String(nome)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

export function lerLocal(chave, padrao) {
  try {
    return localStorage.getItem(chave) ?? padrao
  } catch {
    return padrao
  }
}

export function gravarLocal(chave, valor) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    /* sem storage: ignora */
  }
}

// Ficam só neste navegador. No modo demonstração usam chaves separadas para não misturar com os dados reais.
export const PREFIXO = DEMO ? 'demo:' : ''

export function lerJSON(chave, padrao) {
  try {
    return JSON.parse(lerLocal(chave, '')) ?? padrao
  } catch {
    return padrao
  }
}

export const $ = (sel) => document.querySelector(sel)

export const conteudo = $('#conteudo')

export const statusEl = $('#status')

// placeholder animado enquanto os dados chegam (o texto fica para leitores de tela)
export const esqueleto = (texto, extra = '', linhas = 6) => `<div class="cartao esq" role="status" aria-busy="true"><span class="esq-txt">${esc(texto)}</span>${extra}
  <div class="esq-bloco esq-titulo"></div><div class="esq-grade"><div class="esq-bloco"></div><div class="esq-bloco"></div><div class="esq-bloco"></div><div class="esq-bloco"></div></div>
  ${Array.from({ length: linhas }, (_, i) => `<div class="esq-linha"><div class="esq-bloco esq-avatar"></div><div class="esq-col"><div class="esq-bloco" style="width:${70 - ((i * 13) % 35)}%"></div><div class="esq-bloco esq-fino" style="width:${45 - ((i * 7) % 20)}%"></div></div></div>`).join('')}</div>`

export const fmtDec = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Resultado oficial de 2022 em SC (TSE, votacao_candidato_munzona_2022), em dados2022/.
// Versão do build (injetada pelo Vite em vite.config.ts); fora do build, o ?v= do script
export const VERSAO = typeof __VERSAO__ !== 'undefined' ? __VERSAO__ : new URL(import.meta.url).searchParams.get('v') || ''

// cargos proporcionais (os números de 2 dígitos são votos de legenda)
export const ehProp = (cargo) => cargo === 6 || cargo === 7 || cargo === 13

export const ehMunicipal = (cargo) => cargo === 11 || cargo === 13

export const ROTULO_ELEICAO = { 't1-c3': 'Governador · 1º turno', 't2-c3': 'Governador · 2º turno', 't1-c5': 'Senado', 't1-c6': 'Dep. Federal', 't1-c7': 'Dep. Estadual', 't1-c11': 'Prefeito', 't2-c11': 'Prefeito · 2º turno', 't1-c13': 'Vereador' }

export const pctDe = (v, tot) => (tot ? (100 * v) / tot : 0)

export const nomeArquivo = (s) => semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export const COR_VAR = { 'var-alta-forte': '#0b7a45', 'var-alta': '#1f6fd1', 'var-novo': '#1f6fd1', 'var-queda': '#e08600', 'var-queda-forte': '#c62828', 'var-igual': '#8a8f8c' }
