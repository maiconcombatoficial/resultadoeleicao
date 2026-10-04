// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

import { calcularVagas } from './vagas.js?v=202610042154'
import { corPartido, corTexto } from './cores.js?v=202610042154'

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
  { id: 'favoritos', rotulo: '❤️ Acompanhados', tipo: 'fav', abrangencias: ['br'] },
  { id: 'municipios', rotulo: '📊 Municípios', tipo: 'mun', abrangencias: ['sc'] },
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

// Com município: dados/sc/sc{código TSE do município, 5 dígitos}-c{cargo}-e{eleição}-u.json
function urlResultado(aba, abr, turno, mun) {
  const ele = codigoEleicao(aba, turno)
  const c = String(aba.cargo).padStart(4, '0')
  const local = mun ? `${abr}${String(mun.cd).padStart(5, '0')}` : abr
  return `${BASE}/${CICLO}/${ele}/dados/${abr}/${local}-c${c}-e${ele.padStart(6, '0')}-u.json`
}

function urlMunicipios(ele) {
  return `${BASE}/${CICLO}/${ele}/config/mun-e${ele.padStart(6, '0')}-cm.json`
}

function urlFoto(aba, abr, sqcand, turno) {
  return `${BASE}/${CICLO}/${codigoEleicao(aba, turno)}/fotos/${abr}/${sqcand}.jpeg`
}

class NaoDivulgado extends Error {}

function normalizar(raw, aba, turno, abrPedida) {
  const carg = (raw.carg || []).find((x) => Number(x.cd) === aba.cargo) || (raw.carg || [])[0] || { agr: [] }
  const abr = abrPedida || (raw.cdabr || '').toLowerCase()
  const candidatos = []
  // Votos de legenda por partido: o TSE usa "tval" (total de votos de legenda) no arquivo -u.json.
  const legendas = new Map()
  let legendaPorPartido = false
  for (const agr of carg.agr || []) {
    const agremiacao = agr.tp === 'f' || agr.tp === 'c' ? agr.nm : ''
    for (const par of agr.par || []) {
      const campo = ['tval', 'vl', 'tvl'].find((k) => par[k] != null && par[k] !== '')
      if (campo) legendaPorPartido = true
      const chave = agremiacao || par.sg
      legendas.set(chave, (legendas.get(chave) || 0) + (campo ? num(par[campo]) : 0))
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
          dt: c.dt || '',
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
    legenda: {
      porGrupo: legendas,
      porPartido: legendaPorPartido,
      total: v.vl != null && v.vl !== '' ? num(v.vl) : null,
      somaPartidos: [...legendas.values()].reduce((a, b) => a + b, 0),
    },
    qeTSE: num(carg.qe) || null,
  }
}

// Aplica o cálculo oficial das vagas (vagas.js) sobre os votos apurados até agora.
function aplicarProjecao(d) {
  const grupos = new Map()
  for (const c of d.candidatos) {
    if (!grupos.has(c.agremiacao)) grupos.set(c.agremiacao, { nome: c.agremiacao, legenda: 0, candidatos: [] })
    grupos.get(c.agremiacao).candidatos.push(c)
  }
  for (const [nome, leg] of d.legenda?.porGrupo || []) {
    if (!grupos.has(nome)) grupos.set(nome, { nome, legenda: 0, candidatos: [] })
    grupos.get(nome).legenda += leg
  }
  const r = calcularVagas({ vagas: d.vagas, grupos: [...grupos.values()] })
  for (const c of d.candidatos) c.projecao = r.eleitos.get(c.sqcand) || null
  d.projecao = r
  return d
}

async function buscar(aba, abr, turno, signal, mun = null) {
  const d = await buscarBruto(aba, abr, turno, signal, mun)
  return aba.tipo === 'prop' && !mun ? aplicarProjecao(d) : d
}

async function buscarBruto(aba, abr, turno, signal, mun = null) {
  if (DEMO) return demo(aba, abr, mun)
  let res
  try {
    res = await fetch(urlResultado(aba, abr, turno, mun), { signal, cache: 'no-store' })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Não foi possível conectar ao TSE. Verifique sua internet (o site do TSE pode estar sobrecarregado).')
  }
  if (res.status === 404 || res.status === 403) throw new NaoDivulgado()
  if (!res.ok) throw new Error(`O TSE respondeu com erro ${res.status}. Tentando de novo em instantes.`)
  return normalizar(await res.json(), aba, turno, abr)
}

// Nomes do TSE vêm em maiúsculas: "SAO JOSE DO CEDRO" → "Sao Jose do Cedro"
function nomeBonito(nome) {
  return String(nome)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase())
    .replace(/ (D[aeo]s?|E) /g, (m) => m.toLowerCase())
}

