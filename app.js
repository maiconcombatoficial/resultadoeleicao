// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

import { corPartido, corTexto } from './cores.js?v=202610042052'

const params = new URLSearchParams(location.search)
const DEMO = params.has('demo')
const TURNO = params.get('turno') === '2' ? 2 : 1
const BASE = (params.get('base') || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '')
const CICLO = 'ele2026'
const UF = 'sc'
const INTERVALO_MS = DEMO ? 5_000 : 30_000

const ELEICOES = {
  federal: { 1: '6257', 2: '6258' },
  estadual: { 1: '6259', 2: '6260' },
}

const ABAS = [
  { id: 'favoritos', rotulo: '⭐ Acompanhados', tipo: 'fav', abrangencias: ['br'] },
  { id: 'presidente', rotulo: 'Presidente', cargo: 1, eleicao: 'federal', tipo: 'maj', abrangencias: ['br', UF] },
  { id: 'senador', rotulo: 'Senado SC', cargo: 5, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF], turno1: true },
  { id: 'depfed', rotulo: 'Dep. Federal SC', cargo: 6, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'depest', rotulo: 'Dep. Estadual SC', cargo: 7, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'governador', rotulo: 'Governador SC', cargo: 3, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF] },
]

const NOMES_ABR = { br: 'Brasil', sc: 'Santa Catarina' }

/* ---------------- utilidades ---------------- */

const fmt = new Intl.NumberFormat('pt-BR')
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(/\./g, '').replace(',', '.')) || 0)
const pct = (s) => (s == null || s === '' ? null : Number(String(s).replace(',', '.')))
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const iniciais = (nome) =>
  String(nome)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

function lerLocal(chave, padrao) {
  try {
    return localStorage.getItem(chave) ?? padrao
  } catch {
    return padrao
  }
}
function gravarLocal(chave, valor) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    /* sem storage: ignora */
  }
}

/* ---------------- acesso ao TSE ---------------- */

function codigoEleicao(aba, turno) {
  return ELEICOES[aba.eleicao][aba.turno1 ? 1 : turno]
}

function urlResultado(aba, abr, turno) {
  const ele = codigoEleicao(aba, turno)
  const c = String(aba.cargo).padStart(4, '0')
  return `${BASE}/${CICLO}/${ele}/dados/${abr}/${abr}-c${c}-e${ele.padStart(6, '0')}-u.json`
}

function urlFoto(aba, abr, sqcand, turno) {
  return `${BASE}/${CICLO}/${codigoEleicao(aba, turno)}/fotos/${abr}/${sqcand}.jpeg`
}

class NaoDivulgado extends Error {}

function normalizar(raw, aba, turno) {
  const carg = (raw.carg || []).find((x) => Number(x.cd) === aba.cargo) || (raw.carg || [])[0] || { agr: [] }
  const abr = (raw.cdabr || '').toLowerCase()
  const candidatos = []
  for (const agr of carg.agr || []) {
    const agremiacao = agr.tp === 'f' || agr.tp === 'c' ? agr.nm : ''
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        candidatos.push({
          sqcand: c.sqcand,
          numero: c.n,
          nome: c.nmu || c.nm,
          nomeCompleto: c.nm,
          partido: par.sg,
          agremiacao: agremiacao || par.sg,
          votos: num(c.vap),
          pvap: pct(c.pvap),
          eleito: c.e === 's',
          situacao: c.st || '',
          valido: !c.dvt || /^v[aá]lido/i.test(c.dvt),
          destinacao: c.dvt || '',
          vices: (c.vs || []).map((v) => ({ nome: v.nmu || v.nm, partido: v.sgp, tipo: v.tp })),
          foto: urlFoto(aba, abr, c.sqcand, turno),
        })
      }
    }
  }
  const s = raw.s || {}
  const e = raw.e || {}
  const v = raw.v || {}
  const validos = num(v.vv)
  for (const c of candidatos) {
    c.percentual = c.pvap != null && !Number.isNaN(c.pvap) ? c.pvap : validos ? (100 * c.votos) / validos : 0
  }
  candidatos.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'))
  return {
    cargoNome: carg.nmn || aba.rotulo,
    abrangencia: abr,
    vagas: num(carg.nv) || 1,
    atualizadoEm: [raw.dg, raw.hg].filter(Boolean).join(' '),
    final: raw.tf === 's',
    secoes: { total: num(s.ts), totalizadas: num(s.st), percentual: pct(s.pst) ?? 0 },
    eleitorado: { total: num(e.te), comparecimento: num(e.c), pComparecimento: pct(e.pc), abstencao: num(e.a), pAbstencao: pct(e.pa) },
    votos: {
      total: num(v.tv),
      validos,
      pValidos: pct(v.pvv),
      brancos: num(v.vb),
      pBrancos: pct(v.pvb),
      nulos: num(v.tvn),
      pNulos: pct(v.ptvn),
    },
    candidatos,
  }
}

async function buscar(aba, abr, turno, signal) {
  if (DEMO) return demo(aba, abr)
  let res
  try {
    res = await fetch(urlResultado(aba, abr, turno), { signal, cache: 'no-store' })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Não foi possível conectar ao TSE. Verifique sua internet (o site do TSE pode estar sobrecarregado).')
  }
  if (res.status === 404 || res.status === 403) throw new NaoDivulgado()
  if (!res.ok) throw new Error(`O TSE respondeu com erro ${res.status}. Tentando de novo em instantes.`)
  return normalizar(await res.json(), aba, turno)
}

/* ---------------- modo demonstração ---------------- */