const MUNICIPIOS_DEMO = [
  ['81051', 'Florianópolis', true], ['81795', 'Joinville'], ['80470', 'Blumenau'], ['81132', 'Chapecó'],
  ['81574', 'Itajaí'], ['80950', 'Criciúma'], ['82230', 'São José'], ['81779', 'Jaraguá do Sul'],
  ['82015', 'Palhoça'], ['81833', 'Lages'], ['80570', 'Balneário Camboriú'], ['82694', 'Tubarão'],
  ['80390', 'Biguaçu'], ['82511', 'Santo Amaro da Imperatriz'], ['81353', 'Governador Celso Ramos'],
  ['80152', 'Antônio Carlos'], ['80055', 'Águas Mornas'], ['82392', 'São Pedro de Alcântara'],
  ['82678', 'Tijucas'], ['81302', 'Garopaba'], ['82155', 'Paulo Lopes'], ['82171', 'Rancho Queimado'],
].map(([cd, nm, capital]) => ({ cd, nm, capital: !!capital }))

const municipiosCache = new Map()
// Lista de municípios de SC publicada pelo TSE (código TSE de 5 dígitos + nome). Não muda durante a eleição.
async function municipios(aba) {
  if (DEMO) return MUNICIPIOS_DEMO
  const ele = codigoEleicao(aba, TURNO)
  if (!municipiosCache.has(ele)) {
    const p = fetch(urlMunicipios(ele))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        const uf = (json.abr || []).find((a) => String(a.cd).toLowerCase() === UF)
        return (uf?.mu || [])
          .filter((m) => m.cd && m.nm)
          .map((m) => ({ cd: String(m.cd), nm: nomeBonito(m.nm), capital: /^s$/i.test(String(m.c || '')) }))
          .sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
      })
    p.catch(() => municipiosCache.delete(ele))
    municipiosCache.set(ele, p)
  }
  return municipiosCache.get(ele)
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

function demo(aba, abr, mun = null) {
  const r = aleatorio(`${aba.id}|${abr}|${mun?.cd || ''}`)
  const ciclo = 10 * 60_000
  const ritmo = mun ? 0.6 + 0.8 * aleatorio(`ritmo|${mun.cd}`)() : 1 // cada município apura num ritmo
  const p = Math.min(1, ((Date.now() % ciclo) / ciclo) * 1.15 * ritmo)
  const eleitorado = mun ? 40_000 + Math.round(r() * 400_000) : abr === 'br' ? 158_000_000 : 5_600_000
  const secoesTot = mun ? Math.round(eleitorado / 330) : abr === 'br' ? 472_000 : 16_900
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
  const legendaDemo = new Map()
  if (aba.tipo === 'prop') {
    for (const c of candidatos) legendaDemo.set(c.partido, (legendaDemo.get(c.partido) || 0) + Math.round(c.votos * (0.04 + r() * 0.08)))
  }
  const totalLegenda = [...legendaDemo.values()].reduce((a, b) => a + b, 0)
  const totalValidos = candidatos.reduce((a, c) => a + c.votos, 0)
  candidatos.forEach((c) => (c.percentual = totalValidos ? (100 * c.votos) / totalValidos : 0))
  candidatos.sort((a, b) => b.votos - a.votos)
  if (p >= 1) {
    if (aba.tipo === 'maj' && aba.cargo !== 5 && candidatos[0].percentual <= 50) {
      candidatos[0].situacao = candidatos[1].situacao = '2º turno'
    } else if (aba.tipo === 'maj') {
      candidatos.slice(0, vagas).forEach((c) => {
        c.eleito = true
        c.situacao = 'Eleito'
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
    votos: { total: Math.round(comparec), validos: totalValidos + totalLegenda, pValidos: p ? 93 : 0, brancos: Math.round(brancos), pBrancos: p ? 3 : 0, nulos: Math.round(nulos), pNulos: p ? 4 : 0 },
    candidatos,
    legenda: { porGrupo: legendaDemo, porPartido: aba.tipo === 'prop', total: totalLegenda, somaPartidos: totalLegenda },
    qeTSE: null,
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
  mun: lerJSON(`${PREFIXO}municipio:v1`, null), // município de SC escolhido ({cd, nm}) ou null = estado todo
  renderPendente: false,
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

// O município só vale quando a aba está olhando Santa Catarina.
function munAtual() {
  if (estado.aba.tipo !== 'maj' && estado.aba.tipo !== 'prop') return null
  return abrAtual() === UF ? estado.mun : null
}

function nomeLocal(d) {
  const mun = munAtual()
  if (mun) return `${mun.nm} (SC)`
  return NOMES_ABR[d.abrangencia] || d.abrangencia.toUpperCase()
}

function escolherMunicipio(mun) {
  estado.mun = mun
  gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(mun))
  estado.partido = null
  estado.dados = null
  carregar()
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
  if (!estado.dados) conteudo.innerHTML = (aba.tipo === 'fav' || aba.tipo === 'mun' ? '' : cabecalhoAbrangencia()) + `<div class="cartao vazio">Carregando ${esc(aba.rotulo)}${munAtual() ? ` em ${esc(munAtual().nm)}` : ''}…</div>`
  if (aba.tipo === 'fav') return carregarFavoritos(ctrl)
  if (aba.tipo === 'mun') return carregarPainelMunicipios(ctrl)
  const mun = munAtual()
  try {
    const dados = await buscar(aba, abr, TURNO, ctrl.signal, mun)
    if (ctrl.signal.aborted) return
    dados.mun = mun
    if (!mun) registrarHistorico(aba.id, abr, dados) // o histórico dos acompanhados é sempre do estado/país
    const anterior = estado.dados && estado.dados.abrangencia === dados.abrangencia && estado.dados.mun?.cd === mun?.cd ? estado.dados : null
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
          <p class="vazio-titulo">Resultados ainda não divulgados${mun ? ` para ${esc(mun.nm)}` : ''}</p>
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

/* ---------------- painel: % apurado por município ---------------- */

// Região Metropolitana de Florianópolis (LC estadual 495/2010): núcleo metropolitano e área de expansão.
const GRANDE_FLORIPA = [
  'Florianópolis', 'São José', 'Palhoça', 'Biguaçu', 'Santo Amaro da Imperatriz', 'Governador Celso Ramos',
  'Antônio Carlos', 'Águas Mornas', 'São Pedro de Alcântara',
]
const EXPANSAO_FLORIPA = [
  'Alfredo Wagner', 'Angelina', 'Anitápolis', 'Canelinha', 'Garopaba', 'Leoberto Leal', 'Major Gercino',
  'Nova Trento', 'Paulo Lopes', 'Rancho Queimado', 'São Bonifácio', 'São João Batista', 'Tijucas',
]
const chaveNome = (nm) => semAcento(nm).replace(/[^a-z]/g, '')
const NUCLEO = new Set(GRANDE_FLORIPA.map(chaveNome))
const EXPANSAO = new Set(EXPANSAO_FLORIPA.map(chaveNome))
const REVARRER_MS = 3 * 60_000 // demais municípios: no máximo uma consulta a cada 3 minutos
const ABA_PROGRESSO = ABAS.find((a) => a.id === 'presidente') // as seções são as mesmas para todos os cargos

// cd → { cd, nm, pst, st, ts, pc, final, semDados, t }
const progresso = new Map()
const painel = { ordem: 'regiao', busca: '', erroLista: false, carregando: 0 }

async function lerProgresso(m, signal) {
  try {
    const d = await buscar(ABA_PROGRESSO, UF, TURNO, signal, m)
    progresso.set(m.cd, {
      cd: m.cd, nm: m.nm, pst: d.secoes.percentual, st: d.secoes.totalizadas, ts: d.secoes.total,
      pc: d.eleitorado.pComparecimento, eleitores: d.eleitorado.total, final: d.final || d.secoes.percentual >= 100, t: Date.now(),
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    const antes = progresso.get(m.cd)
    progresso.set(m.cd, { ...(antes || { cd: m.cd, nm: m.nm }), semDados: !antes?.ts, erro: !(err instanceof NaoDivulgado), t: Date.now() })
  }
}

// Consulta com no máximo `n` pedidos ao mesmo tempo, para não sobrecarregar o TSE nem o celular.
async function emLotes(itens, n, fn, signal) {
  let i = 0
  const trabalhador = async () => {
    while (i < itens.length && !signal.aborted) await fn(itens[i++])
  }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador))
}

async function carregarPainelMunicipios(ctrl) {
  const { signal } = ctrl
  let lista
  try {
    lista = await municipios(ABA_PROGRESSO)
    painel.erroLista = false
  } catch {
    painel.erroLista = true
  }
  if (signal.aborted) return
  try {
    estado.dadosEstado = await buscar(ABA_PROGRESSO, UF, TURNO, signal)
  } catch (err) {
    if (err.name === 'AbortError') return
  }
  if (!lista) {
    estado.dados = { painel: true }
    renderizar()
    statusEl.textContent = 'Erro ao atualizar'
    statusEl.className = 'status erro'
    if (estado.controlador === ctrl) agendar()
    return
  }
  painel.lista = lista
  const destaque = lista.filter((m) => NUCLEO.has(chaveNome(m.nm)) || EXPANSAO.has(chaveNome(m.nm)))
  const agora = Date.now()
  const demais = lista.filter((m) => {
    if (NUCLEO.has(chaveNome(m.nm)) || EXPANSAO.has(chaveNome(m.nm))) return false
    const p = progresso.get(m.cd)
    return !p || (!p.final && agora - p.t > REVARRER_MS)
  })
  let ultimoRender = 0
  const talvezRenderizar = (forcar) => {
    if (forcar || Date.now() - ultimoRender > 1500) {
      ultimoRender = Date.now()
      estado.dados = { painel: true }
      renderizar()
    }
  }
  try {
    painel.carregando = destaque.filter((m) => !progresso.get(m.cd)?.final).length + demais.length
    await emLotes(destaque.filter((m) => !progresso.get(m.cd)?.final), 6, async (m) => {
      await lerProgresso(m, signal)
      painel.carregando--
    }, signal)
    if (signal.aborted) return
    talvezRenderizar(true)
    await emLotes(demais, 6, async (m) => {
      await lerProgresso(m, signal)
      painel.carregando--
      talvezRenderizar(false)
    }, signal)
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  }
  if (signal.aborted) return
  painel.carregando = 0
  talvezRenderizar(true)
  statusEl.textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`
  statusEl.className = 'status ok'
  if (estado.controlador === ctrl) agendar()
}

// Escala sequencial de um só matiz (verde): mais claro = pouco apurado, mais escuro = quase tudo.
function corProgresso(p) {
  if (p == null) return 'var(--linha)'
  const l = 78 - (Math.min(100, p) / 100) * 46
  return `hsl(145 62% ${l}%)`
}

function barraMun(p) {
  const pst = p?.pst
  return `<div class="pbar"><span style="width:${Math.min(100, pst || 0)}%;background:${corProgresso(pst)}"></span></div>`
}

function textoPct(p) {
  if (!p || p.semDados) return '<span class="mudo">sem dados</span>'
  if (p.pst == null) return '<span class="mudo">…</span>'
  return `${fmtPct.format(p.pst)}%${p.final ? ' ✓' : ''}`
}

function cartaoMun(m, grande = false) {
  const p = progresso.get(m.cd)
  return `<button type="button" class="mun-card ${grande ? 'grande' : ''} ${p?.final ? 'completo' : ''}" data-abrir-mun="${esc(m.cd)}" data-abrir-nm="${esc(m.nm)}">
    <span class="mun-nome">${esc(m.nm)}</span>
    <span class="mun-pct">${textoPct(p)}</span>
    ${barraMun(p)}
    ${p?.ts ? `<span class="mun-det">${fmt.format(p.st)} de ${fmt.format(p.ts)} seções${grande && p.pc != null ? ` · comparecimento ${fmtPct.format(p.pc)}%` : ''}</span>` : ''}
  </button>`
}

function renderPainelMunicipios() {
  if (painel.erroLista && !painel.lista) {
    return `<div class="cartao vazio erro"><p>Não consegui carregar a lista de municípios do TSE. Tentando de novo em instantes.</p></div>`
  }
  const lista = painel.lista || []
  const de = (set) => lista.filter((m) => set.has(chaveNome(m.nm)))
  const floripa = lista.find((m) => chaveNome(m.nm) === 'florianopolis')
  const ordemLista = (nomes) => (a, b) => nomes.findIndex((n) => chaveNome(n) === chaveNome(a.nm)) - nomes.findIndex((n) => chaveNome(n) === chaveNome(b.nm))
  const nucleo = de(NUCLEO).filter((m) => m !== floripa).sort(ordemLista(GRANDE_FLORIPA))
  const expansao = de(EXPANSAO).sort(ordemLista(EXPANSAO_FLORIPA))
  const regiao = [floripa, ...nucleo, ...expansao].filter(Boolean)
  const somaReg = regiao.reduce((a, m) => {
    const p = progresso.get(m.cd)
    if (p?.ts) { a.st += p.st; a.ts += p.ts }
    return a
  }, { st: 0, ts: 0 })

  const valores = lista.map((m) => progresso.get(m.cd)).filter((p) => p && !p.semDados && p.pst != null)
  const faixas = [
    ['Não começou', (p) => p.pst === 0], ['Até 50%', (p) => p.pst > 0 && p.pst < 50],
    ['50% a 99%', (p) => p.pst >= 50 && p.pst < 100], ['100% apurado', (p) => p.pst >= 100],
  ].map(([rot, f], i) => ({ rot, n: valores.filter(f).length, cor: corProgresso([0, 30, 75, 100][i]) }))
  const est = estado.dadosEstado

  const termo = semAcento(painel.busca.trim())
  const ordenar = {
    regiao: (a, b) => (regiao.includes(b) - regiao.includes(a)) || a.nm.localeCompare(b.nm, 'pt-BR'),
    nome: (a, b) => a.nm.localeCompare(b.nm, 'pt-BR'),
    mais: (a, b) => (progresso.get(b.cd)?.pst ?? -1) - (progresso.get(a.cd)?.pst ?? -1) || a.nm.localeCompare(b.nm, 'pt-BR'),
    menos: (a, b) => (progresso.get(a.cd)?.pst ?? 101) - (progresso.get(b.cd)?.pst ?? 101) || a.nm.localeCompare(b.nm, 'pt-BR'),
  }[painel.ordem]
  const linhas = lista.filter((m) => !termo || semAcento(m.nm).includes(termo)).sort(ordenar)

  return `
    <section class="cartao resumo">
      <div class="resumo-titulo"><h2>Apuração por município · SC</h2>
        <span class="selo">${painel.carregando > 0 ? `Consultando ${painel.carregando}…` : `${lista.length} municípios`}</span></div>
      ${est ? `<div class="progresso"><div class="progresso-barra" style="width:${Math.min(100, est.secoes.percentual)}%"></div></div>
        <p class="progresso-texto"><strong>${fmtPct.format(est.secoes.percentual)}%</strong> das seções de Santa Catarina
        <span class="mudo">(${fmt.format(est.secoes.totalizadas)} de ${fmt.format(est.secoes.total)})</span></p>` : ''}
      <div class="faixas">${faixas.map((f) => `<div class="faixa" style="--c:${f.cor}"><strong>${f.n}</strong><span>${f.rot}</span></div>`).join('')}</div>
    </section>

    <section class="cartao destaque-floripa">
      <h3>📍 Grande Florianópolis</h3>
      ${somaReg.ts ? `<p class="nota">Região toda: <strong>${fmtPct.format((100 * somaReg.st) / somaReg.ts)}%</strong> das seções (${fmt.format(somaReg.st)} de ${fmt.format(somaReg.ts)})</p>` : ''}
      ${floripa ? cartaoMun(floripa, true) : ''}
      <div class="mun-grade">${nucleo.map((m) => cartaoMun(m)).join('')}</div>
      ${expansao.length ? `<h4>Área de expansão metropolitana</h4><div class="mun-grade">${expansao.map((m) => cartaoMun(m)).join('')}</div>` : ''}
      <p class="nota">Toque num município para ver os votos dele. Atualiza a cada 30 segundos.</p>
    </section>

    <section class="cartao">
      <h3>Todos os municípios</h3>
      <input id="busca-mun" type="search" placeholder="Buscar município…" value="${esc(painel.busca)}" autocomplete="off">
      <div class="segmentado ordem" role="group" aria-label="Ordenar">
        ${[['regiao', 'Região primeiro'], ['mais', 'Mais apurados'], ['menos', 'Menos apurados'], ['nome', 'A–Z']]
          .map(([k, r]) => `<button type="button" data-ordem="${k}" aria-pressed="${painel.ordem === k}">${r}</button>`)
          .join('')}
      </div>
      <ul class="mun-lista">${linhas
        .map((m) => {
          const p = progresso.get(m.cd)
          return `<li><button type="button" class="${regiao.includes(m) ? 'regiao' : ''}" data-abrir-mun="${esc(m.cd)}" data-abrir-nm="${esc(m.nm)}">
            <span class="mun-nome">${esc(m.nm)}${m.capital ? ' <span class="mudo">· capital</span>' : ''}</span>
            ${barraMun(p)}
            <span class="mun-pct">${textoPct(p)}</span></button></li>`
        })
        .join('')}</ul>
      <p class="nota">Os demais municípios são consultados a cada 3 minutos; os que chegam a 100% param de ser consultados.</p>
    </section>`
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
  const atual = abrAtual()
  const seg =
    a.abrangencias.length < 2
      ? ''
      : `<div class="segmentado" role="group" aria-label="Abrangência">
    ${a.abrangencias
      .map((abr) => `<button type="button" data-abr="${abr}" aria-pressed="${abr === atual}">${esc(NOMES_ABR[abr] || abr.toUpperCase())}</button>`)
      .join('')}
  </div>`
  if (atual !== UF) return seg
  const mun = estado.mun
  return `${seg}<div class="local ${mun ? 'com-mun' : ''}">
    <span class="local-icone" aria-hidden="true">📍</span>
    <div class="local-campo">
      <input id="mun-busca" type="search" autocomplete="off" enterkeyhint="search"
        placeholder="Santa Catarina inteira · digite um município" value="${esc(mun?.nm || '')}" aria-label="Escolher município de SC">
      ${mun ? '<button type="button" class="local-limpar" data-mun-limpar aria-label="Voltar para o estado todo">✕</button>' : ''}
      <ul id="mun-sugestoes" class="sugestoes" hidden></ul>
    </div>
  </div>`
}

async function mostrarSugestoes() {
  const ul = $('#mun-sugestoes')
  const input = $('#mun-busca')
  if (!ul || !input) return
  let lista
  try {
    lista = await municipios(estado.aba)
  } catch {
    ul.innerHTML = '<li class="sug-info">Não consegui carregar a lista de municípios do TSE. Tente de novo em instantes.</li>'
    ul.hidden = false
    return
  }
  const termo = semAcento(input.value.trim())
  const achados = (termo && termo !== semAcento(estado.mun?.nm || '') ? lista.filter((m) => semAcento(m.nm).includes(termo)) : lista)
    .sort((a, b) => {
      const ia = semAcento(a.nm).startsWith(termo) ? 0 : 1
      const ib = semAcento(b.nm).startsWith(termo) ? 0 : 1
      return ia - ib || a.nm.localeCompare(b.nm, 'pt-BR')
    })
    .slice(0, 40)
  ul.innerHTML =
    `<li><button type="button" data-mun-limpar class="sug-estado">🗺️ Santa Catarina inteira</button></li>` +
    (achados.length
      ? achados
          .map((m) => `<li><button type="button" data-mun-cd="${esc(m.cd)}" data-mun-nm="${esc(m.nm)}">${esc(m.nm)}${m.capital ? ' <span class="mudo">· capital</span>' : ''}</button></li>`)
          .join('')
      : `<li class="sug-info">Nenhum município encontrado para “${esc(input.value)}”.</li>`)
  ul.hidden = false
}

function fecharSugestoes() {
  const ul = $('#mun-sugestoes')
  if (ul) ul.hidden = true
  if (estado.renderPendente) {
    estado.renderPendente = false
    renderizar()
  }
}

conteudo.addEventListener('focusin', (ev) => {
  if (ev.target.id === 'mun-busca') {
    ev.target.select()
    mostrarSugestoes()
  }
})
conteudo.addEventListener('focusout', (ev) => {
  if (ev.target.id === 'mun-busca') setTimeout(() => {
    if (!document.activeElement?.closest?.('.local')) fecharSugestoes()
  }, 150)
})
conteudo.addEventListener('keydown', (ev) => {
  if (ev.target.id !== 'mun-busca') return
  if (ev.key === 'Escape') ev.target.blur()
  if (ev.key === 'Enter') {
    ev.preventDefault()
    $('#mun-sugestoes [data-mun-cd]')?.click()
  }
})

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
      if (!estado.dados.mun) registrarHistorico(abaId, abr, estado.dados)
    }
    montarAbas()
    renderizar()
    return
  }
  const abrirMun = ev.target.closest('[data-abrir-mun]')
  if (abrirMun) {
    estado.mun = { cd: abrirMun.dataset.abrirMun, nm: abrirMun.dataset.abrirNm }
    gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(estado.mun))
    estado.abr.presidente = UF
    trocarAba('presidente')
    window.scrollTo({ top: 0 })
    return
  }
  const ordemBtn = ev.target.closest('[data-ordem]')
  if (ordemBtn) {
    painel.ordem = ordemBtn.dataset.ordem
    renderizar()
    return
  }
  const munBtn = ev.target.closest('[data-mun-cd]')
  if (munBtn) {
    escolherMunicipio({ cd: munBtn.dataset.munCd, nm: munBtn.dataset.munNm })
    return
  }
  if (ev.target.closest('[data-mun-limpar]')) {
    escolherMunicipio(null)
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
  if (ev.target.id === 'mun-busca') {
    mostrarSugestoes()
    return
  }
  if (ev.target.id === 'busca-mun') {
    painel.busca = ev.target.value
    renderizar()
    return
  }
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
  const local = nomeLocal(d)
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
  if (c.projecao)
    return `<span class="tag eleito-proj" title="Pelo cálculo do TSE (quociente eleitoral, legenda e sobras) com os votos apurados até agora"><b>★ Eleito</b><small>${esc(
      c.projecao.forma === 'QP' ? 'QP' : c.projecao.forma === 'média' ? 'média' : c.projecao.forma,
    )} · projeção</small></span>`
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
    aria-pressed="${on}" aria-label="${on ? 'Deixar de acompanhar' : 'Acompanhar'} ${esc(c.nome)}" title="${on ? 'Deixar de acompanhar' : 'Acompanhar este candidato'}">${on ? '♥' : '♡'}</button>`
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
  if (!situacao && aba?.tipo === 'prop' && d.projecao?.qe) {
    const g = d.projecao.grupos.find((x) => x.nome === c.agremiacao)
    const ultimo = g?.eleitos[g.eleitos.length - 1]
    situacao = ultimo
      ? `<span class="tag fora">Fora da projeção · ${fmt.format(Math.max(0, ultimo.votos - c.votos))} votos atrás do último eleito do partido</span>`
      : `<span class="tag fora">Fora da projeção · partido sem vaga até agora</span>`
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
  if (munAtual()) return ''
  const meus = favoritos.filter((f) => f.aba === estado.aba.id && f.abr === abr)
  if (!meus.length) return ''
  return `<section class="cartao acompanhando">
    <h3>❤️ Acompanhando</h3>
    <div class="favs">${meus.map((f) => cardFavorito(f, d)).join('')}</div>
  </section>`
}

function renderFavoritos() {
  if (!favoritos.length) {
    return `<div class="cartao vazio">
      <p class="vazio-titulo">❤️ Nenhum candidato acompanhado ainda</p>
      <p>Toque no coração <span class="estrela-exemplo">♡</span> ao lado de qualquer candidato, em qualquer aba, para acompanhar aqui a posição, os votos e a evolução dele durante a apuração.</p>
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
  const proj = d.projecao
  for (const g of lista) {
    const pg = proj?.grupos.find((x) => x.nome === g.nome)
    g.legenda = pg?.legenda || 0
    g.total = g.votos + g.legenda
    g.qp = pg?.qp || 0
    g.porQP = pg?.porQP || 0
    g.porMedia = pg?.porMedia || 0
    g.vagasProj = pg ? pg.eleitos.length : 0
  }
  return lista.sort((a, b) => b.total - a.total || b.eleitos - a.eleitos)
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
        return `<tr class="${c.eleito ? 'is-eleito' : c.projecao ? 'is-proj' : ''} ${ganho(c) > 0 ? 'subiu' : ''}" style="${estiloCor(cor)}">
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
  const total = lista.reduce((a, g) => a + g.total, 0) || 1
  const max = Math.max(1, ...lista.map((g) => g.total))
  const comProj = !!d.projecao?.qe
  return `<p class="nota">Votos de cada partido ou federação: nominais + legenda.${comProj ? ' "Vagas" é a projeção pelo cálculo do TSE.' : ''}
    Toque numa linha para ver os candidatos dela.</p>
    <table class="tabela">
    <thead><tr><th>Partido / federação</th><th class="dir">Votos</th><th class="dir">%</th><th class="dir">${comProj ? 'Vagas' : 'Eleitos'}</th></tr></thead>
    <tbody>
    ${lista
      .map(
        (g) => `<tr class="clicavel" data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}">
        <td><div class="cand-linha">${pill(g.nome, g.cor)}</div>
          <div class="cand-meta">${g.partidos.length > 1 || g.partidos[0] !== g.nome ? esc(g.partidos.join(', ')) + ' · ' : ''}${g.cands} candidatos${
            g.legenda ? ` · legenda ${fmt.format(g.legenda)}` : ''
          }</div>
          <div class="barra fina"><span style="width:${(100 * g.total) / max}%"></span></div></td>
        <td class="dir">${fmt.format(g.total)}</td>
        <td class="dir">${fmtPct.format((100 * g.total) / total)}</td>
        <td class="dir"><strong>${comProj ? g.vagasProj || '—' : g.eleitos || '—'}</strong></td>
      </tr>`,
      )
      .join('')}
    </tbody></table>`
}

// Quadro com o passo a passo do cálculo das vagas.
function cartaoCalculo(d) {
  const r = d.projecao
  const L = d.legenda || {}
  const avisos = []
  if (!L.porPartido && L.total)
    avisos.push('O arquivo do TSE não trouxe os votos de legenda separados por partido; o cálculo está usando só os votos nominais e pode diferir do oficial.')
  else if (L.porPartido && L.total != null && Math.abs(L.somaPartidos - L.total) > Math.max(10, L.total * 0.005))
    avisos.push(`A soma dos votos de legenda por partido (${fmt.format(L.somaPartidos)}) não bate com o total do TSE (${fmt.format(L.total)}). Confira com o site oficial.`)
  if (d.qeTSE && d.qeTSE !== r.qe) avisos.push(`O TSE informa quociente eleitoral de ${fmt.format(d.qeTSE)}.`)
  if (r.semQuociente) avisos.push('Nenhum partido atingiu o quociente eleitoral: elegem-se os mais votados (art. 111).')
  const linhas = estado.grupos.filter((g) => g.total >= 0.8 * r.qe || g.vagasProj)
  return `<section class="cartao calculo">
    <details>
      <summary><strong>Como as ${d.vagas} vagas foram calculadas</strong> <span class="mudo">· toque para ver</span></summary>
      <div class="calc-num">
        <div><span>Votos válidos</span><strong>${fmt.format(r.validos)}</strong><small>nominais + legenda</small></div>
        <div><span>Quociente eleitoral</span><strong>${fmt.format(r.qe)}</strong><small>válidos ÷ ${d.vagas} vagas</small></div>
        <div><span>Votos de legenda</span><strong>${fmt.format(L.somaPartidos || 0)}</strong><small>${L.porPartido ? 'por partido, do TSE' : 'não informados'}</small></div>
        <div><span>Partido precisa de</span><strong>${fmt.format(Math.ceil(0.8 * r.qe))}</strong><small>80% do QE, para disputar sobras</small></div>
        <div><span>Candidato: vaga por QP</span><strong>${fmt.format(Math.ceil(0.1 * r.qe))}</strong><small>10% do QE</small></div>
        <div><span>Candidato: sobras</span><strong>${fmt.format(Math.ceil(0.2 * r.qe))}</strong><small>20% do QE (2ª fase)</small></div>
      </div>
      ${avisos.map((a) => `<p class="aviso-calc">⚠️ ${esc(a)}</p>`).join('')}
      <table class="tabela">
        <thead><tr><th>Partido / federação</th><th class="dir">Votos</th><th class="dir">QP</th><th class="dir">Sobras</th><th class="dir">Vagas</th></tr></thead>
        <tbody>${linhas
          .map(
            (g) => `<tr style="${estiloCor(g.cor)}"><td>${pill(g.nome, g.cor)}<div class="cand-meta">${fmtPct.format((100 * g.total) / r.qe)}% do QE</div></td>
            <td class="dir">${fmt.format(g.total)}</td><td class="dir">${g.porQP}</td><td class="dir">${g.porMedia}</td><td class="dir"><strong>${g.vagasProj}</strong></td></tr>`,
          )
          .join('')}</tbody>
      </table>
      <ol class="regras">
        <li><strong>Quociente eleitoral</strong>: votos válidos ÷ vagas (fração acima de 0,5 arredonda para cima).</li>
        <li><strong>Quociente partidário (QP)</strong>: votos do partido/federação ÷ QE, sem a fração. Essas vagas vão aos mais votados da legenda com pelo menos 10% do QE.</li>
        <li><strong>Sobras</strong>: vaga a vaga, para a maior média (votos ÷ (vagas já obtidas + 1)) entre partidos com 80% do QE e candidatos com 20% do QE.</li>
        <li><strong>Sobras finais</strong>: se ninguém mais cumprir essas exigências, todos os partidos e candidatos disputam pela maior média (decisão do STF de 2024).${
          r.fase3 ? ` <em>${r.fase3} vaga(s) nesta fase.</em>` : ''
        }</li>
      </ol>
      <p class="nota">Base legal: Código Eleitoral, arts. 106 a 111, com a Lei 14.211/2021 e o STF (ADIs 7228, 7263 e 7325). Federações contam como um partido só.</p>
    </details>
  </section>`
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
  const mun = munAtual()
  if (mun) {
    const top = d.candidatos.filter((c) => c.votos > 0).slice(0, 10)
    bancada = `<section class="cartao">
      <h3>Mais votados em ${esc(mun.nm)}</h3>
      <p class="nota">Votos dados neste município. A eleição de deputados é estadual: as ${d.vagas} vagas dependem dos votos em toda Santa Catarina.</p>
      <ol class="chips ranking">${top
        .map(
          (c, i) =>
            `<li class="chip" style="${estiloCor(corPartido(c.partido))}"><span class="mudo">${i + 1}º</span> <strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(
              c.votos,
            )}</span></li>`,
        )
        .join('')}</ol>
    </section>`
  } else if (eleitos.length) {
    const ordem = new Map(grupos.map((g, i) => [g.nome, i]))
    const ordenados = [...eleitos].sort((a, b) => ordem.get(a.agremiacao) - ordem.get(b.agremiacao) || b.votos - a.votos)
    const contagem = grupos.filter((g) => g.eleitos)
    bancada = `<section class="cartao">
      <h3>Bancada eleita (${eleitos.length} de ${d.vagas})</h3>
      ${hemiciclo(ordenados)}
      <ul class="legenda">${contagem
        .map((g) => `<li data-partido="${esc(g.nome)}"><i style="background:${g.cor}"></i>${esc(g.nome)} <strong>${g.eleitos}</strong></li>`)
        .join('')}</ul>
    </section>
    ${d.projecao?.qe ? cartaoCalculo(d) : ''}`
  } else if (d.projecao?.qe) {
    const proj = d.candidatos.filter((c) => c.projecao)
    const ordem = new Map(grupos.map((g, k) => [g.nome, k]))
    const ordenados = [...proj].sort((a, b) => ordem.get(a.agremiacao) - ordem.get(b.agremiacao) || b.votos - a.votos)
    bancada = `<section class="cartao bancada-proj">
      <h3>★ Eleitos pela projeção (${proj.length} de ${d.vagas})</h3>
      <p class="nota">Cálculo do TSE (quociente eleitoral, votos de legenda e sobras) aplicado aos votos apurados até agora:
        <strong>${fmtPct.format(d.secoes.percentual)}% das seções</strong>. Muda conforme a apuração avança; o resultado oficial é o do TSE.</p>
      ${hemiciclo(ordenados)}
      <ul class="legenda">${grupos
        .filter((g) => g.vagasProj)
        .map((g) => `<li data-partido="${esc(g.nome)}"><i style="background:${g.cor}"></i>${esc(g.nome)} <strong>${g.vagasProj}</strong></li>`)
        .join('')}</ul>
      <ul class="chips">${[...proj]
        .sort((a, b) => a.projecao.ordem - b.projecao.ordem)
        .map(
          (c) =>
            `<li class="chip" style="${estiloCor(corPartido(c.partido))}"><strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(c.votos)} · ${
              c.projecao.forma === 'QP' ? 'QP' : 'média'
            }</span></li>`,
        )
        .join('')}</ul>
    </section>
    ${cartaoCalculo(d)}`
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
  if (document.activeElement?.id === 'mun-busca') {
    estado.renderPendente = true
    return
  }
  const busca = document.activeElement?.id === 'busca'
  const pos = busca ? document.activeElement.selectionStart : null
  if (estado.aba.tipo === 'fav') {
    conteudo.innerHTML = renderFavoritos()
    return
  }
  if (estado.aba.tipo === 'mun') {
    const busca = document.activeElement?.id === 'busca-mun'
    const pos = busca ? document.activeElement.selectionStart : null
    conteudo.innerHTML = renderPainelMunicipios()
    if (busca) {
      const el = $('#busca-mun')
      el?.focus()
      el?.setSelectionRange(pos, pos)
    }
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