// Apuração fictícia que vai de 0 a 100% em 10 minutos e recomeça. Nomes inventados.
const PARTIDOS_DEMO = ['PAA', 'PBB', 'PCC', 'PDD', 'PEE', 'PFF', 'PGG', 'PHH', 'PII', 'PJJ', 'PKK', 'PLL']
const NOMES_DEMO = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gisele', 'Hugo', 'Íris', 'João', 'Kátia', 'Lucas', 'Marta', 'Nelson', 'Olga', 'Paulo', 'Rita', 'Sérgio', 'Tânia', 'Vítor']
const SOBRENOMES_DEMO = ['da Silva', 'Souza', 'Oliveira', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nunes', 'Lima', 'Ramos', 'Teixeira', 'Moraes']

function aleatorio(semente) {
  let h = 2166136261
  for (let i = 0; i < semente.length; i++) h = Math.imul(h ^ semente.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function demo(aba, abr) {
  const r = aleatorio(`${aba.id}|${abr}`)
  const ciclo = 10 * 60_000
  const p = Math.min(1, ((Date.now() % ciclo) / ciclo) * 1.15)
  const eleitorado = abr === 'br' ? 158_000_000 : 5_600_000
  const secoesTot = abr === 'br' ? 472_000 : 16_900
  const vagas = { 1: 1, 3: 1, 5: 2, 6: 16, 7: 40 }[aba.cargo]
  const qtd = { 1: 9, 3: 7, 5: 10, 6: 180, 7: 400 }[aba.cargo]
  const comparec = eleitorado * 0.8 * p
  const brancos = comparec * 0.03
  const nulos = comparec * 0.04
  const validos = comparec - brancos - nulos
  const pesos = Array.from({ length: qtd }, (_, i) => Math.pow(r(), 2.2) * (aba.tipo === 'maj' ? 1 / (i + 1) : 1) + (i < vagas ? 0.3 : 0))
  const soma = pesos.reduce((a, b) => a + b, 0)
  const candidatos = pesos.map((w, i) => {
    const ruido = 1 + (r() - 0.5) * 0.2 * (1 - p)
    const votos = Math.round((validos * w * ruido) / soma)
    const partido = PARTIDOS_DEMO[Math.floor(r() * PARTIDOS_DEMO.length)]
    const nome = `${NOMES_DEMO[Math.floor(r() * NOMES_DEMO.length)]} ${SOBRENOMES_DEMO[Math.floor(r() * SOBRENOMES_DEMO.length)]}`
    return {
      sqcand: `demo${i}`,
      numero: String(aba.cargo === 6 ? 1000 + i : aba.cargo === 7 ? 10000 + i : 10 + i),
      nome,
      nomeCompleto: nome,
      partido,
      agremiacao: partido,
      votos,
      eleito: false,
      situacao: '',
      valido: true,
      vices: [],
      foto: '',
    }
  })
  const totalValidos = candidatos.reduce((a, c) => a + c.votos, 0)
  candidatos.forEach((c) => (c.percentual = totalValidos ? (100 * c.votos) / totalValidos : 0))
  candidatos.sort((a, b) => b.votos - a.votos)
  if (p >= 1) {
    if (aba.tipo === 'maj' && aba.cargo !== 5 && candidatos[0].percentual <= 50) {
      candidatos[0].situacao = candidatos[1].situacao = '2º turno'
    } else {
      candidatos.slice(0, vagas).forEach((c) => {
        c.eleito = true
        c.situacao = aba.tipo === 'prop' ? 'Eleito por QP' : 'Eleito'
      })
    }
  }
  const agora = new Date()
  return {
    cargoNome: aba.rotulo.replace(/ SC$/, ''),
    abrangencia: abr,
    vagas,
    atualizadoEm: agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR'),
    final: p >= 1,
    secoes: { total: secoesTot, totalizadas: Math.round(secoesTot * p), percentual: p * 100 },
    eleitorado: { total: eleitorado, comparecimento: Math.round(comparec), pComparecimento: p ? 80 : 0, abstencao: Math.round(eleitorado * 0.2 * p), pAbstencao: p ? 20 : 0 },
    votos: { total: Math.round(comparec), validos: totalValidos, pValidos: p ? 93 : 0, brancos: Math.round(brancos), pBrancos: p ? 3 : 0, nulos: Math.round(nulos), pNulos: p ? 4 : 0 },
    candidatos,
  }
}

/* ---------------- candidatos acompanhados ---------------- */

// Ficam só neste navegador. No modo demonstração usam chaves separadas para não misturar com os dados reais.
const PREFIXO = DEMO ? 'demo:' : ''
const CHAVE_FAV = `${PREFIXO}favoritos:v1`
const CHAVE_HIST = `${PREFIXO}historico:v1`

function lerJSON(chave, padrao) {
  try {
    return JSON.parse(lerLocal(chave, '')) ?? padrao
  } catch {
    return padrao
  }
}

let favoritos = lerJSON(CHAVE_FAV, [])
let historico = lerJSON(CHAVE_HIST, {})
const idFav = (abaId, abr, sqcand) => `${abaId}|${abr}|${sqcand}`
const ehFavorito = (abaId, abr, sqcand) => favoritos.some((f) => f.id === idFav(abaId, abr, sqcand))

function alternarFavorito(abaId, abr, c) {
  const id = idFav(abaId, abr, c.sqcand)
  if (favoritos.some((f) => f.id === id)) favoritos = favoritos.filter((f) => f.id !== id)
  else favoritos.push({ id, aba: abaId, abr, sqcand: c.sqcand, nome: c.nome, partido: c.partido })
  gravarLocal(CHAVE_FAV, JSON.stringify(favoritos))
}

// Guarda a evolução (% de seções apuradas, votos) de cada candidato acompanhado.
function registrarHistorico(abaId, abr, dados) {
  let mudou = false
  for (const f of favoritos) {
    if (f.aba !== abaId || f.abr !== abr) continue
    const c = dados.candidatos.find((x) => x.sqcand === f.sqcand)
    if (!c) continue
    const serie = historico[f.id] || []
    const ultimo = serie[serie.length - 1]
    const pst = Math.round(dados.secoes.percentual * 100) / 100
    if (ultimo && (c.votos < ultimo[1] || pst < ultimo[0])) serie.length = 0 // apuração recomeçou (ex.: demonstração)
    if (!ultimo || serie.length === 0 || ultimo[1] !== c.votos || ultimo[0] !== pst) {
      serie.push([pst, c.votos, Date.now()])
      if (serie.length > 300) serie.splice(1, serie.length - 300)
      historico[f.id] = serie
      mudou = true
    }
  }
  if (mudou) gravarLocal(CHAVE_HIST, JSON.stringify(historico))
}

/* ---------------- estado e navegação ---------------- */

const estado = {
  aba: ABAS.find((a) => a.id === (location.hash.slice(1) || lerLocal('aba', 'presidente'))) || ABAS[0],
  abr: {},
  busca: '',
  visao: 'candidatos', // proporcionais: candidatos | partidos
  partido: null, // filtro por agremiação na lista de deputados
  dados: null,
  controlador: null,
  timer: null,
  anterior: new Map(), // votos da última leitura, para mostrar o quanto cada um subiu
}

const $ = (sel) => document.querySelector(sel)
const conteudo = $('#conteudo')
const statusEl = $('#status')

function abrAtual() {
  const a = estado.aba
  return estado.abr[a.id] || a.abrangencias[0]
}

function montarAbas() {
  $('#abas').innerHTML = ABAS.map(
    (a) =>
      `<button role="tab" type="button" data-aba="${a.id}" aria-selected="${a === estado.aba}">${esc(a.rotulo)}${
        a.tipo === 'fav' && favoritos.length ? ` <span class="contador">${favoritos.length}</span>` : ''
      }</button>`,
  ).join('')
  $('#abas [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
}

$('#abas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-aba]')
  if (!b) return
  trocarAba(b.dataset.aba)
})

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1)
  if (id && id !== estado.aba.id) trocarAba(id)
})

function trocarAba(id) {
  const aba = ABAS.find((a) => a.id === id)
  if (!aba) return
  estado.aba = aba
  estado.busca = ''
  estado.visao = 'candidatos'
  estado.partido = null
  estado.dados = null
  estado.anterior = new Map()
  gravarLocal('aba', id)
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `${location.search}#${id}`)
  montarAbas()
  carregar()
}

$('#atualizar').addEventListener('click', () => carregar())

/* ---------------- ciclo de atualização ---------------- */

async function carregar() {
  clearTimeout(estado.timer)
  estado.controlador?.abort()
  const ctrl = new AbortController()
  estado.controlador = ctrl
  const aba = estado.aba
  const abr = abrAtual()
  statusEl.textContent = 'Atualizando…'
  statusEl.className = 'status carregando'
  if (!estado.dados) conteudo.innerHTML = `<div class="cartao vazio">Carregando ${esc(aba.rotulo)}…</div>`
  if (aba.tipo === 'fav') return carregarFavoritos(ctrl)
  try {
    const dados = await buscar(aba, abr, TURNO, ctrl.signal)
    if (ctrl.signal.aborted) return
    registrarHistorico(aba.id, abr, dados)
    const anterior = estado.dados && estado.dados.abrangencia === dados.abrangencia ? estado.dados : null
    estado.anterior = new Map((anterior?.candidatos || []).map((c) => [c.sqcand, c.votos]))
    estado.dados = dados
    renderizar()
    statusEl.textContent = dados.final ? 'Apuração encerrada' : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`
    statusEl.className = 'status ok'
  } catch (err) {
    if (err.name === 'AbortError') return
    estado.dados = null
    if (err instanceof NaoDivulgado) {
      conteudo.innerHTML = cabecalhoAbrangencia() + `
        <div class="cartao vazio">
          <p class="vazio-titulo">Resultados ainda não divulgados</p>
          <p>O TSE só publica os números de ${esc(aba.rotulo)} depois que as urnas fecham em todo o país (17h de Brasília).
          Esta página tenta de novo automaticamente a cada 30 segundos.</p>
          <p><a href="?demo=1#${aba.id}">Ver como fica com dados fictícios</a></p>
        </div>`
      statusEl.textContent = 'Aguardando divulgação'
      statusEl.className = 'status espera'
    } else {
      conteudo.innerHTML = cabecalhoAbrangencia() + `<div class="cartao vazio erro"><p>${esc(err.message)}</p></div>`
      statusEl.textContent = 'Erro ao atualizar'
      statusEl.className = 'status erro'
    }
  } finally {
    if (estado.controlador === ctrl && !estado.dados?.final) agendar()
  }
}

async function carregarFavoritos(ctrl) {
  const grupos = new Map()
  for (const f of favoritos) {
    const k = `${f.aba}|${f.abr}`
    if (!grupos.has(k)) grupos.set(k, { aba: ABAS.find((a) => a.id === f.aba), abr: f.abr })
  }
  const resultados = await Promise.allSettled(
    [...grupos.entries()].filter(([, g]) => g.aba).map(async ([k, g]) => [k, await buscar(g.aba, g.abr, TURNO, ctrl.signal)]),
  )
  if (ctrl.signal.aborted) return
  estado.favDados = new Map()
  let erros = 0
  for (const r of resultados) {
    if (r.status === 'fulfilled') {
      const [k, dados] = r.value
      const [abaId, abr] = k.split('|')
      registrarHistorico(abaId, abr, dados)
      estado.favDados.set(k, dados)
    } else if (!(r.reason instanceof NaoDivulgado)) erros++
  }
  estado.dados = { fav: true, final: false }
  renderizar()
  statusEl.textContent = erros ? 'Erro ao atualizar' : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`
  statusEl.className = erros ? 'status erro' : 'status ok'
  if (estado.controlador === ctrl) agendar()
}

function agendar() {
  clearTimeout(estado.timer)
  estado.timer = setTimeout(() => {
    if (document.hidden) agendar()
    else carregar()
  }, INTERVALO_MS)
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !estado.dados?.final) carregar()
})

/* ---------------- renderização ---------------- */

const OUTROS = '#9aa5a0'

function estiloCor(cor) {
  return `--cor:${cor};--cor-txt:${corTexto(cor)}`
}

function pill(sigla, cor = corPartido(sigla)) {
  return `<span class="pill" style="${estiloCor(cor)}">${esc(sigla)}</span>`
}

function cabecalhoAbrangencia() {
  const a = estado.aba
  if (a.abrangencias.length < 2) return ''
  const atual = abrAtual()
  return `<div class="segmentado" role="group" aria-label="Abrangência">
    ${a.abrangencias
      .map((abr) => `<button type="button" data-abr="${abr}" aria-pressed="${abr === atual}">${esc(NOMES_ABR[abr] || abr.toUpperCase())}</button>`)
      .join('')}
  </div>`
}

conteudo.addEventListener('click', (ev) => {
  const favBtn = ev.target.closest('[data-fav]')
  if (favBtn) {
    const { fav: sqcand, favAba: abaId, favAbr: abr } = favBtn.dataset
    if (ehFavorito(abaId, abr, sqcand)) {
      favoritos = favoritos.filter((f) => f.id !== idFav(abaId, abr, sqcand))
      gravarLocal(CHAVE_FAV, JSON.stringify(favoritos))
    } else {
      const c = estado.dados?.candidatos?.find((x) => x.sqcand === sqcand)
      if (!c) return
      alternarFavorito(abaId, abr, c)
      registrarHistorico(abaId, abr, estado.dados)
    }
    montarAbas()
    renderizar()
    return
  }
  const abrBtn = ev.target.closest('[data-abr]')
  if (abrBtn) {
    estado.abr[estado.aba.id] = abrBtn.dataset.abr
    estado.dados = null
    carregar()
    return
  }
  const visaoBtn = ev.target.closest('[data-visao]')
  if (visaoBtn) {
    estado.visao = visaoBtn.dataset.visao
    renderizar()
    return
  }
  const partidoBtn = ev.target.closest('[data-partido]')
  if (partidoBtn) {
    const p = partidoBtn.dataset.partido
    estado.partido = !p || estado.partido === p ? null : p
    estado.visao = 'candidatos'
    renderizar()
    $('#filtros')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  const alvo = ev.target.closest('[data-alvo]')
  if (alvo) {
    const el = document.getElementById(`c-${alvo.dataset.alvo}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('piscar')
      void el.offsetWidth
      el.classList.add('piscar')
    }
  }
})

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'busca') {
    estado.busca = ev.target.value
    $('#lista').innerHTML = listaProporcional()
  }
})

/* dica flutuante: qualquer elemento com data-dica (passar o mouse ou tocar) */
const dica = document.createElement('div')
dica.className = 'dica'
dica.hidden = true
document.body.appendChild(dica)
let dicaTimer
function mostrarDica(el, x, y) {
  dica.innerHTML = el.getAttribute('data-dica')
  dica.hidden = false
  const r = dica.getBoundingClientRect()
  const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))
  const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14
  dica.style.transform = `translate(${left}px, ${top}px)`
}
conteudo.addEventListener('pointermove', (ev) => {
  const el = ev.target.closest('[data-dica]')
  if (!el) {
    if (ev.pointerType === 'mouse') dica.hidden = true
    return
  }
  mostrarDica(el, ev.clientX, ev.clientY)
  clearTimeout(dicaTimer)
  if (ev.pointerType !== 'mouse') dicaTimer = setTimeout(() => (dica.hidden = true), 2500)
})
conteudo.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('[data-dica]')
  if (!el || ev.pointerType === 'mouse') return
  mostrarDica(el, ev.clientX, ev.clientY)
  clearTimeout(dicaTimer)
  dicaTimer = setTimeout(() => (dica.hidden = true), 2500)
})
conteudo.addEventListener('pointerleave', () => (dica.hidden = true))
window.addEventListener('scroll', () => (dica.hidden = true), { passive: true })

function resumo(d) {
  const tpl = $('#tpl-resumo').content.cloneNode(true)
  const f = (n) => tpl.querySelector(`[data-f="${n}"]`)
  const local = NOMES_ABR[d.abrangencia] || d.abrangencia.toUpperCase()
  f('titulo').textContent = `${d.cargoNome} · ${local}`
  f('selo').textContent = d.final ? 'Totalização final' : TURNO === 2 ? '2º turno' : 'Em apuração'
  f('selo').classList.toggle('final', d.final)
  const p = d.secoes.percentual
  f('barra').style.width = `${Math.min(100, p)}%`
  f('barra').parentElement.setAttribute('aria-valuenow', String(Math.round(p)))
  f('ptexto').innerHTML = `<strong>${fmtPct.format(p)}%</strong> das seções totalizadas
    <span class="mudo">(${fmt.format(d.secoes.totalizadas)} de ${fmt.format(d.secoes.total)})</span>`
  const item = (rot, cls, valor, extra) =>
    `<div class="num ${cls}"><dt>${rot}</dt><dd>${valor}${extra != null && !Number.isNaN(extra) ? ` <span class="mudo">${fmtPct.format(extra)}%</span>` : ''}</dd></div>`
  f('numeros').innerHTML = [
    item('Comparecimento', 'n-comp', fmt.format(d.eleitorado.comparecimento), d.eleitorado.pComparecimento),
    item('Abstenção', 'n-abst', fmt.format(d.eleitorado.abstencao), d.eleitorado.pAbstencao),
    item('Votos válidos', 'n-val', fmt.format(d.votos.validos), d.votos.pValidos),
    item('Brancos', 'n-bra', fmt.format(d.votos.brancos), d.votos.pBrancos),
    item('Nulos', 'n-nul', fmt.format(d.votos.nulos), d.votos.pNulos),
    item(d.vagas > 1 ? 'Vagas' : 'Vaga', 'n-vag', fmt.format(d.vagas)),
  ].join('')
  const div = document.createElement('div')
  div.appendChild(tpl)
  return div.innerHTML
}

function foto(c, cor = corPartido(c.partido)) {
  const ini = esc(iniciais(c.nome))
  const img = c.foto ? `<img src="${esc(c.foto)}" alt="" loading="lazy" onerror="this.remove()">` : ''
  return `<span class="foto" style="${estiloCor(cor)}"><span>${ini}</span>${img}</span>`
}

function selo(c) {
  if (c.eleito) return `<span class="tag eleito">${esc(/eleito/i.test(c.situacao) ? c.situacao : 'Eleito')}</span>`
  if (/2º turno|segundo turno/i.test(c.situacao)) return `<span class="tag turno2">2º turno</span>`
  if (/suplente/i.test(c.situacao)) return `<span class="tag suplente">Suplente</span>`
  if (!c.valido) return `<span class="tag invalido">${esc(c.destinacao || 'Voto anulado')}</span>`
  return ''
}

function ganho(c) {
  if (!estado.anterior.size) return 0
  const antes = estado.anterior.get(c.sqcand)
  return antes == null ? 0 : c.votos - antes
}

function delta(c) {
  const d = ganho(c)
  return d > 0 ? `<span class="delta">▲ ${fmt.format(d)}</span>` : ''
}

// Barra empilhada com a divisão dos votos válidos; cada fatia leva a cor do partido.
function barraEmpilhada(fatias, { marco50 = false, legenda = true, total: totalInformado = 0 } = {}) {
  const total = Math.max(totalInformado, fatias.reduce((a, f) => a + f.valor, 0)) || 1
  const segs = fatias
    .filter((f) => f.valor > 0)
    .map(
      (f) =>
        `<span class="seg" style="width:${(100 * f.valor) / total}%;background:${f.cor}" ${f.alvo ? `data-alvo="${esc(f.alvo)}"` : ''} ${
          f.partido ? `data-partido="${esc(f.partido)}"` : ''
        } data-dica="${esc(`<strong>${esc(f.rotulo)}</strong><br>${fmtPct.format((100 * f.valor) / total)}% · ${fmt.format(f.valor)} votos`)}"></span>`,
    )
    .join('')
  const leg = legenda
    ? `<ul class="legenda">${fatias
        .filter((f) => f.valor > 0)
        .map(
          (f) =>
            `<li ${f.alvo ? `data-alvo="${esc(f.alvo)}"` : ''} ${f.partido ? `data-partido="${esc(f.partido)}"` : ''}><i style="background:${f.cor}"></i>${esc(
              f.rotulo,
            )} <strong>${fmtPct.format((100 * f.valor) / total)}%</strong></li>`,
        )
        .join('')}</ul>`
    : ''
  return `<div class="empilhada">${segs}${marco50 ? '<span class="marco50" data-dica="50% dos votos válidos + 1 vence no 1º turno"></span>' : ''}</div>${leg}`
}

function estrela(c, abaId = estado.aba.id, abr = abrAtual()) {
  const on = ehFavorito(abaId, abr, c.sqcand)
  return `<button type="button" class="estrela ${on ? 'on' : ''}" data-fav="${esc(c.sqcand)}" data-fav-aba="${esc(abaId)}" data-fav-abr="${esc(abr)}"
    aria-pressed="${on}" aria-label="${on ? 'Deixar de acompanhar' : 'Acompanhar'} ${esc(c.nome)}" title="${on ? 'Deixar de acompanhar' : 'Acompanhar este candidato'}">${on ? '★' : '☆'}</button>`
}

// Gráfico da evolução: votos (eixo y, a partir de zero) × % de seções apuradas (eixo x).
function evolucao(serie, cor) {
  if (!serie || serie.length < 2)
    return `<p class="nota evo-vazia">O gráfico de evolução aparece a partir da próxima atualização com votos novos.</p>`
  const W = 300, H = 70, M = 4
  const x0 = serie[0][0], x1 = serie[serie.length - 1][0]
  const ymax = Math.max(1, ...serie.map((p) => p[1]))
  const X = (v) => (x1 === x0 ? W / 2 : M + ((v - x0) / (x1 - x0)) * (W - 2 * M))
  const Y = (v) => H - M - (v / ymax) * (H - 2 * M)
  const pts = serie.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)
  const ult = serie[serie.length - 1]
  const alvos = serie
    .map(
      (p) =>
        `<circle class="alvo" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="7" data-dica="${esc(
          `<strong>${fmt.format(p[1])} votos</strong><br>com ${fmtPct.format(p[0])}% das seções · ${new Date(p[2]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        )}"></circle>`,
    )
    .join('')
  return `<svg class="evolucao" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução dos votos" style="--cor:${cor}">
      <line x1="${M}" x2="${W - M}" y1="${H - M}" y2="${H - M}" class="eixo"></line>
      <polygon points="${X(x0).toFixed(1)},${H - M} ${pts.join(' ')} ${X(x1).toFixed(1)},${H - M}" class="area"></polygon>
      <polyline points="${pts.join(' ')}" class="linha"></polyline>
      <circle cx="${X(ult[0]).toFixed(1)}" cy="${Y(ult[1]).toFixed(1)}" r="4" class="ponta"></circle>
      ${alvos}
    </svg>
    <p class="evo-eixo"><span>${fmtPct.format(x0)}% apurado</span><span>${fmtPct.format(x1)}% apurado</span></p>`
}

function cardFavorito(f, d, { mostrarCargo = false } = {}) {
  const aba = ABAS.find((a) => a.id === f.aba)
  const cargoTxt = `${aba ? aba.rotulo.replace(/ SC$/, '') : ''} · ${NOMES_ABR[f.abr] || f.abr.toUpperCase()}`
  const c = d?.candidatos.find((x) => x.sqcand === f.sqcand)
  const cor = corPartido(c?.partido || f.partido)
  if (!c) {
    return `<article class="fav" style="${estiloCor(cor)}">
      <div class="fav-topo">${foto({ nome: f.nome, foto: '' }, cor)}
        <div class="cand-info"><div class="cand-linha"><span class="cand-nome">${esc(f.nome)}</span></div>
        <div class="cand-meta">${pill(f.partido, cor)} ${mostrarCargo ? esc(cargoTxt) : ''}</div></div>
        ${estrela(f, f.aba, f.abr)}</div>
      <p class="nota">${d ? 'Candidato não encontrado nesta apuração.' : 'Aguardando os resultados do TSE.'}</p>
    </article>`
  }
  const pos = d.candidatos.indexOf(c) + 1
  const total = d.candidatos.filter((x) => x.valido).length
  const acima = d.candidatos[pos - 2]
  const abaixo = d.candidatos[pos]
  const serie = historico[f.id] || []
  const ganhoUlt = serie.length > 1 ? serie[serie.length - 1][1] - serie[serie.length - 2][1] : 0
  let situacao = selo(c)
  if (!situacao && d.vagas && aba?.tipo === 'prop') {
    const corte = d.candidatos[d.vagas - 1]
    situacao =
      pos <= d.vagas
        ? `<span class="tag dentro">Entre os ${d.vagas} mais votados</span>`
        : `<span class="tag fora">${fmt.format(corte.votos - c.votos)} votos atrás do ${d.vagas}º</span>`
  }
  const distancias = [
    acima ? `<li>▼ <strong>${fmt.format(acima.votos - c.votos)}</strong> atrás do ${pos - 1}º (${esc(acima.nome)})</li>` : '<li>🥇 Em 1º lugar</li>',
    abaixo ? `<li>▲ <strong>${fmt.format(c.votos - abaixo.votos)}</strong> à frente do ${pos + 1}º (${esc(abaixo.nome)})</li>` : '',
  ].join('')
  return `<article class="fav" style="${estiloCor(cor)}">
    <div class="fav-topo">
      ${foto(c, cor)}
      <div class="cand-info">
        <div class="cand-linha"><span class="cand-nome">${esc(c.nome)}</span> ${situacao}</div>
        <div class="cand-meta">${pill(c.partido, cor)} ${esc(c.numero)}${mostrarCargo ? ` · ${esc(cargoTxt)}` : ''}</div>
      </div>
      ${estrela(c, f.aba, f.abr)}
    </div>
    <div class="fav-nums">
      <div><span class="fav-rot">Posição</span><strong>${pos}º</strong><span class="mudo">de ${total}</span></div>
      <div><span class="fav-rot">Votos</span><strong>${fmt.format(c.votos)}</strong>${ganhoUlt > 0 ? `<span class="delta">▲ ${fmt.format(ganhoUlt)}</span>` : ''}</div>
      <div><span class="fav-rot">% válidos</span><strong>${fmtPct.format(c.percentual)}%</strong></div>
    </div>
    <ul class="distancias">${distancias}</ul>
    ${evolucao(serie, cor)}
  </article>`
}

function secaoAcompanhando(d) {
  const abr = abrAtual()
  const meus = favoritos.filter((f) => f.aba === estado.aba.id && f.abr === abr)
  if (!meus.length) return ''
  return `<section class="cartao acompanhando">
    <h3>⭐ Acompanhando</h3>
    <div class="favs">${meus.map((f) => cardFavorito(f, d)).join('')}</div>
  </section>`
}

function renderFavoritos() {
  if (!favoritos.length) {
    return `<div class="cartao vazio">
      <p class="vazio-titulo">⭐ Nenhum candidato acompanhado ainda</p>
      <p>Toque na estrela <span class="estrela-exemplo">☆</span> ao lado de qualquer candidato, em qualquer aba, para acompanhar aqui a posição, os votos e a evolução dele durante a apuração.</p>
      <p class="nota">A lista fica salva neste aparelho.</p>
    </div>`
  }
  const ordem = ABAS.map((a) => a.id)
  const grupos = new Map()
  for (const f of [...favoritos].sort((a, b) => ordem.indexOf(a.aba) - ordem.indexOf(b.aba))) {
    const k = `${f.aba}|${f.abr}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(f)
  }
  return [...grupos.entries()]
    .map(([k, lista]) => {
      const [abaId, abr] = k.split('|')
      const aba = ABAS.find((a) => a.id === abaId)
      const d = estado.favDados?.get(k)
      const titulo = `${aba ? aba.rotulo.replace(/ SC$/, '') : abaId} · ${NOMES_ABR[abr] || abr.toUpperCase()}`
      const prog = d
        ? `<div class="progresso mini"><div class="progresso-barra" style="width:${Math.min(100, d.secoes.percentual)}%"></div></div>
           <p class="nota">${fmtPct.format(d.secoes.percentual)}% das seções totalizadas${d.final ? ' · totalização final' : ''}</p>`
        : '<p class="nota">Resultados ainda não divulgados.</p>'
      return `<section class="cartao acompanhando">
        <h3><a href="#${esc(abaId)}" class="link-aba">${esc(titulo)}</a></h3>
        ${prog}
        <div class="favs">${lista.map((f) => cardFavorito(f, d)).join('')}</div>
      </section>`
    })
    .join('')
}

function renderMajoritario(d) {
  const lista = d.candidatos.filter((c) => c.valido || c.votos > 0)
  const validos = lista.filter((c) => c.valido)
  const max = Math.max(1, ...lista.map((c) => c.percentual))
  const top = validos.slice(0, 5)
  const resto = validos.slice(5).reduce((a, c) => a + c.votos, 0)
  const fatias = top.map((c) => ({ valor: c.votos, cor: corPartido(c.partido), rotulo: `${c.nome} (${c.partido})`, alvo: c.sqcand }))
  if (resto) fatias.push({ valor: resto, cor: OUTROS, rotulo: 'Demais candidatos' })
  const nota =
    estado.aba.cargo === 5
      ? `<p class="nota">Em 2026 o Senado renova 2/3: SC elege <strong>${d.vagas}</strong> senadores — os ${d.vagas} mais votados.</p>`
      : `<p class="nota">A linha tracejada marca 50% dos votos válidos: quem passar dela vence no 1º turno.</p>`
  return `<section class="cartao">
      <h3>Divisão dos votos válidos</h3>
      ${barraEmpilhada(fatias, { marco50: estado.aba.cargo !== 5 && TURNO === 1, total: d.votos.validos })}
      ${nota}
    </section>
    <section class="cartao"><ol class="candidatos">
    ${lista
      .map((c, i) => {
        const cor = corPartido(c.partido)
        return `
      <li id="c-${esc(c.sqcand)}" class="cand ${c.eleito ? 'is-eleito' : ''} ${ganho(c) > 0 ? 'subiu' : ''}" style="${estiloCor(cor)}">
        <span class="pos">${i + 1}º</span>
        ${foto(c, cor)}
        <div class="cand-info">
          <div class="cand-linha">
            <span class="cand-nome">${esc(c.nome)}</span>
            ${selo(c)}
          </div>
          <div class="cand-meta">${pill(c.partido, cor)} ${esc(c.numero)}${
            c.vices.length ? ` · ${c.vices.map((v) => `${v.tipo === 'v' ? 'Vice' : 'Supl.'}: ${esc(v.nome)}`).join(' · ')}` : ''
          }</div>
          <div class="barra"><span style="width:${(100 * c.percentual) / max}%"></span></div>
        </div>
        <div class="cand-num">
          ${estrela(c)}
          <span class="pct">${fmtPct.format(c.percentual)}%</span>
          <span class="votos">${fmt.format(c.votos)} votos</span>
          ${delta(c)}
        </div>
      </li>`
      })
      .join('')}
  </ol></section>`
}

// Soma por partido/federação; a cor do grupo é a do seu partido mais votado.
function agremiacoes(d) {
  const grupos = new Map()
  for (const c of d.candidatos) {
    const g = grupos.get(c.agremiacao) || { nome: c.agremiacao, porPartido: new Map(), votos: 0, eleitos: 0, cands: 0 }
    g.porPartido.set(c.partido, (g.porPartido.get(c.partido) || 0) + (c.valido ? c.votos : 0))
    g.votos += c.valido ? c.votos : 0
    g.eleitos += c.eleito ? 1 : 0
    g.cands += 1
    grupos.set(c.agremiacao, g)
  }
  const lista = [...grupos.values()]
  for (const g of lista) {
    const [lider] = [...g.porPartido.entries()].sort((a, b) => b[1] - a[1])[0] || [g.nome]
    g.cor = corPartido(g.porPartido.has(g.nome) ? g.nome : lider)
    g.partidos = [...g.porPartido.keys()]
  }
  return lista.sort((a, b) => b.votos - a.votos || b.eleitos - a.eleitos)
}

function corDaAgremiacao(nome) {
  return estado.grupos?.find((g) => g.nome === nome)?.cor || corPartido(nome)
}

function listaProporcional() {
  const d = estado.dados
  if (!d) return ''
  const termo = semAcento(estado.busca.trim())
  const linhas = d.candidatos
    .map((c, i) => ({ c, pos: i + 1 }))
    .filter(({ c }) => !estado.partido || c.agremiacao === estado.partido)
    .filter(({ c }) => !termo || semAcento(`${c.nome} ${c.nomeCompleto} ${c.partido} ${c.numero} ${c.agremiacao}`).includes(termo))
  if (!linhas.length) return `<p class="vazio">Nenhum candidato encontrado${estado.busca ? ` para “${esc(estado.busca)}”` : ''}.</p>`
  const limite = termo || estado.partido ? 300 : 120
  return `<table class="tabela">
    <thead><tr><th>#</th><th>Candidato</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead>
    <tbody>
    ${linhas
      .slice(0, limite)
      .map(({ c, pos }) => {
        const cor = corPartido(c.partido)
        return `<tr class="${c.eleito ? 'is-eleito' : ''} ${ganho(c) > 0 ? 'subiu' : ''}" style="${estiloCor(cor)}">
        <td class="mudo pos-tab">${pos}</td>
        <td>
          <div class="cand-linha">${estrela(c)}<span class="cand-nome">${esc(c.nome)}</span> ${selo(c)}</div>
          <div class="cand-meta">${pill(c.partido, cor)} ${esc(c.numero)}${c.agremiacao !== c.partido ? ` · ${esc(c.agremiacao)}` : ''}</div>
        </td>
        <td class="dir">${fmt.format(c.votos)} ${delta(c)}</td>
        <td class="dir">${fmtPct.format(c.percentual)}</td>
      </tr>`
      })
      .join('')}
    </tbody></table>
    ${linhas.length > limite ? `<p class="nota">Mostrando ${limite} de ${fmt.format(linhas.length)}. Use a busca para encontrar outros candidatos.</p>` : ''}`
}

function tabelaPartidos(d) {
  const lista = estado.grupos
  const total = lista.reduce((a, g) => a + g.votos, 0) || 1
  const max = Math.max(1, ...lista.map((g) => g.votos))
  return `<p class="nota">Soma dos votos nominais de cada partido ou federação (sem votos de legenda).
    Toque numa linha para ver os candidatos dela.</p>
    <table class="tabela">
    <thead><tr><th>Partido / federação</th><th class="dir">Votos</th><th class="dir">%</th><th class="dir">Eleitos</th></tr></thead>
    <tbody>
    ${lista
      .map(
        (g) => `<tr class="clicavel" data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}">
        <td><div class="cand-linha">${pill(g.nome, g.cor)}</div>
          <div class="cand-meta">${g.partidos.length > 1 || g.partidos[0] !== g.nome ? esc(g.partidos.join(', ')) + ' · ' : ''}${g.cands} candidatos</div>
          <div class="barra fina"><span style="width:${(100 * g.votos) / max}%"></span></div></td>
        <td class="dir">${fmt.format(g.votos)}</td>
        <td class="dir">${fmtPct.format((100 * g.votos) / total)}</td>
        <td class="dir">${g.eleitos || '—'}</td>
      </tr>`,
      )
      .join('')}
    </tbody></table>`
}

// Semicírculo de cadeiras com os eleitos (só aparece quando o TSE marca os eleitos).
function hemiciclo(eleitos) {
  const n = eleitos.length
  const fileiras = n <= 20 ? 2 : n <= 32 ? 3 : 4
  const r0 = 46
  const passo = 54 / fileiras
  const raios = Array.from({ length: fileiras }, (_, i) => r0 + i * passo + passo / 2)
  const somaR = raios.reduce((a, b) => a + b, 0)
  const qtd = raios.map((r) => Math.max(1, Math.round((n * r) / somaR)))
  let dif = n - qtd.reduce((a, b) => a + b, 0)
  for (let i = fileiras - 1; dif !== 0; i = (i - 1 + fileiras) % fileiras) {
    qtd[i] += Math.sign(dif)
    dif -= Math.sign(dif)
  }
  const pontos = []
  raios.forEach((r, i) => {
    const k = qtd[i]
    for (let j = 0; j < k; j++) {
      const t = k === 1 ? Math.PI / 2 : Math.PI - (j * Math.PI) / (k - 1)
      pontos.push({ t, x: 110 + r * Math.cos(t), y: 108 - r * Math.sin(t) })
    }
  })
  pontos.sort((a, b) => b.t - a.t)
  const raioPonto = Math.min(9, passo * 0.42, ((Math.PI * raios[0]) / Math.max(1, qtd[0] - 1)) * 0.45)
  const circulos = eleitos
    .map((c, i) => {
      const p = pontos[i]
      const cor = corPartido(c.partido)
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${raioPonto.toFixed(1)}" fill="${cor}"
        data-dica="${esc(`<strong>${esc(c.nome)}</strong><br>${esc(c.partido)} · ${fmt.format(c.votos)} votos`)}" data-partido="${esc(c.agremiacao)}"></circle>`
    })
    .join('')
  return `<svg class="hemiciclo" viewBox="0 0 220 116" role="img" aria-label="Cadeiras por partido">${circulos}
    <text x="110" y="104" text-anchor="middle" class="hemi-num">${n}</text></svg>`
}

function renderProporcional(d) {
  estado.grupos = agremiacoes(d)
  const grupos = estado.grupos
  const eleitos = d.candidatos.filter((c) => c.eleito)
  const top = grupos.slice(0, 8)
  const resto = grupos.slice(8).reduce((a, g) => a + g.votos, 0)
  const fatias = top.map((g) => ({ valor: g.votos, cor: g.cor, rotulo: g.nome, partido: g.nome }))
  if (resto) fatias.push({ valor: resto, cor: OUTROS, rotulo: 'Demais partidos' })

  let bancada = ''
  if (eleitos.length) {
    const ordem = new Map(grupos.map((g, i) => [g.nome, i]))
    const ordenados = [...eleitos].sort((a, b) => ordem.get(a.agremiacao) - ordem.get(b.agremiacao) || b.votos - a.votos)
    const contagem = grupos.filter((g) => g.eleitos)
    bancada = `<section class="cartao">
      <h3>Bancada eleita (${eleitos.length} de ${d.vagas})</h3>
      ${hemiciclo(ordenados)}
      <ul class="legenda">${contagem
        .map((g) => `<li data-partido="${esc(g.nome)}"><i style="background:${g.cor}"></i>${esc(g.nome)} <strong>${g.eleitos}</strong></li>`)
        .join('')}</ul>
    </section>`
  } else {
    const destaque = d.candidatos.slice(0, d.vagas)
    bancada = `<section class="cartao">
      <h3>Os ${d.vagas} mais votados até agora</h3>
      <p class="nota">Ordem por votos nominais — não é a projeção das vagas, que depende do quociente eleitoral de cada partido.</p>
      <ul class="chips">${destaque
        .map(
          (c) =>
            `<li class="chip" style="${estiloCor(corPartido(c.partido))}"><strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(
              c.votos,
            )}</span></li>`,
        )
        .join('')}</ul>
    </section>`
  }

  const visoes = `<div class="segmentado" role="group" aria-label="Visão">
    <button type="button" data-visao="candidatos" aria-pressed="${estado.visao === 'candidatos'}">Candidatos</button>
    <button type="button" data-visao="partidos" aria-pressed="${estado.visao === 'partidos'}">Partidos</button>
  </div>`
  const filtros = `<div class="filtros" id="filtros">
      <button type="button" class="filtro ${estado.partido ? '' : 'ativo'}" data-partido="">Todos</button>
      ${grupos
        .filter((g) => g.votos > 0 || g.eleitos)
        .map(
          (g) =>
            `<button type="button" class="filtro ${estado.partido === g.nome ? 'ativo' : ''}" data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}"><i></i>${esc(
              g.nome,
            )}</button>`,
        )
        .join('')}
    </div>`
  const corpo =
    estado.visao === 'partidos'
      ? tabelaPartidos(d)
      : `${filtros}
         <input id="busca" type="search" placeholder="Buscar por nome, partido ou número…" value="${esc(estado.busca)}" autocomplete="off">
         <div id="lista">${listaProporcional()}</div>`
  return `${bancada}
    <section class="cartao">
      <h3>Votos por partido / federação</h3>
      ${barraEmpilhada(fatias)}
      <p class="nota">Toque numa cor para filtrar os candidatos daquele partido.</p>
    </section>
    <section class="cartao">${visoes}${corpo}</section>`
}

function renderizar() {
  const d = estado.dados
  if (!d) return
  const busca = document.activeElement?.id === 'busca'
  const pos = busca ? document.activeElement.selectionStart : null
  if (estado.aba.tipo === 'fav') {
    conteudo.innerHTML = renderFavoritos()
    return
  }
  conteudo.innerHTML =
    cabecalhoAbrangencia() +
    secaoAcompanhando(d) +
    resumo(d) +
    (estado.aba.tipo === 'maj' ? renderMajoritario(d) : renderProporcional(d)) +
    `<p class="nota centro">Dados do TSE de ${esc(d.atualizadoEm || '—')}</p>`
  if (busca) {
    const el = $('#busca')
    el?.focus()
    el?.setSelectionRange(pos, pos)
  }
}

/* ---------------- início ---------------- */

if (DEMO) {
  $('#aviso-demo').hidden = false
  $('#link-demo').hidden = true
}
if (TURNO === 2) $('.sub').textContent = 'Eleições Gerais · 2º turno · foco em Santa Catarina'
montarAbas()
carregar()
