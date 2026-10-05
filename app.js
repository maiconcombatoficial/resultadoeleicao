// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

import { calcularVagas } from './vagas.js?v=202610050336'
import { chanceDe, NIVEIS } from './chances.js?v=202610050336'
import { MESORREGIOES, MICRORREGIOES, MUNICIPIOS_SC } from './regioes.js?v=202610050336'
import { FLORIPA } from './floripa.js?v=202610050336'
import { corPartido, corTexto } from './cores.js?v=202610050336'

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
  { id: 'h2022', rotulo: '📅 2022', tipo: 'h22', abrangencias: ['sc'] },
  { id: 'presidente', rotulo: 'Presidente', cargo: 1, eleicao: 'federal', tipo: 'maj', abrangencias: ['br', UF] },
  { id: 'senador', rotulo: 'Senado SC', cargo: 5, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF], turno1: true },
  { id: 'depfed', rotulo: 'Dep. Federal SC', cargo: 6, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'depest', rotulo: 'Dep. Estadual SC', cargo: 7, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'governador', rotulo: 'Governador SC', cargo: 3, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF] },
  { id: 'sobre', rotulo: 'ℹ️ Sobre', tipo: 'sobre', abrangencias: ['br'] },
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
  const local = mun ? `${abr}${String(mun.cd).padStart(5, '0')}${mun.zona ? `-z${String(mun.zona).padStart(4, '0')}` : ''}` : abr
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

/* ---------------- regiões de SC ---------------- */

const POP = new Map(MUNICIPIOS_SC.map(([cd, , , pop]) => [cd, pop]))
const MUN_REG = new Map(MUNICIPIOS_SC.map(([cd, , nm, pop, meso, micro]) => [cd, { cd, nm, pop, meso, micro }]))

function regiao(id) {
  const [tipo, cod] = String(id).split(':')
  const nome = tipo === 'meso' ? MESORREGIOES[cod] : MICRORREGIOES[cod]
  if (!nome) return null
  const membros = MUNICIPIOS_SC.filter((m) => (tipo === 'meso' ? m[4] : m[5]) === cod).map(([cd, , nm]) => ({ cd, nm }))
  return { regiao: id, nm: tipo === 'meso' ? `Região ${nome}` : `Microrregião de ${nome}`, membros }
}

// Soma os resultados dos municípios de uma região (o TSE não publica arquivo por região).
async function buscarRegiao(aba, turno, signal, reg) {
  const partes = []
  estado.progressoRegiao = { feitos: 0, total: reg.membros.length }
  await emLotes(reg.membros, 6, async (m) => {
    try {
      partes.push(await buscarBruto(aba, UF, turno, signal, m))
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
    estado.progressoRegiao.feitos++
    const el = document.getElementById('progresso-regiao')
    if (el) el.textContent = `${estado.progressoRegiao.feitos} de ${estado.progressoRegiao.total} municípios`
  }, signal)
  if (signal?.aborted) throw new DOMException('abortado', 'AbortError')
  if (!partes.length) throw new NaoDivulgado()
  const base = partes[0]
  const soma = (f) => partes.reduce((a, d) => a + (f(d) || 0), 0)
  const votosPor = new Map()
  for (const d of partes) for (const c of d.candidatos) votosPor.set(c.sqcand, (votosPor.get(c.sqcand) || 0) + c.votos)
  const validos = soma((d) => d.votos.validos)
  const candidatos = base.candidatos.map((c) => {
    const votos = votosPor.get(c.sqcand) || 0
    return { ...c, votos, pvap: null, percentual: validos ? (100 * votos) / validos : 0 }
  })
  candidatos.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'))
  const ts = soma((d) => d.secoes.total), st = soma((d) => d.secoes.totalizadas)
  const te = soma((d) => d.eleitorado.total), comp = soma((d) => d.eleitorado.comparecimento), abst = soma((d) => d.eleitorado.abstencao)
  const tot = soma((d) => d.votos.total), br = soma((d) => d.votos.brancos), nu = soma((d) => d.votos.nulos)
  const pc = (a, b) => (b ? (100 * a) / b : null)
  return {
    ...base,
    abrangencia: UF,
    atualizadoEm: partes.map((d) => d.atualizadoEm).sort().pop(),
    final: partes.length === reg.membros.length && partes.every((d) => d.final),
    secoes: { total: ts, totalizadas: st, percentual: pc(st, ts) || 0 },
    eleitorado: { total: te, comparecimento: comp, pComparecimento: pc(comp, te), abstencao: abst, pAbstencao: pc(abst, te) },
    votos: { total: tot, validos, pValidos: pc(validos, tot), brancos: br, pBrancos: pc(br, tot), nulos: nu, pNulos: pc(nu, tot) },
    candidatos,
    legenda: null,
    regiaoInfo: { municipios: reg.membros.length, comDados: partes.length },
  }
}

async function buscar(aba, abr, turno, signal, mun = null) {
  const d = mun?.regiao ? await buscarRegiao(aba, turno, signal, mun) : await buscarBruto(aba, abr, turno, signal, mun)
  const out = aba.tipo === 'prop' && !mun ? aplicarProjecao(d) : d
  if (DEMO && out.final && out.projecao) {
    // demonstração: no fim, simula a marcação oficial do TSE com o próprio cálculo
    for (const c of out.candidatos) {
      c.eleito = !!c.projecao
      c.situacao = c.projecao ? (c.projecao.forma === 'QP' ? 'Eleito por QP' : 'Eleito por média') : c.votos > 0 ? 'Suplente' : 'Não eleito'
    }
  }
  marcarDefinicaoTSE(out)
  return out
}

// O resultado está definido pelo TSE quando a totalização é final ou o TSE já marcou todos os eleitos.
function marcarDefinicaoTSE(d) {
  const eleitos = d.candidatos.filter((c) => c.eleito).length
  d.tseDefinido = d.final || eleitos >= d.vagas
  d.eleitosTSE = eleitos
  for (const c of d.candidatos) c.tseDefinido = d.tseDefinido
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
].map(([cd, nm, capital]) => ({ cd, nm, capital: !!capital, zonas: capital ? ['0012', '0013', '0100'] : cd === '81795' ? ['0019', '0095', '0096'] : [String(10 + (Number(cd) % 90)).padStart(4, '0')] }))

const municipiosCache = new Map()
const municipiosProntos = new Map() // eleição → lista já carregada (para uso síncrono)
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
          .map((m) => ({ cd: String(m.cd), nm: nomeBonito(m.nm), capital: /^s$/i.test(String(m.c || '')), zonas: (m.z || []).map((z) => String(z).padStart(4, '0')) }))
          .sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
      })
    p.then((lista) => municipiosProntos.set(ele, lista)).catch(() => {})
    // sem a lista do TSE, usa a lista própria dos 295 municípios (códigos TSE, sem as zonas) e tenta de novo depois
    const comReserva = p.catch(() => {
      municipiosCache.delete(ele)
      return MUNICIPIOS_SC.map(([cd, , nm]) => ({ cd, nm, capital: cd === '81051', zonas: [] })).sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
    })
    municipiosCache.set(ele, comReserva)
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
  const r = aleatorio(`${aba.id}|${abr}|${mun?.cd || ''}|${mun?.zona || ''}`)
  const ciclo = 10 * 60_000
  const ritmo = mun ? 0.6 + 0.8 * aleatorio(`ritmo|${mun.cd}`)() : 1 // cada município apura num ritmo
  const p = Math.min(1, ((Date.now() % ciclo) / ciclo) * 1.15 * ritmo)
  const eleitorado = mun?.zona ? 20_000 + Math.round(r() * 120_000) : mun ? 40_000 + Math.round(r() * 400_000) : abr === 'br' ? 158_000_000 : 5_600_000
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
      serie.push([pst, c.votos, Date.now(), Math.round(c.percentual * 1000) / 1000, dados.candidatos.indexOf(c) + 1])
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
  if (mun?.regiao) return `${mun.nm} (${mun.membros.length} municípios)`
  if (mun) return `${mun.nm} (SC)${mun.zona ? ` · ${Number(mun.zona)}ª zona` : ''}`
  return NOMES_ABR[d.abrangencia] || d.abrangencia.toUpperCase()
}

/* ---------------- Florianópolis: bairros por zona ---------------- */

const FLORIPA_CD = '81051'
const z4 = (z) => String(z).padStart(4, '0')
// apelido de cada zona, resumindo os bairros que ela abrange (lista do TRE-SC)
const ROTULO_ZONA = { '0012': 'Centro e Continente', '0013': 'Leste e Sul da Ilha', '0100': 'Norte da Ilha' }
function infoZonaFloripa(z) {
  const k = z4(z)
  const zz = String(Number(z))
  const bairros = FLORIPA.zonas[zz]?.bairros || []
  const locais = FLORIPA.locais.filter((l) => l.z === zz)
  return { rotulo: ROTULO_ZONA[k] || '', bairros, locais, eleitores: locais.reduce((a, l) => a + l.eleitores, 0), secoes: locais.reduce((a, l) => a + l.secoes.length, 0) }
}
// bairro → zona (lista oficial + bairros dos endereços dos locais)
const BAIRROS_FLORIPA = (() => {
  const m = new Map()
  for (const [z, { bairros }] of Object.entries(FLORIPA.zonas)) for (const b of bairros) m.set(b, z4(z))
  for (const l of FLORIPA.locais) if (l.bairro && !m.has(l.bairro)) m.set(l.bairro, z4(l.z))
  return [...m.entries()].map(([nome, zona]) => ({ nome, zona })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
})()

function quadroZonaFloripa(mun) {
  if (!mun || mun.cd !== FLORIPA_CD || mun.regiao) return ''
  if (!mun.zona)
    return `<div class="zona-info"><p class="nota">Florianópolis tem 3 zonas eleitorais: ${Object.keys(ROTULO_ZONA)
      .map((z) => `<strong>${Number(z)}ª</strong> (${ROTULO_ZONA[z]})`)
      .join(', ')}. Toque numa zona para ver os bairros e os locais de votação, ou busque o bairro abaixo.</p>${buscaBairro()}</div>`
  const info = infoZonaFloripa(mun.zona)
  const aberto = estado.locaisAbertos
  return `<div class="zona-info">
    <p><strong>${Number(mun.zona)}ª zona · ${esc(info.rotulo)}</strong> <span class="mudo">· ${info.locais.length} locais · ${fmt.format(info.secoes)} seções · ${fmt.format(info.eleitores)} eleitores (2022)</span></p>
    <p class="zona-bairros">🏘️ ${info.bairros.map((b) => esc(b)).join(' · ')}</p>
    <button type="button" class="link-zonas" data-ver-locais>${aberto ? 'Esconder locais de votação ▴' : `Ver os ${info.locais.length} locais de votação ▾`}</button>
    ${aberto ? `<ul class="locais">${[...info.locais].sort((a, b) => b.eleitores - a.eleitores).map((l) => `<li><strong>${esc(l.local)}</strong><span class="mudo">${esc(l.bairro || 'bairro não informado')} · ${l.secoes.length} seções · ${fmt.format(l.eleitores)} eleitores</span></li>`).join('')}</ul>` : ''}
    ${buscaBairro()}
  </div>`
}

function buscaBairro() {
  const termo = semAcento((estado.buscaBairro || '').trim())
  const achados = termo ? BAIRROS_FLORIPA.filter((b) => semAcento(b.nome).includes(termo)).slice(0, 12) : []
  return `<div class="busca-bairro">
    <input id="bairro-busca" type="search" autocomplete="off" placeholder="🏘️ Em qual zona fica o bairro…? (ex.: Campeche)" value="${esc(estado.buscaBairro || '')}">
    ${termo ? `<div class="atalhos-chips">${achados.length ? achados.map((b) => `<button type="button" class="atalho" data-zona="${b.zona}">${esc(b.nome)} → ${Number(b.zona)}ª zona</button>`).join('') : '<span class="nota">Bairro não encontrado na lista do TRE-SC.</span>'}</div>` : ''}
  </div>`
}

function zonasDe(mun) {
  if (!mun) return []
  const lista = municipiosProntos.get(codigoEleicao(estado.aba, TURNO)) || (DEMO ? MUNICIPIOS_DEMO : null)
  return lista?.find((m) => m.cd === mun.cd)?.zonas || []
}

function escolherZona(zona) {
  estado.mun = { ...estado.mun, zona: zona || undefined }
  gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(estado.mun))
  estado.dados = null
  carregar()
}

function escolherMunicipio(mun) {
  if (mun) estado.atalhos = false
  estado.mun = mun
  gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(mun))
  estado.partido = null
  estado.dados = null
  carregar()
}

function montarAbas() {
  $('#abas').innerHTML = ABAS.filter((a) => a.tipo !== 'h22' || PREF.mostrar2022).map(
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
  if (!estado.dados) conteudo.innerHTML = (['fav', 'mun', 'h22', 'sobre'].includes(aba.tipo) ? '' : cabecalhoAbrangencia()) + `<div class="cartao vazio">Carregando ${esc(aba.rotulo)}${munAtual() ? ` em ${esc(munAtual().nm)}` : ''}…${munAtual()?.regiao ? '<br><small id="progresso-regiao" class="mudo"></small>' : ''}</div>`
  if (aba.tipo === 'fav') return carregarFavoritos(ctrl)
  if (aba.tipo === 'mun') return carregarPainelMunicipios(ctrl)
  if (aba.tipo === 'h22') {
    if (!PREF.mostrar2022) return trocarAba('presidente')
    return carregar2022(ctrl)
  }
  if (aba.tipo === 'sobre') {
    estado.dados = { sobre: true }
    renderizar()
    statusEl.textContent = 'Sobre o app'
    statusEl.className = 'status ok'
    return
  }
  const mun = munAtual()
  try {
    const dados = await buscar(aba, abr, TURNO, ctrl.signal, mun)
    if (ctrl.signal.aborted) return
    dados.mun = mun
    if (!mun) registrarHistorico(aba.id, abr, dados) // o histórico dos acompanhados é sempre do estado/país
    registrarSessao(aba.id, abr, mun, dados)
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
      registrarSessao(abaId, abr, null, dados)
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
  const intervalo = munAtual()?.regiao ? Math.max(INTERVALO_MS, 120_000) : INTERVALO_MS
  estado.timer = setTimeout(() => {
    if (document.hidden) agendar()
    else carregar()
  }, intervalo)
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !estado.dados?.final) carregar()
})

/* ---------------- renderização ---------------- */

const OUTROS = '#9aa5a0'

function estiloCor(cor) {
  return `--cor:${cor};--cor-txt:${corTexto(cor)}`
}

// "FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL" → "FE BRASIL"; "Federação PSDB Cidadania" → "PSDB Cidadania"
function nomeCurto(nome) {
  const n = String(nome || '')
  if (!/^federa/i.test(n)) return n
  const sigla = n.split(/\s+-\s+/)[1]
  return sigla || n.replace(/^federa[çc][ãa]o\s+/i, '')
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
        placeholder="SC inteira · buscar município" value="${esc(mun?.nm || '')}" aria-label="Escolher município de SC">
      ${mun ? '<button type="button" class="local-limpar" data-mun-limpar aria-label="Voltar para o estado todo">✕</button>' : ''}
      <ul id="mun-sugestoes" class="sugestoes" hidden></ul>
    </div>
  </div>${seletorZonas(mun)}${atalhosLocal(mun)}`
}

const chip = (cd, nm, ativo) => `<button type="button" class="atalho ${ativo ? 'ativo' : ''}" data-mun-cd="${esc(cd)}" data-mun-nm="${esc(nm)}">${esc(nm)}</button>`

function atalhosLocal(mun) {
  // fechado por padrão; o app lembra se a pessoa deixou aberto
  const aberto = estado.atalhos ?? lerLocal('atalhos:v1', '0') === '1'
  if (!aberto) return `<button type="button" class="atalhos-toggle" data-atalhos="1" aria-expanded="false">⚡ Mostrar cidades e regiões <span aria-hidden="true">▾</span></button>`
  const ativo = (cd) => mun && !mun.regiao && mun.cd === cd
  const gf = GRANDE_FLORIPA.map((nm) => MUNICIPIOS_SC.find((m) => chaveNome(m[2]) === chaveNome(nm))).filter(Boolean)
  const gfSet = new Set(gf.map((m) => m[0]))
  const maiores = MUNICIPIOS_SC.filter((m) => !gfSet.has(m[0])).slice(0, 12)
  const microsDe = (meso) => Object.keys(MICRORREGIOES).filter((mi) => MUNICIPIOS_SC.some((m) => m[4] === meso && m[5] === mi))
  return `<button type="button" class="atalhos-toggle aberto" data-atalhos="0" aria-expanded="true">⚡ Esconder cidades e regiões <span aria-hidden="true">▴</span></button>
  <div class="atalhos">
    <div class="atalhos-grupo"><span class="atalhos-rot">🏝️ Grande Florianópolis</span>
      <div class="atalhos-chips">${gf.map((m) => chip(m[0], m[2], ativo(m[0]))).join('')}
        <button type="button" class="atalho regiao ${mun?.regiao === 'micro:42016' ? 'ativo' : ''}" data-regiao="micro:42016">Σ Soma da região</button></div></div>
    <div class="atalhos-grupo"><span class="atalhos-rot">🏙️ Maiores cidades</span>
      <div class="atalhos-chips">${maiores.map((m) => chip(m[0], m[2], ativo(m[0]))).join('')}</div></div>
    <div class="atalhos-grupo"><span class="atalhos-rot">🗺️ Regiões <small>(soma dos municípios · IBGE)</small></span>
      <div class="atalhos-chips">${Object.entries(MESORREGIOES)
        .map(([cod, nome]) => `<button type="button" class="atalho regiao ${mun?.regiao === 'meso:' + cod ? 'ativo' : ''}" data-regiao="meso:${cod}">${esc(nome)}</button>`)
        .join('')}</div>
      <details class="micros" ${String(mun?.regiao || '').startsWith('micro:') && mun.regiao !== 'micro:42016' ? 'open' : ''}><summary>Microrregiões (20) ▾</summary>
        ${Object.entries(MESORREGIOES)
          .map(([cod, nome]) => `<div class="micro-grupo"><span>${esc(nome)}</span>${microsDe(cod)
            .map((mi) => `<button type="button" class="atalho regiao ${mun?.regiao === 'micro:' + mi ? 'ativo' : ''}" data-regiao="micro:${mi}">${esc(MICRORREGIOES[mi])}</button>`)
            .join('')}</div>`)
          .join('')}
      </details></div>
  </div>`
}

function seletorZonas(mun) {
  if (!mun || mun.regiao) return ''
  const zonas = zonasDe(mun)
  if (!zonas.length) {
    // a lista ainda não chegou: carrega e redesenha
    municipios(estado.aba).then(() => zonasDe(mun).length > 1 && renderizar()).catch(() => {})
    return ''
  }
  if (zonas.length < 2 && !mun.zona) return ''
  return `<div class="zonas" role="group" aria-label="Zona eleitoral">
    <span class="zonas-rot">Zona eleitoral:</span>
    <button type="button" class="filtro ${mun.zona ? '' : 'ativo'}" data-zona="">Todas</button>
    ${zonas
      .map((z) => `<button type="button" class="filtro ${mun.zona === z ? 'ativo' : ''}" data-zona="${esc(z)}">${Number(z)}ª${mun.cd === FLORIPA_CD && ROTULO_ZONA[z4(z)] ? ` · ${ROTULO_ZONA[z4(z)]}` : ''}</button>`)
      .join('')}
  </div>${quadroZonaFloripa(mun)}`
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
  const bairros = termo.length >= 3 ? BAIRROS_FLORIPA.filter((b) => semAcento(b.nome).includes(termo)).slice(0, 6) : []
  ul.innerHTML =
    `<li><button type="button" data-mun-limpar class="sug-estado">🗺️ Santa Catarina inteira</button></li>` +
    bairros
      .map((b) => `<li><button type="button" data-bairro-zona="${b.zona}">🏘️ ${esc(b.nome)} <span class="mudo">· Florianópolis, ${Number(b.zona)}ª zona</span></button></li>`)
      .join('') +
    (achados.length
      ? achados
          .map((m) => `<li><button type="button" data-mun-cd="${esc(m.cd)}" data-mun-nm="${esc(m.nm)}">${esc(m.nm)}${m.capital ? ' <span class="mudo">· capital</span>' : ''}</button></li>`)
          .join('')
      : bairros.length ? '' : `<li class="sug-info">Nenhum município encontrado para “${esc(input.value)}”.</li>`)
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
  if (!favBtn) {
    const candEl = ev.target.closest('[data-cand]')
    if (candEl && !ev.target.closest('a, input, [data-mun-cd], [data-mun-limpar]')) {
      abrirDetalhe({ aba: candEl.dataset.candAba, abr: candEl.dataset.candAbr, sqcand: candEl.dataset.cand })
      return
    }
  }
  if (favBtn) {
    tratarFav(favBtn)
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
  const regBtn = ev.target.closest('[data-regiao]')
  if (regBtn) {
    const reg = regiao(regBtn.dataset.regiao)
    if (reg) {
      estado.atalhos = false
      escolherMunicipio(reg)
    }
    return
  }
  const atBtn = ev.target.closest('[data-atalhos]')
  if (atBtn) {
    estado.atalhos = atBtn.dataset.atalhos === '1'
    gravarLocal('atalhos:v1', estado.atalhos ? '1' : '0')
    renderizar()
    return
  }
  if (ev.target.closest('[data-ver-locais]')) {
    estado.locaisAbertos = !estado.locaisAbertos
    renderizar()
    return
  }
  const bzBtn = ev.target.closest('[data-bairro-zona]')
  if (bzBtn) {
    estado.atalhos = false
    estado.mun = { cd: FLORIPA_CD, nm: 'Florianópolis', zona: bzBtn.dataset.bairroZona }
    gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(estado.mun))
    estado.dados = null
    carregar()
    return
  }
  const h = (sel) => ev.target.closest(sel)
  if (h('[data-h22-mun]')) {
    const b = h('[data-h22-mun]')
    H22.local = b.dataset.h22Mun ? { cd: b.dataset.h22Mun, nm: b.dataset.h22Nm } : null
    Object.assign(H22, { buscaMun: '', foco: null, grupo: 'zona', verTodos: false, verGrupos: false })
    renderizar()
    return
  }
  if (H22.local) {
    const L = H22.local
    const acao = (mud) => {
      Object.assign(L, mud)
      H22.verGrupos = false
      renderizar()
      document.querySelector('.migalhas')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    if (h('[data-h22-nivel]')) return acao(h('[data-h22-nivel]').dataset.h22Nivel === 'mun' ? { zona: null, localVot: null, bairro: null, secao: null } : { localVot: null, bairro: null, secao: null })
    if (h('[data-h22-zona]')) return acao({ zona: h('[data-h22-zona]').dataset.h22Zona, localVot: null, bairro: null, secao: null, _g: (H22.grupo = 'local') })
    if (h('[data-h22-local]')) return acao({ localVot: h('[data-h22-local]').dataset.h22Local, zona: h('[data-h22-local]').dataset.h22Local.split('-')[0], secao: null, _g: (H22.grupo = 'secao') })
    if (h('[data-h22-bairro]')) return acao({ bairro: h('[data-h22-bairro]').dataset.h22Bairro, secao: null, _g: (H22.grupo = 'local') })
    if (h('[data-h22-secao]')) return acao({ secao: h('[data-h22-secao]').dataset.h22Secao })
    if (h('[data-h22-grupo]')) {
      H22.grupo = h('[data-h22-grupo]').dataset.h22Grupo
      H22.verGrupos = false
      return renderizar()
    }
    if (h('[data-h22-foco]')) {
      const v = h('[data-h22-foco]').dataset.h22Foco
      H22.foco = v === '' || Number(v) === H22.foco ? null : Number(v)
      return renderizar()
    }
    if (h('[data-h22-todos]')) return ((H22.verTodos = true), renderizar())
    if (h('[data-h22-vergrupos]')) return ((H22.verGrupos = true), renderizar())
  }
  const h22Btn = ev.target.closest('[data-h22]')
  if (h22Btn) {
    H22.sel = h22Btn.dataset.h22
    H22.busca = ''
    H22.foco = null
    renderizar()
    return
  }
  const zonaBtn = ev.target.closest('[data-zona]')
  if (zonaBtn) {
    estado.buscaBairro = ''
    estado.locaisAbertos = false
    escolherZona(zonaBtn.dataset.zona)
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

conteudo.addEventListener('change', (ev) => {
  if (ev.target.dataset?.pref === '2022') definirMostrar2022(ev.target.checked)
})

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'mun-busca') {
    mostrarSugestoes()
    return
  }
  if (ev.target.id === 'h22-mun') {
    H22.buscaMun = ev.target.value
    renderizar()
    return
  }
  if (ev.target.id === 'h22-busca') {
    H22.busca = ev.target.value
    renderizar()
    return
  }
  if (ev.target.id === 'bairro-busca') {
    estado.buscaBairro = ev.target.value
    renderizar()
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
  f('selo').textContent = d.final ? 'Totalização final · TSE' : d.tseDefinido ? 'Eleitos definidos pelo TSE' : TURNO === 2 ? '2º turno' : 'Em apuração'
  f('selo').classList.toggle('final', !!(d.final || d.tseDefinido))
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

/* ---------------- chance de reverter ---------------- */

// Majoritários: no 1º turno de Presidente/Governador o objetivo é ficar entre os 2 que vão ao 2º turno.
function contextoMaj(aba, d) {
  if (aba.cargo === 5) return { vagas: d.vagas, alvo: `as ${d.vagas} vagas`, dentro: `Está entre os ${d.vagas} eleitos`, garantido: `vaga garantida` }
  if (TURNO === 1) return { vagas: 2, alvo: 'o 2º turno', segundoTurno: true, dentro: 'Está entre os 2 que vão ao 2º turno', garantido: 'lugar garantido no 2º turno' }
  return { vagas: 1, alvo: 'a vitória', dentro: 'Está na frente', garantido: 'vitória garantida' }
}

const ROTULOS_2T = { garantido: 'Garantido no 2º turno', segura: '2º turno seguro', provavel: '2º turno provável', risco: '2º turno em risco', fora: 'Fora do 2º turno' }

function chance(d, c, aba, forcar = false) {
  if (!d || !aba || d.mun || d.final || d.tseDefinido || c.eleito || !c.valido || d.secoes.percentual < 1) return null
  if (aba.tipo === 'prop') {
    if (!d.projecao?.qe) return null
    if (!forcar && d.candidatos.indexOf(c) >= 3 * d.vagas && !ehFavorito(aba.id, d.abrangencia, c.sqcand)) return null
    return chanceDe(d, c, 'prop')
  }
  if (aba.tipo !== 'maj') return null
  return chanceDe(d, c, 'maj', contextoMaj(aba, d).vagas)
}

// Vitória no 1º turno garantida: mais da metade de todos os válidos, mesmo sem nenhum voto a mais.
function venceNoPrimeiroGarantido(d, c, aba, ch) {
  if (aba.tipo !== 'maj' || aba.cargo === 5 || TURNO !== 1 || !ch) return false
  const validos = d.candidatos.filter((x) => x.valido).reduce((a, x) => a + x.votos, 0)
  return c.votos > (validos + ch.R) / 2
}

function seloChance(d, c, aba, forcar = false) {
  const ch = chance(d, c, aba, forcar)
  if (!ch) return ''
  if (venceNoPrimeiroGarantido(d, c, aba, ch)) return `<span class="tag chance ch-garantido" title="Tem mais da metade de todos os votos válidos, contando os que faltam">✅ Vence no 1º turno</span>`
  const n = NIVEIS[ch.nivel]
  const rotulo = (aba.tipo === 'maj' && contextoMaj(aba, d).segundoTurno && ROTULOS_2T[ch.nivel]) || n.rotulo
  const titulo = ch.exato ? 'Certeza matemática' : 'Estimativa com as urnas que faltam'
  return `<span class="tag chance ${n.classe}" title="${titulo}">${n.icone} ${esc(rotulo)}${ch.exato && ch.nivel === 'fora' ? ' · matemático' : ''}</span>`
}

function textoChance(d, c, aba) {
  const ch = chance(d, c, aba, true)
  if (c.eleito) return `<div class="chance-det">${selo(c)}</div><p>O TSE já informou que <strong>${esc(c.nome)}</strong> está eleito${/por /i.test(c.situacao) ? ` (${esc(c.situacao.toLowerCase())})` : ''}. Esta é a situação oficial.</p>`
  if (d.tseDefinido) return `<div class="chance-det">${selo(c)}</div><p>O TSE já definiu o resultado deste cargo. Esta é a situação oficial.</p>`
  if (!ch) {
    if (d.final) return '<p class="nota">Apuração encerrada: não há mais o que reverter.</p>'
    if (d.mun) return '<p class="nota">A chance de reverter é calculada com os números de toda a abrangência (estado ou país), não do município.</p>'
    return '<p class="nota">Disponível quando houver votos apurados.</p>'
  }
  const ctx = aba.tipo === 'maj' ? contextoMaj(aba, d) : null
  const pct = d.secoes.percentual
  const linhas = [`Faltam cerca de <strong>${fmt.format(ch.R)}</strong> votos válidos para apurar (${fmtPct.format(100 - pct)}% das seções).`]
  const vezes = (m) => `${fmtPct.format(m)}×`
  if (venceNoPrimeiroGarantido(d, c, aba, ch)) linhas.push('✅ Já tem mais da metade de todos os votos válidos, mesmo contando os que faltam: <strong>vence no 1º turno</strong> (certeza matemática).')
  else if (aba.tipo === 'maj') {
    if (ch.nivel === 'garantido') linhas.push(`✅ <strong>${ctx.garantido[0].toUpperCase() + ctx.garantido.slice(1)}</strong>: ${ch.rival ? `a vantagem de ${fmt.format(ch.vantagem)} votos sobre ${esc(ch.rival.nome)} é maior que todos os votos que faltam` : 'ninguém pode alcançá-lo'} (certeza matemática).`)
    else if (ch.vantagem != null)
      linhas.push(`${ctx.dentro}, com <strong>${fmt.format(ch.vantagem)}</strong> votos de vantagem sobre ${esc(ch.rival.nome)}. ${
        ch.f <= 0 ? 'Mesmo sem nenhum voto a mais, o rival não o alcança se mantiver o ritmo dele.' : `Perderia a posição se, nas urnas que faltam, tivesse menos de ${vezes(ch.f)} o próprio desempenho atual.`
      }`)
    else if (ch.nivel === 'fora') linhas.push(`❌ Precisa tirar <strong>${fmt.format(ch.falta)}</strong> votos de diferença para ${esc(ch.rival.nome)}, mais do que todos os votos que faltam: <strong>não alcança mais ${ctx.alvo}</strong> (certeza matemática).`)
    else linhas.push(`Precisa tirar <strong>${fmt.format(ch.falta)}</strong> votos de diferença para ${esc(ch.rival.nome)}. Para isso precisaria de <strong>${vezes(ch.m)}</strong> o próprio desempenho atual nas urnas que faltam.`)
  } else {
    if (c.projecao)
      linhas.push(
        ch.folga === Infinity
          ? 'Mantidos os votos dos demais, ficaria com a vaga mesmo sem nenhum voto a mais.'
          : `Mantidos os votos dos demais, perderia a vaga com <strong>${fmt.format(ch.folga)}</strong> votos a menos. ${
              ch.f <= 0 ? 'Com o ritmo atual dos outros, a vaga se mantém mesmo que ele não ganhe mais votos.' : `Perderia a vaga se, nas urnas que faltam, tivesse menos de ${vezes(ch.f)} o próprio desempenho atual.`
            }`,
      )
    else if (ch.falta == null) linhas.push(`❌ Mesmo com todos os cerca de ${fmt.format(ch.R)} votos que faltam (e os demais parados), não entraria pelo cálculo atual.`)
    else linhas.push(`Precisaria de mais <strong>${fmt.format(ch.falta)}</strong> votos para entrar, com os demais parados. Com os outros mantendo o ritmo, precisaria de <strong>${vezes(ch.m)}</strong> o próprio desempenho atual nas urnas que faltam.`)
  }
  return `<div class="chance-det">${seloChance(d, c, aba, true)}</div>
    <ul class="det-lista">${linhas.map((l) => `<li>${l}</li>`).join('')}</ul>
    <p class="nota">Estimativa supondo que os outros candidatos mantenham o ritmo atual e que as urnas que faltam tenham o mesmo número médio de votos das já apuradas. Só os casos marcados como certeza matemática são definitivos.</p>`
}

function selo(c) {
  if (c.eleito) {
    const forma = (c.situacao.match(/por (QP|m[ée]dia)/i) || [])[0]
    return `<span class="tag eleito-tse" title="Situação oficial informada pelo TSE"><b>✔ Eleito</b><small>conforme TSE${forma ? ` · ${esc(forma)}` : ''}</small></span>`
  }
  if (c.tseDefinido) {
    if (/2º turno|segundo turno/i.test(c.situacao)) return `<span class="tag turno2">2º turno · conforme TSE</span>`
    if (/suplente/i.test(c.situacao)) return `<span class="tag suplente">Suplente · conforme TSE</span>`
    if (!c.valido) return `<span class="tag invalido">${esc(c.destinacao || 'Voto anulado')}</span>`
    return `<span class="tag nao-eleito">${esc(c.situacao && !/^eleito/i.test(c.situacao) ? c.situacao : 'Não eleito')} · conforme TSE</span>`
  }
  if (/2º turno|segundo turno/i.test(c.situacao)) return `<span class="tag turno2">2º turno · conforme TSE</span>`
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
  let linhaProj = ''
  if (!situacao && !c.tseDefinido && aba?.tipo === 'prop' && d.projecao?.qe) {
    const g = d.projecao.grupos.find((x) => x.nome === c.agremiacao)
    const ultimo = g?.eleitos[g.eleitos.length - 1]
    situacao = `<span class="tag fora">Fora da projeção</span>`
    linhaProj = ultimo
      ? `<li>🎯 <strong>${fmt.format(Math.max(0, ultimo.votos - c.votos))}</strong> atrás do último eleito do partido (${esc(ultimo.nome)})</li>`
      : '<li>🎯 O partido ainda não tem vaga na projeção</li>'
  }
  const distancias = [
    linhaProj,
    acima ? `<li>▼ <strong>${fmt.format(acima.votos - c.votos)}</strong> atrás do ${pos - 1}º (${esc(acima.nome)})</li>` : '<li>🥇 Em 1º lugar</li>',
    abaixo ? `<li>▲ <strong>${fmt.format(c.votos - abaixo.votos)}</strong> à frente do ${pos + 1}º (${esc(abaixo.nome)})</li>` : '',
  ].join('')
  return `<article class="fav" ${attrCand(c, f.aba, f.abr)} style="${estiloCor(cor)}">
    <div class="fav-topo">
      ${foto(c, cor)}
      <div class="cand-info">
        <div class="cand-linha"><span class="cand-nome">${esc(c.nome)}</span> ${situacao} ${seloChance(d, c, aba, true)}</div>
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
      <li id="c-${esc(c.sqcand)}" ${attrCand(c)} class="cand ${c.eleito ? 'is-eleito' : ''} ${ganho(c) > 0 ? 'subiu' : ''}" style="${estiloCor(cor)}">
        <span class="pos">${i + 1}º</span>
        ${foto(c, cor)}
        <div class="cand-info">
          <div class="cand-linha">
            <span class="cand-nome">${esc(c.nome)}</span>
            ${selo(c)} ${seloChance(d, c, estado.aba)}
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
    <thead><tr><th>#</th><th>Candidato</th><th class="dir">Votos</th></tr></thead>
    <tbody>
    ${linhas
      .slice(0, limite)
      .map(({ c, pos }) => {
        const cor = corPartido(c.partido)
        return `<tr ${attrCand(c)} class="${c.eleito ? 'is-eleito' : c.projecao && !c.tseDefinido ? 'is-proj' : ''} ${ganho(c) > 0 ? 'subiu' : ''}" style="${estiloCor(cor)}">
        <td class="mudo pos-tab">${pos}</td>
        <td>
          <div class="cand-linha">${estrela(c)}<span class="cand-nome">${esc(c.nome)}</span> ${selo(c)} ${seloChance(d, c, estado.aba)}</div>
          <div class="cand-meta">${pill(c.partido, cor)} ${esc(c.numero)}${c.agremiacao !== c.partido ? ` · ${esc(nomeCurto(c.agremiacao))}` : ''}</div>
        </td>
        <td class="dir"><strong>${fmt.format(c.votos)}</strong><span class="pct-tab">${fmtPct.format(c.percentual)}%</span>${delta(c)}</td>
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
        <td><div class="cand-linha">${pill(nomeCurto(g.nome), g.cor)}</div>
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
            (g) => `<tr style="${estiloCor(g.cor)}"><td>${pill(nomeCurto(g.nome), g.cor)}<div class="cand-meta">${fmtPct.format((100 * g.total) / r.qe)}% do QE</div></td>
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
      return `<circle ${attrCand(c)} cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${raioPonto.toFixed(1)}" fill="${cor}"
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
  const fatias = top.map((g) => ({ valor: g.votos, cor: g.cor, rotulo: nomeCurto(g.nome), partido: g.nome }))
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
            `<li class="chip" ${attrCand(c)} style="${estiloCor(corPartido(c.partido))}"><span class="mudo">${i + 1}º</span> <strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(
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
      <h3>✔ Bancada eleita conforme TSE (${eleitos.length} de ${d.vagas})</h3>
      <p class="nota">Eleitos informados oficialmente pelo TSE.</p>
      ${hemiciclo(ordenados)}
      <ul class="legenda">${contagem
        .map((g) => `<li data-partido="${esc(g.nome)}"><i style="background:${g.cor}"></i>${esc(nomeCurto(g.nome))} <strong>${g.eleitos}</strong></li>`)
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
        .map((g) => `<li data-partido="${esc(g.nome)}"><i style="background:${g.cor}"></i>${esc(nomeCurto(g.nome))} <strong>${g.vagasProj}</strong></li>`)
        .join('')}</ul>
      <ul class="chips">${[...proj]
        .sort((a, b) => a.projecao.ordem - b.projecao.ordem)
        .map(
          (c) =>
            `<li class="chip" ${attrCand(c)} style="${estiloCor(corPartido(c.partido))}"><strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(c.votos)} · ${
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
              nomeCurto(g.nome),
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
  if (estado.detalhe) renderDetalhe()
  const d = estado.dados
  if (!d) return
  if (document.activeElement?.id === 'mun-busca') {
    estado.renderPendente = true
    return
  }
  const focoId = ['busca', 'bairro-busca'].includes(document.activeElement?.id) ? document.activeElement.id : null
  const busca = !!focoId
  const pos = busca ? document.activeElement.selectionStart : null
  if (estado.aba.tipo === 'fav') {
    conteudo.innerHTML = renderFavoritos()
    return
  }
  if (estado.aba.tipo === 'sobre') {
    conteudo.innerHTML = renderSobre()
    return
  }
  if (estado.aba.tipo === 'h22') {
    const idf = ['h22-busca', 'h22-mun'].includes(document.activeElement?.id) ? document.activeElement.id : null
    const foco = idf ? document.activeElement.selectionStart : null
    conteudo.innerHTML = render2022()
    if (foco != null) {
      const el = document.getElementById(idf)
      el?.focus()
      el?.setSelectionRange(foco, foco)
    }
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
    const el = document.getElementById(focoId)
    el?.focus()
    el?.setSelectionRange(pos, pos)
  }
}

/* ---------------- coração (acompanhar) ---------------- */

// Dados já carregados de um cargo/abrangência (aba aberta, aba Acompanhados ou tela de detalhes).
function dadosCarregados(abaId, abr) {
  if (estado.aba.id === abaId && abrAtual() === abr && estado.dados?.candidatos && !estado.dados.mun) return estado.dados
  const fav = estado.favDados?.get(`${abaId}|${abr}`)
  if (fav) return fav
  const det = estado.detalhe
  if (det && det.aba === abaId && det.abr === abr && det.dados && !det.dados.mun) return det.dados
  return null
}

function tratarFav(favBtn) {
  const { fav: sqcand, favAba: abaId, favAbr: abr } = favBtn.dataset
  if (ehFavorito(abaId, abr, sqcand)) {
    favoritos = favoritos.filter((f) => f.id !== idFav(abaId, abr, sqcand))
    gravarLocal(CHAVE_FAV, JSON.stringify(favoritos))
  } else {
    const d = dadosCarregados(abaId, abr)
    const c = (d || dadosDetalhe())?.candidatos?.find((x) => x.sqcand === sqcand)
    if (!c) return
    alternarFavorito(abaId, abr, c)
    if (d) registrarHistorico(abaId, abr, d)
    // aproveita o que já foi visto nesta sessão para o histórico guardado
    const sessao = historicoSessao.get(`${abaId}|${abr}||${sqcand}`)
    if (sessao?.length > 1) {
      historico[idFav(abaId, abr, sqcand)] = sessao.map((p) => [...p])
      gravarLocal(CHAVE_HIST, JSON.stringify(historico))
    }
  }
  montarAbas()
  renderizar()
}

/* ---------------- histórico da sessão (todos os candidatos) ---------------- */

// Enquanto o app está aberto, guarda a evolução de todos os candidatos vistos (só em memória).
const historicoSessao = new Map()
const chaveLocal = (mun) => (mun ? (mun.regiao ? `r${mun.regiao}` : `${mun.cd}${mun.zona ? 'z' + mun.zona : ''}`) : '')
function registrarSessao(abaId, abr, mun, dados) {
  const pst = Math.round(dados.secoes.percentual * 100) / 100
  dados.candidatos.forEach((c, i) => {
    const k = `${abaId}|${abr}|${chaveLocal(mun)}|${c.sqcand}`
    let serie = historicoSessao.get(k)
    if (!serie) historicoSessao.set(k, (serie = []))
    const ult = serie[serie.length - 1]
    if (ult && (c.votos < ult[1] || pst < ult[0])) serie.length = 0
    if (!serie.length || serie[serie.length - 1][1] !== c.votos || serie[serie.length - 1][0] !== pst) {
      serie.push([pst, c.votos, Date.now(), Math.round(c.percentual * 1000) / 1000, i + 1])
      if (serie.length > 240) serie.splice(1, 1)
    }
  })
}

function attrCand(c, abaId = estado.aba.id, abr = abrAtual()) {
  return `data-cand="${esc(c.sqcand)}" data-cand-aba="${esc(abaId)}" data-cand-abr="${esc(abr)}"`
}

/* ---------------- tela de detalhes do candidato ---------------- */

const detalheEl = document.createElement('div')
detalheEl.className = 'detalhe'
detalheEl.hidden = true
detalheEl.setAttribute('role', 'dialog')
detalheEl.setAttribute('aria-modal', 'true')
document.body.appendChild(detalheEl)

function abrirDetalhe({ aba, abr, sqcand }) {
  const mun = estado.aba.id === aba && abrAtual() === abr ? munAtual() : null
  estado.detalhe = { aba, abr, sqcand, mun, floripa: null }
  history.pushState({ detalhe: true }, '', location.href)
  document.documentElement.classList.add('com-detalhe')
  detalheEl.hidden = false
  detalheEl.scrollTop = 0
  renderDetalhe()
  if (!dadosDetalhe()) {
    const abaObj = ABAS.find((a) => a.id === aba)
    buscar(abaObj, abr, TURNO, undefined, mun)
      .then((d) => {
        if (estado.detalhe?.sqcand !== sqcand) return
        estado.detalhe.dados = d
        registrarSessao(aba, abr, mun, d)
        renderDetalhe()
      })
      .catch(() => {
        if (estado.detalhe?.sqcand === sqcand) {
          estado.detalhe.erro = true
          renderDetalhe()
        }
      })
  }
}

function fecharDetalhe(voltarHistorico = true) {
  if (!estado.detalhe) return
  estado.detalhe.ctrlPorMun?.abort()
  estado.detalhe.ctrlComp?.abort()
  estado.detalhe = null
  detalheEl.hidden = true
  detalheEl.innerHTML = ''
  document.documentElement.classList.remove('com-detalhe')
  dica.hidden = true
  if (voltarHistorico && history.state?.detalhe) history.back()
}

window.addEventListener('popstate', () => {
  if (estado.detalhe) fecharDetalhe(false)
})
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && estado.detalhe) fecharDetalhe()
})

function dadosDetalhe() {
  const det = estado.detalhe
  if (!det) return null
  if (det.mun) {
    if (estado.aba.id === det.aba && abrAtual() === det.abr && chaveLocal(estado.dados?.mun) === chaveLocal(det.mun)) return estado.dados
    return det.dados || null
  }
  return dadosCarregados(det.aba, det.abr)
}

function serieDetalhe() {
  const det = estado.detalhe
  const sessao = historicoSessao.get(`${det.aba}|${det.abr}|${chaveLocal(det.mun)}|${det.sqcand}`) || []
  if (det.mun) return sessao
  const guardada = historico[idFav(det.aba, det.abr, det.sqcand)] || []
  return guardada.length >= sessao.length ? guardada : sessao
}

// Gráfico de linha genérico: x = % das seções apuradas.
function graficoLinha(pontos, { cor, fmtY, zero = false, titulo }) {
  if (pontos.length < 2) return ''
  const W = 320, H = 120, ML = 6, MR = 6, MT = 16, MB = 18
  const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  let y0 = zero ? 0 : Math.min(...ys), y1 = Math.max(...ys)
  if (y1 === y0) { y0 -= Math.abs(y0) * 0.05 || 1; y1 += Math.abs(y1) * 0.05 || 1 }
  const pad = zero ? 0 : (y1 - y0) * 0.12
  y0 = zero ? y0 : y0 - pad
  y1 += pad
  const X = (v) => (x1 === x0 ? W / 2 : ML + ((v - x0) / (x1 - x0)) * (W - ML - MR))
  const Y = (v) => MT + (1 - (v - y0) / (y1 - y0)) * (H - MT - MB)
  const pts = pontos.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const ult = pontos[pontos.length - 1]
  const alvos = pontos
    .map(
      (p) =>
        `<circle class="alvo" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="8" data-dica="${esc(
          `<strong>${fmtY(p.y)}</strong><br>com ${fmtPct.format(p.x)}% apurado${p.t ? ' · ' + new Date(p.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`,
        )}"></circle>`,
    )
    .join('')
  return `<figure class="grafico">
    <figcaption>${esc(titulo)}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" style="--cor:${cor}">
      <line class="grade" x1="${ML}" x2="${W - MR}" y1="${Y(y1 - pad).toFixed(1)}" y2="${Y(y1 - pad).toFixed(1)}"></line>
      <line class="grade" x1="${ML}" x2="${W - MR}" y1="${Y(y0 + (zero ? 0 : pad)).toFixed(1)}" y2="${Y(y0 + (zero ? 0 : pad)).toFixed(1)}"></line>
      <text class="rot" x="${ML}" y="${(Y(y1 - pad) - 4).toFixed(1)}">${esc(fmtY(y1 - pad))}</text>
      <text class="rot" x="${ML}" y="${(Y(y0 + (zero ? 0 : pad)) - 4).toFixed(1)}">${esc(fmtY(y0 + (zero ? 0 : pad)))}</text>
      <polyline class="linha" points="${pts}"></polyline>
      <circle class="ponta" cx="${X(ult.x).toFixed(1)}" cy="${Y(ult.y).toFixed(1)}" r="4.5"></circle>
      <text class="rot" x="${ML}" y="${H - 4}">${fmtPct.format(x0)}% apurado</text>
      <text class="rot" x="${W - MR}" y="${H - 4}" text-anchor="end">${fmtPct.format(x1)}% apurado</text>
      ${alvos}
    </svg>
  </figure>`
}

// Tendência do % dos válidos: compara o último ponto com o de algumas atualizações atrás.
function tendencia(serie) {
  const comPct = serie.filter((p) => p[3] != null)
  if (comPct.length < 2) return null
  const ult = comPct[comPct.length - 1]
  const ref = comPct[Math.max(0, comPct.length - 6)]
  const ini = comPct[0]
  const delta = ult[3] - ref[3]
  const limite = Math.max(0.005, Math.abs(ult[3]) * 0.004)
  const tipo = delta > limite ? 'alta' : delta < -limite ? 'queda' : 'estavel'
  return { tipo, delta, ref, ini, ult, deltaTotal: ult[3] - ini[3] }
}

const pp = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPct.format(Math.abs(v))} p.p.`

function blocoDisputa(d, c, aba) {
  const pos = d.candidatos.indexOf(c) + 1
  const acima = d.candidatos[pos - 2]
  const abaixo = d.candidatos[pos]
  const itens = []
  if (acima) itens.push(`▼ <strong>${fmt.format(acima.votos - c.votos)}</strong> votos atrás do ${pos - 1}º (${esc(acima.nome)})`)
  else itens.push('🥇 Em 1º lugar')
  if (abaixo) itens.push(`▲ <strong>${fmt.format(c.votos - abaixo.votos)}</strong> votos à frente do ${pos + 1}º (${esc(abaixo.nome)})`)
  if (aba.tipo === 'maj') {
    if (aba.cargo === 5) {
      const corte = d.candidatos[d.vagas - 1]
      const fora = d.candidatos[d.vagas]
      if (pos <= d.vagas && fora) itens.push(`🪑 Dentro das ${d.vagas} vagas: <strong>${fmt.format(c.votos - fora.votos)}</strong> votos à frente do ${d.vagas + 1}º`)
      else if (corte) itens.push(`🪑 Fora das ${d.vagas} vagas: precisa de <strong>${fmt.format(corte.votos - c.votos + 1)}</strong> votos para passar o ${d.vagas}º`)
    } else if (TURNO === 1) {
      itens.push(c.percentual > 50 ? `✅ Acima de 50% dos válidos: venceria no 1º turno` : `🎯 Faltam <strong>${pp(50 - c.percentual).replace('+', '')}</strong> para 50% dos válidos (vitória no 1º turno)`)
    }
  } else if (d.projecao?.qe && !d.mun) {
    const g = d.projecao.grupos.find((x) => x.nome === c.agremiacao)
    const noPartido = g ? g.cands.indexOf(c) + 1 : 0
    if (noPartido) itens.push(`🏛️ ${noPartido}º mais votado de ${esc(nomeCurto(c.agremiacao))} (${g.cands.length} candidatos)`)
    if (g) itens.push(`📊 ${esc(nomeCurto(c.agremiacao))}: ${fmt.format(g.votos)} votos (com ${fmt.format(g.legenda)} de legenda) · ${g.eleitos.length} vaga(s) na projeção · QP ${g.qp}`)
    if (c.projecao) itens.push(`★ Eleito na projeção por ${c.projecao.forma === 'QP' ? 'quociente partidário' : c.projecao.forma}`)
    else if (g?.eleitos.length) {
      const ultimo = g.eleitos[g.eleitos.length - 1]
      itens.push(`🎯 <strong>${fmt.format(Math.max(0, ultimo.votos - c.votos))}</strong> votos atrás do último eleito do partido (${esc(ultimo.nome)})`)
    } else itens.push('🎯 O partido ainda não tem vaga na projeção')
    itens.push(`Mínimo para vaga por QP: ${fmt.format(Math.ceil(0.1 * d.projecao.qe))} votos (10% do QE) — ${c.votos >= 0.1 * d.projecao.qe ? 'atingido ✓' : 'não atingido'}`)
  }
  return `<ul class="det-lista">${itens.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

function renderDetalhe() {
  const det = estado.detalhe
  if (!det) return
  const idFoco = ['det-busca-mun', 'comp-busca'].includes(document.activeElement?.id) ? document.activeElement.id : null
  const focoBusca = idFoco ? document.activeElement.selectionStart : null
  renderDetalheConteudo()
  if (focoBusca != null) {
    const el = document.getElementById(idFoco)
    el?.focus()
    el?.setSelectionRange(focoBusca, focoBusca)
  }
}

function renderDetalheConteudo() {
  const det = estado.detalhe
  const aba = ABAS.find((a) => a.id === det.aba)
  const d = dadosDetalhe()
  const voltar = `<div class="det-topo"><button type="button" class="det-voltar" data-fechar>‹ Voltar</button>
    <span class="det-onde">${esc(aba ? aba.rotulo.replace(/ SC$/, '') : '')} · ${esc(det.mun ? `${det.mun.nm} (SC)${det.mun.zona ? ` · ${Number(det.mun.zona)}ª zona` : ''}` : NOMES_ABR[det.abr] || det.abr.toUpperCase())}</span></div>`
  if (!d) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}<div class="cartao vazio">${det.erro ? 'Não consegui carregar os dados agora.' : 'Carregando…'}</div></div>`
    return
  }
  const c = d.candidatos.find((x) => x.sqcand === det.sqcand)
  if (!c) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}<div class="cartao vazio">Candidato não encontrado nesta apuração.</div></div>`
    return
  }
  if (det.escolhendo) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${escolherComparacao(d, c)}</div>`
    return
  }
  const c2 = det.comp && d.candidatos.find((x) => x.sqcand === det.comp.sqcand)
  if (c2) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${renderComparacao(d, c, c2, aba)}</div>`
    return
  }
  const cor = corPartido(c.partido)
  const pos = d.candidatos.indexOf(c) + 1
  const total = d.candidatos.filter((x) => x.valido).length
  const serie = serieDetalhe()
  const t = tendencia(serie)
  const ganhoUlt = serie.length > 1 ? serie[serie.length - 1][1] - serie[serie.length - 2][1] : 0
  const tendTxt = !t
    ? `<p class="nota">A tendência aparece depois de algumas atualizações com votos novos. ${
        ehFavorito(det.aba, det.abr, det.sqcand) ? '' : 'Toque no ♡ para guardar o histórico deste candidato mesmo se fechar o app.'
      }</p>`
    : `<div class="tend tend-${t.tipo}">
        <span class="tend-icone">${t.tipo === 'alta' ? '📈' : t.tipo === 'queda' ? '📉' : '➖'}</span>
        <div><strong>${t.tipo === 'alta' ? 'Crescendo' : t.tipo === 'queda' ? 'Caindo' : 'Estável'}</strong>
          <span>${pp(t.delta)} nas últimas atualizações (de ${fmtPct.format(t.ref[3])}% para ${fmtPct.format(t.ult[3])}% dos válidos)</span>
          <span class="mudo">Desde ${fmtPct.format(t.ini[0])}% apurado: ${pp(t.deltaTotal)}${
            t.ini[4] && t.ult[4] && t.ini[4] !== t.ult[4] ? ` · posição ${t.ini[4]}º → ${t.ult[4]}º` : ''
          }</span></div>
      </div>`
  const ptsPct = serie.filter((p) => p[3] != null).map((p) => ({ x: p[0], y: p[3], t: p[2] }))
  const ptsVot = serie.map((p) => ({ x: p[0], y: p[1], t: p[2] }))
  const ptsPos = serie.filter((p) => p[4]).map((p) => ({ x: p[0], y: -p[4], t: p[2] }))
  const vices = c.vices.length
    ? `<section class="cartao"><h3>${aba?.cargo === 5 ? 'Suplentes' : 'Vice'}</h3><ul class="det-lista">${c.vices
        .map((v) => `<li>${v.tipo === 'v' ? 'Vice' : v.tipo === 's1' ? '1º suplente' : v.tipo === 's2' ? '2º suplente' : 'Suplente'}: <strong>${esc(v.nome)}</strong>${v.partido ? ` (${esc(v.partido)})` : ''}</li>`)
        .join('')}</ul></section>`
    : ''
  const floripa = det.abr === UF || aba?.id === 'presidente' ? secaoPorMunicipio(det, aba, cor) : ''
  detalheEl.innerHTML = `<div class="det-corpo">
    ${voltar}
    <section class="cartao det-cabeca" style="${estiloCor(cor)}">
      <div class="det-id">
        ${foto(c, cor)}
        <div class="cand-info">
          <h2>${esc(c.nome)}</h2>
          ${c.nomeCompleto && c.nomeCompleto !== c.nome ? `<p class="mudo det-completo">${esc(c.nomeCompleto)}</p>` : ''}
          <div class="cand-meta">${pill(c.partido, cor)} nº ${esc(c.numero)}${c.agremiacao !== c.partido ? ` · ${esc(nomeCurto(c.agremiacao))}` : ''}</div>
          <div class="det-selo">${selo(c)}</div>
        </div>
        ${estrela(c, det.aba, det.abr)}
      </div>
      <div class="fav-nums">
        <div><span class="fav-rot">Votos</span><strong>${fmt.format(c.votos)}</strong>${ganhoUlt > 0 ? `<span class="delta">▲ ${fmt.format(ganhoUlt)}</span>` : ''}</div>
        <div><span class="fav-rot">% válidos</span><strong>${fmtPct.format(c.percentual)}%</strong></div>
        <div><span class="fav-rot">Posição</span><strong>${pos}º</strong><span class="mudo">de ${total}</span></div>
      </div>
      <p class="nota">${fmtPct.format(d.secoes.percentual)}% das seções apuradas · dados do TSE de ${esc(d.atualizadoEm || '—')}</p>
      <button type="button" class="botao comparar" data-comparar>⚖️ Comparar com outro candidato</button>
    </section>
    <section class="cartao"><h3>Tendência</h3>${tendTxt}
      ${graficoLinha(ptsPct, { cor, fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoLinha(ptsVot, { cor, fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${ptsPos.length > 1 && new Set(ptsPos.map((p) => p.y)).size > 1 ? graficoLinha(ptsPos, { cor, fmtY: (v) => `${Math.round(-v)}º`, titulo: 'Posição (mais alto = melhor)' }) : ''}
    </section>
    ${secao2022(c, d, aba)}
    <section class="cartao"><h3>${c.eleito || d.tseDefinido ? 'Situação oficial (TSE)' : 'Chance de reverter'}</h3>${textoChance(d, c, aba)}</section>
    <section class="cartao"><h3>Disputa</h3>${blocoDisputa(d, c, aba)}</section>
    ${vices}
    ${floripa}
  </div>`
}

// Votos do candidato por município (região ou estado todo) e, sob demanda, por zona.
function secaoPorMunicipio(det, aba, cor) {
  const pm = det.porMun
  const pesado = aba?.tipo === 'prop'
  const botoes = `<div class="pm-botoes">
      <button type="button" class="botao ${pm?.escopo === 'regiao' ? '' : 'secundario'}" data-por-mun="regiao">Grande Florianópolis</button>
      <button type="button" class="botao ${pm?.escopo === 'maiores' ? '' : 'secundario'}" data-por-mun="maiores">Maiores cidades</button>
      <button type="button" class="botao ${pm?.escopo === 'todos' ? '' : 'secundario'}" data-por-mun="todos">Todos os municípios + regiões</button>
    </div>`
  if (!pm)
    return `<section class="cartao"><h3>📍 Votos por município e zona</h3>
      <p class="nota">Consulta os arquivos de cada município no TSE. ${
        pesado ? 'Para deputados, "Todos os municípios" baixa cerca de 295 arquivos grandes (dezenas de MB): prefira Wi-Fi.' : ''
      }</p>${botoes}</section>`
  const termo = semAcento((pm.busca || '').trim())
  const linhas = pm.linhas.filter((l) => !termo || semAcento(l.nm).includes(termo)).sort((a, b) => b.votos - a.votos)
  const limite = pm.verTodos || termo ? linhas.length : 40
  const total = pm.linhas.reduce((a, l) => a + l.votos, 0)
  const linhaZonas = (l) => {
    const z = pm.zonas[l.cd]
    if (!z) return ''
    if (z.carregando) return `<tr class="pm-zona"><td colspan="3" class="mudo">Consultando ${z.feitos} de ${z.total} zonas…</td></tr>`
    return z.linhas
      .sort((a, b) => b.votos - a.votos)
      .map((zl) => `<tr class="pm-zona" style="${estiloCor(cor)}"><td>↳ ${Number(zl.zona)}ª zona${l.cd === FLORIPA_CD && ROTULO_ZONA[z4(zl.zona)] ? ` · ${ROTULO_ZONA[z4(zl.zona)]}` : ''}${
        l.cd === FLORIPA_CD ? `<div class="cand-meta zona-bairros-mini">${esc(infoZonaFloripa(zl.zona).bairros.slice(0, 8).join(', '))}${infoZonaFloripa(zl.zona).bairros.length > 8 ? '…' : ''}</div>` : ''
      }<div class="cand-meta">${zl.semDados ? 'sem dados ainda' : `${fmtPct.format(zl.pst)}% apurado · ${zl.pos}º na zona`}</div></td><td class="dir">${fmt.format(zl.votos)}</td><td class="dir">${fmtPct.format(zl.pct)}%</td></tr>`)
      .join('')
  }
  const agrupar = pm.escopo === 'todos' && !pm.carregando ? pm.agrupar || 'mun' : 'mun'
  const abasAgrupar =
    pm.escopo === 'todos' && !pm.carregando
      ? `<div class="segmentado" role="group" aria-label="Agrupar">
          ${[['mun', 'Municípios'], ['meso', 'Regiões'], ['micro', 'Microrregiões']]
            .map(([k, r]) => `<button type="button" data-agrupar="${k}" aria-pressed="${agrupar === k}">${r}</button>`)
            .join('')}</div>`
      : ''
  if (agrupar !== 'mun') {
    const grupos = new Map()
    for (const l of pm.linhas) {
      const info = MUN_REG.get(l.cd)
      const chave = info ? (agrupar === 'meso' ? info.meso : info.micro) : '?'
      const g = grupos.get(chave) || { nome: agrupar === 'meso' ? MESORREGIOES[chave] : MICRORREGIOES[chave] || 'Outros', meso: info && MESORREGIOES[info.meso], votos: 0, validos: 0, n: 0, top: null }
      g.votos += l.votos
      g.validos += l.validos || 0
      ;(g.cds ??= []).push(l.cd)
      g.n++
      if (!g.top || l.votos > g.top.votos) g.top = l
      grupos.set(chave, g)
    }
    const lista = [...grupos.values()].sort((a, b) => b.votos - a.votos)
    const max = Math.max(1, ...lista.map((g) => g.votos))
    return `<section class="cartao"><h3>📍 Votos por município e zona</h3>${botoes}${abasAgrupar}
      <table class="tabela pm-tabela"><thead><tr><th>${agrupar === 'meso' ? 'Região' : 'Microrregião'}</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead><tbody>${lista
        .map(
          (g) => `<tr style="${estiloCor(cor)}"><td><strong>${esc(g.nome)}</strong><div class="cand-meta">${agrupar === 'micro' && g.meso ? esc(g.meso) + ' · ' : ''}${g.n} municípios · mais votos em ${esc(g.top.nm)}</div>
            <div class="barra fina"><span style="width:${(100 * g.votos) / max}%"></span></div></td>
            <td class="dir">${fmt.format(g.votos)}</td><td class="dir">${g.validos ? fmtPct.format((100 * g.votos) / g.validos) : '–'}%${linha2022Grupo(det, g.cds, g.validos ? (100 * g.votos) / g.validos : null)}</td></tr>`,
        )
        .join('')}</tbody></table>
      <p class="nota">Regiões do IBGE. % = votos do candidato ÷ votos válidos da região. Total: <strong>${fmt.format(total)}</strong> votos.</p>
    </section>`
  }
  return `<section class="cartao"><h3>📍 Votos por município e zona</h3>${botoes}${abasAgrupar}
    ${pm.carregando ? `<p class="nota">Consultando ${pm.feitos} de ${pm.total} municípios…</p>` : ''}
    ${pm.escopo === 'todos' ? `<input id="det-busca-mun" type="search" placeholder="Buscar município…" value="${esc(pm.busca || '')}" autocomplete="off">` : ''}
    <table class="tabela pm-tabela"><thead><tr><th>Município</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead><tbody>${linhas
      .slice(0, limite)
      .map(
        (l) => `<tr style="${estiloCor(cor)}"><td>${esc(l.nm)}<div class="cand-meta">${l.semDados ? 'sem dados ainda' : `${fmtPct.format(l.pst)}% apurado · ${l.pos}º no município`}</div>
          ${l.zonas.length > 1 ? `<button type="button" class="link-zonas" data-zonas-mun="${esc(l.cd)}">${pm.zonas[l.cd] ? 'ocultar zonas ▴' : `ver ${l.zonas.length} zonas ▾`}</button>` : l.zonas.length === 1 ? `<div class="cand-meta">zona única: ${Number(l.zonas[0])}ª</div>` : ''}</td>
          <td class="dir">${fmt.format(l.votos)}</td><td class="dir">${fmtPct.format(l.pct)}%${linha2022Mun(det, l.cd, l.pct)}</td></tr>${linhaZonas(l)}`,
      )
      .join('')}</tbody></table>
    ${linhas.length > limite ? `<button type="button" class="botao secundario" data-pm-ver-todos>Mostrar todos os ${linhas.length}</button>` : ''}
    <p class="nota">Total ${pm.escopo === 'regiao' ? 'na região' : 'nos municípios consultados'}: <strong>${fmt.format(total)}</strong> votos${
      pm.semDados ? ` · ${pm.semDados} município(s) ainda sem dados` : ''
    }. ${pm.carregando ? '' : `Consultado às ${new Date(pm.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}</p>
  </section>`
}

async function carregarPorMunicipio(escopo) {
  const det = estado.detalhe
  if (!det) return
  const aba = ABAS.find((a) => a.id === det.aba)
  let lista
  try {
    lista = await municipios(aba)
  } catch {
    return
  }
  det.ctrlPorMun?.abort()
  const porCd = new Map(lista.map((m) => [m.cd, m]))
  const alvo =
    escopo === 'regiao'
      ? lista.filter((m) => NUCLEO.has(chaveNome(m.nm)) || EXPANSAO.has(chaveNome(m.nm)))
      : escopo === 'maiores'
        ? MUNICIPIOS_SC.slice(0, 15).map(([cd, , nm]) => porCd.get(cd) || { cd, nm, zonas: [] })
        : lista
  const pm = { escopo, carregando: true, feitos: 0, total: alvo.length, linhas: [], semDados: 0, zonas: {}, busca: '', t: Date.now() }
  preparar2022Mun(det)
  det.porMun = pm
  renderDetalhe()
  const ctrl = new AbortController()
  det.ctrlPorMun = ctrl
  let ultimo = 0
  await emLotes(alvo, 6, async (m) => {
    try {
      const d = await buscar(aba, UF, TURNO, ctrl.signal, { cd: m.cd, nm: m.nm })
      const c = d.candidatos.find((x) => x.sqcand === det.sqcand)
      pm.linhas.push({ cd: m.cd, nm: m.nm, zonas: m.zonas || [], votos: c?.votos || 0, validos: d.votos.validos, pct: c?.percentual || 0, pos: c ? d.candidatos.indexOf(c) + 1 : '–', pst: d.secoes.percentual })
    } catch (err) {
      if (err.name === 'AbortError') throw err
      pm.semDados++
      pm.linhas.push({ cd: m.cd, nm: m.nm, zonas: m.zonas || [], votos: 0, pct: 0, pos: '–', pst: 0, semDados: true })
    }
    pm.feitos++
    if (estado.detalhe === det && Date.now() - ultimo > 600) {
      ultimo = Date.now()
      renderDetalhe()
    }
  }, ctrl.signal).catch(() => {})
  if (ctrl.signal.aborted) return
  pm.carregando = false
  pm.t = Date.now()
  if (estado.detalhe === det) renderDetalhe()
}

async function alternarZonas(cd) {
  const det = estado.detalhe
  const pm = det?.porMun
  if (!pm) return
  if (pm.zonas[cd]) {
    delete pm.zonas[cd]
    return renderDetalhe()
  }
  const l = pm.linhas.find((x) => x.cd === cd)
  const aba = ABAS.find((a) => a.id === det.aba)
  const z = { carregando: true, feitos: 0, total: l.zonas.length, linhas: [] }
  pm.zonas[cd] = z
  renderDetalhe()
  await emLotes(l.zonas, 4, async (zona) => {
    try {
      const d = await buscar(aba, UF, TURNO, undefined, { cd, nm: l.nm, zona })
      const c = d.candidatos.find((x) => x.sqcand === det.sqcand)
      z.linhas.push({ zona, votos: c?.votos || 0, pct: c?.percentual || 0, pos: c ? d.candidatos.indexOf(c) + 1 : '–', pst: d.secoes.percentual })
    } catch {
      z.linhas.push({ zona, votos: 0, pct: 0, pos: '–', pst: 0, semDados: true })
    }
    z.feitos++
  }, new AbortController().signal)
  z.carregando = false
  if (estado.detalhe === det) renderDetalhe()
}

/* ---------------- comparação entre dois candidatos ---------------- */

function serieDe(det, sqcand) {
  const sessao = historicoSessao.get(`${det.aba}|${det.abr}|${chaveLocal(det.mun)}|${sqcand}`) || []
  if (det.mun) return sessao
  const guardada = historico[idFav(det.aba, det.abr, sqcand)] || []
  return guardada.length >= sessao.length ? guardada : sessao
}

function escolherComparacao(d, c) {
  const det = estado.detalhe
  const termo = semAcento((det.buscaComp || '').trim())
  const lista = d.candidatos
    .filter((x) => x !== c && x.valido)
    .filter((x) => !termo || semAcento(`${x.nome} ${x.nomeCompleto} ${x.partido} ${x.numero}`).includes(termo))
    .slice(0, termo ? 60 : 25)
  const favs = d.candidatos.filter((x) => x !== c && ehFavorito(det.aba, det.abr, x.sqcand))
  const item = (x) => {
    const cor = corPartido(x.partido)
    return `<li><button type="button" data-comp-sq="${esc(x.sqcand)}" style="${estiloCor(cor)}">
      <span class="pos">${d.candidatos.indexOf(x) + 1}º</span>
      <span class="comp-nome"><strong>${esc(x.nome)}</strong> ${pill(x.partido, cor)}</span>
      <span class="mudo">${fmt.format(x.votos)}</span></button></li>`
  }
  return `<section class="cartao">
    <h3>⚖️ Comparar ${esc(c.nome)} com…</h3>
    <input id="comp-busca" type="search" placeholder="Buscar por nome, partido ou número…" value="${esc(det.buscaComp || '')}" autocomplete="off">
    ${favs.length && !termo ? `<p class="atalhos-rot">❤️ Acompanhados</p><ul class="comp-lista">${favs.map(item).join('')}</ul><p class="atalhos-rot">Mais votados</p>` : ''}
    <ul class="comp-lista">${lista.map(item).join('') || '<li class="nota">Nenhum candidato encontrado.</li>'}</ul>
    <button type="button" class="botao secundario" data-sair-comp>Cancelar</button>
  </section>`
}

// Duas séries no mesmo gráfico; a segunda tracejada (identidade não depende só da cor).
function graficoDuplo(series, { fmtY, zero = false, titulo }) {
  const validas = series.filter((s) => s.pontos.length > 1)
  if (!validas.length) return ''
  const W = 320, H = 130, ML = 6, MR = 6, MT = 16, MB = 18
  const todos = validas.flatMap((s) => s.pontos)
  const x0 = Math.min(...todos.map((p) => p.x)), x1 = Math.max(...todos.map((p) => p.x))
  let y0 = zero ? 0 : Math.min(...todos.map((p) => p.y)), y1 = Math.max(...todos.map((p) => p.y))
  if (y1 === y0) { y0 -= Math.abs(y0) * 0.05 || 1; y1 += Math.abs(y1) * 0.05 || 1 }
  const pad = zero ? 0 : (y1 - y0) * 0.12
  const lo = y0 - pad, hi = y1 + pad
  const X = (v) => (x1 === x0 ? W / 2 : ML + ((v - x0) / (x1 - x0)) * (W - ML - MR))
  const Y = (v) => MT + (1 - (v - lo) / (hi - lo)) * (H - MT - MB)
  const linhas = validas
    .map((s, i) => {
      const pts = s.pontos.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
      const u = s.pontos[s.pontos.length - 1]
      const alvos = s.pontos
        .map((p) => `<circle class="alvo" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="7" data-dica="${esc(`<strong>${esc(s.nome)}</strong><br>${fmtY(p.y)} com ${fmtPct.format(p.x)}% apurado`)}"></circle>`)
        .join('')
      return `<polyline class="linha ${i ? 'tracejada' : ''}" style="--cor:${s.cor}" points="${pts}"></polyline>
        <circle class="ponta" style="--cor:${s.cor}" cx="${X(u.x).toFixed(1)}" cy="${Y(u.y).toFixed(1)}" r="4.5"></circle>${alvos}`
    })
    .join('')
  return `<figure class="grafico">
    <figcaption>${esc(titulo)}</figcaption>
    <ul class="legenda">${validas.map((s, i) => `<li><i class="${i ? 'leg-tracejada' : ''}" style="background:${s.cor}"></i>${esc(s.nome)}</li>`).join('')}</ul>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">
      <line class="grade" x1="${ML}" x2="${W - MR}" y1="${Y(y1).toFixed(1)}" y2="${Y(y1).toFixed(1)}"></line>
      <line class="grade" x1="${ML}" x2="${W - MR}" y1="${Y(y0).toFixed(1)}" y2="${Y(y0).toFixed(1)}"></line>
      <text class="rot" x="${ML}" y="${(Y(y1) - 4).toFixed(1)}">${esc(fmtY(y1))}</text>
      <text class="rot" x="${ML}" y="${(Y(y0) - 4).toFixed(1)}">${esc(fmtY(y0))}</text>
      ${linhas}
      <text class="rot" x="${ML}" y="${H - 4}">${fmtPct.format(x0)}% apurado</text>
      <text class="rot" x="${W - MR}" y="${H - 4}" text-anchor="end">${fmtPct.format(x1)}% apurado</text>
    </svg>
  </figure>`
}

function renderComparacao(d, a, b, aba) {
  const det = estado.detalhe
  const corA = corPartido(a.partido)
  let corB = corPartido(b.partido)
  const pa = d.candidatos.indexOf(a) + 1, pb = d.candidatos.indexOf(b) + 1
  const lider = a.votos >= b.votos ? a : b
  const outro = lider === a ? b : a
  const dif = lider.votos - outro.votos
  const sa = serieDe(det, a.sqcand), sb = serieDe(det, b.sqcand)
  const ganho = (s) => (s.length > 1 ? s[s.length - 1][1] - s[s.length - 2][1] : 0)
  const ga = ganho(sa), gb = ganho(sb)
  // diferença ao longo do tempo (pontos em que os dois foram lidos com o mesmo % apurado)
  const mapaB = new Map(sb.map((p) => [p[0], p]))
  const difSerie = sa.filter((p) => mapaB.has(p[0])).map((p) => ({ x: p[0], y: p[1] - mapaB.get(p[0])[1] }))
  let tendDif = ''
  if (difSerie.length > 2) {
    const ini = difSerie[Math.max(0, difSerie.length - 6)].y, fim = difSerie[difSerie.length - 1].y
    const quemA = fim >= 0 ? a : b
    const abrindo = Math.abs(fim) > Math.abs(ini)
    tendDif = `<p class="tend ${abrindo ? 'tend-alta' : 'tend-queda'}"><span class="tend-icone">${abrindo ? '↔️' : '🔜'}</span><span><strong>${
      abrindo ? 'Diferença aumentando' : 'Diferença diminuindo'
    }</strong> nas últimas atualizações: de ${fmt.format(Math.abs(ini))} para ${fmt.format(Math.abs(fim))} votos, com ${esc(quemA.nome)} na frente.</span></p>`
  }
  const lado = (c, cor, pos, g) => `<div class="comp-lado" style="${estiloCor(cor)}">
      ${foto(c, cor)}
      <strong class="comp-nome-g">${esc(c.nome)}</strong>
      <div>${pill(c.partido, cor)}</div>
      <div class="comp-selos">${selo(c)} ${seloChance(d, c, aba, true)}</div>
    </div>`
  const linha = (rot, va, vb, maiorMelhor = true, fmtv = (v) => v) => {
    const vence = va === vb ? 0 : (va > vb) === maiorMelhor ? 1 : 2
    return `<tr><td class="${vence === 1 ? 'vence' : ''}">${fmtv(va)}</td><th>${rot}</th><td class="${vence === 2 ? 'vence' : ''}">${fmtv(vb)}</td></tr>`
  }
  const ptsPct = (s) => s.filter((p) => p[3] != null).map((p) => ({ x: p[0], y: p[3] }))
  const ptsVot = (s) => s.map((p) => ({ x: p[0], y: p[1] }))
  return `<section class="cartao comp-cabeca">
      <div class="comp-topo">${lado(a, corA, pa, ga)}<span class="comp-vs">×</span>${lado(b, corB, pb, gb)}</div>
      <div class="comp-veredito" style="${estiloCor(corPartido(lider.partido))}">
        ${dif === 0 ? 'Empatados' : `<strong>${esc(lider.nome)}</strong> está <strong>${fmt.format(dif)}</strong> votos à frente (${fmtPct.format(Math.abs(a.percentual - b.percentual))} p.p.)`}
      </div>
      <table class="comp-tabela"><tbody>
        ${linha('Votos', a.votos, b.votos, true, (v) => fmt.format(v))}
        ${linha('% dos válidos', a.percentual, b.percentual, true, (v) => `${fmtPct.format(v)}%`)}
        ${linha('Posição', pa, pb, false, (v) => `${v}º`)}
        ${ga || gb ? linha('Ganho na última atualização', ga, gb, true, (v) => `+${fmt.format(v)}`) : ''}
      </tbody></table>
      <p class="nota">${fmtPct.format(d.secoes.percentual)}% das seções apuradas${det.mun ? ` · ${esc(det.mun.nm)}` : ''}. Em verde, quem leva vantagem em cada linha.</p>
      <div class="pm-botoes"><button type="button" class="botao secundario" data-trocar-comp>Trocar candidato</button>
        <button type="button" class="botao secundario" data-sair-comp>Sair da comparação</button></div>
    </section>
    <section class="cartao"><h3>Evolução</h3>${tendDif}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsPct(sa) }, { nome: b.nome, cor: corB, pontos: ptsPct(sb) }], { fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsVot(sa) }, { nome: b.nome, cor: corB, pontos: ptsVot(sb) }], { fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${sa.length < 2 || sb.length < 2 ? '<p class="nota">Os gráficos aparecem depois de algumas atualizações com votos novos.</p>' : ''}
    </section>
    ${det.abr === UF || aba?.id === 'presidente' ? secaoCompMunicipios(det, a, b, corA, corB) : ''}`
}

function secaoCompMunicipios(det, a, b, corA, corB) {
  const cm = det.comp.porMun
  const botoes = `<div class="pm-botoes">
      ${[['regiao', 'Grande Florianópolis'], ['maiores', 'Maiores cidades'], ['todos', 'Todos + regiões']]
        .map(([k, r]) => `<button type="button" class="botao ${cm?.escopo === k ? '' : 'secundario'}" data-comp-mun="${k}">${r}</button>`)
        .join('')}</div>`
  if (!cm) return `<section class="cartao"><h3>📍 Onde cada um é mais forte</h3><p class="nota">Compara os votos dos dois em cada município (arquivos do TSE).</p>${botoes}</section>`
  const agrupar = cm.escopo === 'todos' && !cm.carregando ? cm.agrupar || 'mun' : 'mun'
  let linhas = cm.linhas
  if (agrupar === 'meso') {
    const g = new Map()
    for (const l of cm.linhas) {
      const k = MUN_REG.get(l.cd)?.meso || '?'
      const x = g.get(k) || { nm: MESORREGIOES[k] || 'Outros', a: 0, b: 0 }
      x.a += l.a
      x.b += l.b
      g.set(k, x)
    }
    linhas = [...g.values()]
  }
  linhas = [...linhas].sort((x, y) => y.a + y.b - (x.a + x.b))
  const venceA = cm.linhas.filter((l) => l.a > l.b).length, venceB = cm.linhas.filter((l) => l.b > l.a).length
  const limite = cm.verTodos || agrupar !== 'mun' ? linhas.length : 40
  return `<section class="cartao"><h3>📍 Onde cada um é mais forte</h3>${botoes}
    ${cm.escopo === 'todos' && !cm.carregando ? `<div class="segmentado" role="group"><button type="button" data-comp-agrupar="mun" aria-pressed="${agrupar === 'mun'}">Municípios</button><button type="button" data-comp-agrupar="meso" aria-pressed="${agrupar === 'meso'}">Regiões</button></div>` : ''}
    ${cm.carregando ? `<p class="nota">Consultando ${cm.feitos} de ${cm.total} municípios…</p>` : `<p class="comp-placar"><span style="${estiloCor(corA)}">${esc(a.nome)}: <strong>${venceA}</strong></span> × <span style="${estiloCor(corB)}">${esc(b.nome)}: <strong>${venceB}</strong></span> <span class="mudo">municípios na frente</span></p>`}
    <table class="tabela comp-mun"><thead><tr><th>${agrupar === 'meso' ? 'Região' : 'Município'}</th><th class="dir">${esc(a.nome)}</th><th class="dir">${esc(b.nome)}</th></tr></thead><tbody>${linhas
      .slice(0, limite)
      .map((l) => {
        const tot = l.a + l.b || 1
        return `<tr><td>${esc(l.nm)}<div class="duelo"><span style="width:${(100 * l.a) / tot}%;background:${corA}"></span><span class="b" style="width:${(100 * l.b) / tot}%;background:${corB}"></span></div></td>
          <td class="dir ${l.a > l.b ? 'vence' : ''}">${fmt.format(l.a)}</td><td class="dir ${l.b > l.a ? 'vence' : ''}">${fmt.format(l.b)}</td></tr>`
      })
      .join('')}</tbody></table>
    ${linhas.length > limite ? `<button type="button" class="botao secundario" data-comp-ver-todos>Mostrar todos os ${linhas.length}</button>` : ''}
  </section>`
}

async function carregarCompMunicipios(escopo) {
  const det = estado.detalhe
  if (!det?.comp) return
  const aba = ABAS.find((x) => x.id === det.aba)
  const lista = await municipios(aba)
  const porCd = new Map(lista.map((m) => [m.cd, m]))
  const alvo =
    escopo === 'regiao'
      ? lista.filter((m) => NUCLEO.has(chaveNome(m.nm)) || EXPANSAO.has(chaveNome(m.nm)))
      : escopo === 'maiores'
        ? MUNICIPIOS_SC.slice(0, 15).map(([cd, , nm]) => porCd.get(cd) || { cd, nm })
        : lista
  det.ctrlComp?.abort()
  const ctrl = new AbortController()
  det.ctrlComp = ctrl
  const cm = { escopo, carregando: true, feitos: 0, total: alvo.length, linhas: [] }
  det.comp.porMun = cm
  renderDetalhe()
  let ultimo = 0
  await emLotes(alvo, 6, async (m) => {
    try {
      const d = await buscar(aba, UF, TURNO, ctrl.signal, { cd: m.cd, nm: m.nm })
      const va = d.candidatos.find((x) => x.sqcand === det.sqcand)?.votos || 0
      const vb = d.candidatos.find((x) => x.sqcand === det.comp.sqcand)?.votos || 0
      cm.linhas.push({ cd: m.cd, nm: m.nm, a: va, b: vb })
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
    cm.feitos++
    if (estado.detalhe === det && Date.now() - ultimo > 600) {
      ultimo = Date.now()
      renderDetalhe()
    }
  }, ctrl.signal).catch(() => {})
  if (ctrl.signal.aborted) return
  cm.carregando = false
  if (estado.detalhe === det) renderDetalhe()
}

detalheEl.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-fechar]') || ev.target === detalheEl) return fecharDetalhe()
  const favBtn = ev.target.closest('[data-fav]')
  if (favBtn) {
    tratarFav(favBtn)
    renderDetalhe()
    return
  }
  const det = estado.detalhe
  if (ev.target.closest('[data-comparar]') || ev.target.closest('[data-trocar-comp]')) {
    det.escolhendo = true
    det.buscaComp = ''
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  const compSq = ev.target.closest('[data-comp-sq]')
  if (compSq) {
    det.escolhendo = false
    det.comp = { sqcand: compSq.dataset.compSq, porMun: null }
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  if (ev.target.closest('[data-sair-comp]')) {
    det.escolhendo = false
    det.ctrlComp?.abort()
    det.comp = null
    return renderDetalhe()
  }
  const cmBtn = ev.target.closest('[data-comp-mun]')
  if (cmBtn) return carregarCompMunicipios(cmBtn.dataset.compMun)
  const cagBtn = ev.target.closest('[data-comp-agrupar]')
  if (cagBtn && det.comp?.porMun) {
    det.comp.porMun.agrupar = cagBtn.dataset.compAgrupar
    return renderDetalhe()
  }
  if (ev.target.closest('[data-comp-ver-todos]') && det.comp?.porMun) {
    det.comp.porMun.verTodos = true
    return renderDetalhe()
  }
  const pmBtn = ev.target.closest('[data-por-mun]')
  if (pmBtn) return carregarPorMunicipio(pmBtn.dataset.porMun)
  const zBtn = ev.target.closest('[data-zonas-mun]')
  if (zBtn) return alternarZonas(zBtn.dataset.zonasMun)
  const agBtn = ev.target.closest('[data-agrupar]')
  if (agBtn && estado.detalhe?.porMun) {
    estado.detalhe.porMun.agrupar = agBtn.dataset.agrupar
    return renderDetalhe()
  }
  if (ev.target.closest('[data-pm-ver-todos]') && estado.detalhe?.porMun) {
    estado.detalhe.porMun.verTodos = true
    renderDetalhe()
  }
})
detalheEl.addEventListener('input', (ev) => {
  if (ev.target.id === 'comp-busca' && estado.detalhe) {
    estado.detalhe.buscaComp = ev.target.value
    return renderDetalhe()
  }
  if (ev.target.id !== 'det-busca-mun' || !estado.detalhe?.porMun) return
  estado.detalhe.porMun.busca = ev.target.value
  renderDetalhe()
})
detalheEl.addEventListener('pointermove', (ev) => {
  const el = ev.target.closest('[data-dica]')
  if (el) mostrarDica(el, ev.clientX, ev.clientY)
  else if (ev.pointerType === 'mouse') dica.hidden = true
})
detalheEl.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('[data-dica]')
  if (!el || ev.pointerType === 'mouse') return
  mostrarDica(el, ev.clientX, ev.clientY)
  clearTimeout(dicaTimer)
  dicaTimer = setTimeout(() => (dica.hidden = true), 2500)
})
detalheEl.addEventListener('scroll', () => (dica.hidden = true), { passive: true })

/* ---------------- preferências e "Sobre" ---------------- */

const PREF = { mostrar2022: lerLocal('pref:2022', '1') === '1' }
function definirMostrar2022(v) {
  PREF.mostrar2022 = v
  gravarLocal('pref:2022', v ? '1' : '0')
  montarAbas()
  renderizar()
}

function interruptor(id, ligado, rotulo, desc) {
  return `<label class="interruptor"><input type="checkbox" data-pref="${id}" ${ligado ? 'checked' : ''}>
    <span class="trilho" aria-hidden="true"><span></span></span>
    <span><strong>${rotulo}</strong><br><span class="mudo">${desc}</span></span></label>`
}

function renderSobre() {
  return `<section class="cartao criador">
      <div class="criador-topo"><span class="criador-foto"><span aria-hidden="true">MC</span><img src="img/maicon-combat.jpg?v=${VERSAO}" alt="Foto de Maicon Combat" onerror="this.remove()"></span>
        <div><p class="criador-rot">Criado e desenvolvido por</p><h2>Maicon Combat</h2></div></div>
      <p>Este aplicativo de acompanhamento da apuração das Eleições 2026, com foco em Santa Catarina, foi idealizado por <strong>Maicon Combat</strong>.</p>
      <a class="botao criador-link" href="https://maiconcombat.com.br" target="_blank" rel="noopener">Conheça o Maicon Combat · maiconcombat.com.br ↗</a>
    </section>
    <section class="cartao"><h3>⚙️ Preferências</h3>
      ${interruptor('2022', PREF.mostrar2022, 'Mostrar dados de 2022', 'Aba "📅 2022", comparação 2022 × 2026 na ficha de cada candidato e % de 2022 nas tabelas por município.')}
      <p class="nota">As preferências ficam salvas neste aparelho.</p>
    </section>
    <section class="cartao"><h3>📚 De onde vêm os dados</h3>
      <ul class="det-lista">
        <li><strong>2026, ao vivo:</strong> arquivos oficiais de divulgação do <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noopener">TSE</a>, consultados direto do seu aparelho a cada 30 segundos.</li>
        <li><strong>2022:</strong> arquivos oficiais do Portal de Dados Abertos do <a href="https://dadosabertos.tse.jus.br/dataset/resultados-2022" target="_blank" rel="noopener">TSE</a>: votação por candidato, município e zona, e votação por seção eleitoral (SC).</li>
        <li><strong>Bairros e locais de votação de Florianópolis:</strong> TRE-SC.</li>
        <li><strong>Regiões e população:</strong> IBGE.</li>
      </ul>
      <p class="nota">Projeto independente, sem vínculo com a Justiça Eleitoral. Projeções e chances de reverter são estimativas do app; vale sempre o resultado oficial do TSE.</p>
    </section>`
}

/* ---------------- eleições de 2022 (SC) ---------------- */

// Resultado oficial de 2022 em SC (TSE, votacao_candidato_munzona_2022), em dados2022/.
const VERSAO = new URL(import.meta.url).searchParams.get('v') || ''
const H22 = { resumo: null, carregando: null, mun: new Map(), atual: null, atualT: 0, sel: 't1-c7', busca: '' }
const chaveNomeCompleto = (s) => semAcento(s || '').replace(/[^a-z]/g, '')
const ROTULO_ELEICAO = { 't1-c3': 'Governador · 1º turno', 't2-c3': 'Governador · 2º turno', 't1-c5': 'Senado', 't1-c6': 'Dep. Federal', 't1-c7': 'Dep. Estadual' }
const ABA_DO_CARGO = { 3: 'governador', 5: 'senador', 6: 'depfed', 7: 'depest' }

function resumo2022() {
  if (H22.resumo) return Promise.resolve(H22.resumo)
  H22.carregando ??= fetch(`dados2022/resumo.json?v=${VERSAO}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      H22.indice = new Map()
      for (const el of j.eleicoes) {
        el.id = `t${el.turno}-c${el.cargo}`
        el.candidatos.forEach((x, i) => {
          const c = { sq: x[0], numero: x[1], nome: x[2], nomeCompleto: x[3], partido: x[4], fed: x[5], votos: x[6], sit: x[7], pos: i + 1 }
          el.candidatos[i] = c
          const k = chaveNomeCompleto(c.nomeCompleto)
          if (!H22.indice.has(k)) H22.indice.set(k, [])
          H22.indice.get(k).push({ el, c })
        })
      }
      H22.resumo = j
      return j
    })
    .catch((e) => {
      H22.carregando = null
      throw e
    })
  return H22.carregando
}

function mun2022(id) {
  if (!H22.mun.has(id)) {
    const p = fetch(`dados2022/mun-${id}.json?v=${VERSAO}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP'))))
    p.catch(() => H22.mun.delete(id))
    H22.mun.set(id, p)
    p.then((j) => (p.valor = j)).catch(() => {})
  }
  return H22.mun.get(id)
}

// Participações de um candidato de 2026 em 2022 (pelo nome completo).
function achar2022(c) {
  if (!H22.resumo || !c?.nomeCompleto) return []
  return H22.indice.get(chaveNomeCompleto(c.nomeCompleto)) || []
}

const pctDe = (v, tot) => (tot ? (100 * v) / tot : 0)
const seta = (dp) => (Math.abs(dp) < 0.005 ? '＝' : dp > 0 ? `▲ ${fmtPct.format(dp)}` : `▼ ${fmtPct.format(-dp)}`)
const situ2022 = (sit) =>
  /^ELEITO/.test(sit) ? `<span class="tag eleito-tse"><b>✔ ${esc(sit.toLowerCase().replace(/^./, (m) => m.toUpperCase()))}</b></span>` : `<span class="tag nao-eleito">${esc(sit.toLowerCase().replace(/^./, (m) => m.toUpperCase()))}</span>`

function secao2022(c, d, aba) {
  if (!PREF.mostrar2022) return ''
  if (DEMO) return ''
  if (!H22.resumo) {
    resumo2022().then(() => estado.detalhe && renderDetalhe()).catch(() => {})
    return ''
  }
  const parts = achar2022(c)
  if (!parts.length) return `<section class="cartao"><h3>📅 2022 × 2026</h3><p class="nota">Não encontrei ${esc(c.nome)} entre os candidatos de SC em 2022 (comparação pelo nome completo).</p></section>`
  const linhas = parts
    .sort((a, b) => a.el.turno - b.el.turno)
    .map(({ el, c: v }) => {
      const p22 = pctDe(v.votos, el.validos)
      const mesmo = el.cargo === aba?.cargo && !d.mun
      const agora = mesmo
        ? `<div class="h22-agora">Agora (${fmtPct.format(d.secoes.percentual)}% apurado): <strong>${fmt.format(c.votos)}</strong> votos · ${fmtPct.format(c.percentual)}% <span class="h22-delta ${c.percentual >= p22 ? 'sobe' : 'desce'}">${seta(c.percentual - p22)} p.p.</span>
           <br><span class="mudo">Já tem ${fmtPct.format(pctDe(c.votos, v.votos))}% dos votos que teve em 2022.</span></div>`
        : ''
      return `<div class="h22-item">
        <p><strong>${esc(ROTULO_ELEICAO[el.id] || el.nome)}</strong> · ${pill(v.partido)} ${v.fed ? `<span class="mudo">(${esc(v.fed)})</span>` : ''}</p>
        <p><strong>${fmt.format(v.votos)}</strong> votos · ${fmtPct.format(p22)}% · ${v.pos}º de ${el.candidatos.length} ${situ2022(v.sit)}</p>
        ${el.cargo !== aba?.cargo ? `<p class="mudo">Em 2026 disputa outro cargo (${esc(aba?.rotulo || '')}).</p>` : ''}
        ${agora}
      </div>`
    })
    .join('')
  return `<section class="cartao h22"><h3>📅 2022 × 2026</h3>${linhas}
    <p class="nota">Resultado oficial de 2022 (TSE). % de 2022 = votos ÷ votos nominais válidos do cargo em SC. Comparação pelo nome completo.</p></section>`
}

// coluna "2022" na tabela de municípios da ficha
function preparar2022Mun(det) {
  if (!PREF.mostrar2022) return ''
  if (DEMO) return
  resumo2022()
    .then(() => {
      const d = dadosDetalhe()
      const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
      const p = achar2022(c).find((x) => x.el.turno === 1)
      if (!p) return
      det.h22 = { id: p.el.id, sq: p.c.sq, cargo: p.el.cargo }
      return mun2022(p.el.id).then(() => estado.detalhe === det && renderDetalhe())
    })
    .catch(() => {})
}
function dados2022Det(det) {
  const h = det?.h22
  const j = h && H22.mun.get(h.id)?.valor
  return j ? { j, cand: j.cand[h.sq] || {} } : null
}
function linha2022Mun(det, cd, pctAgora) {
  if (!PREF.mostrar2022) return ''
  const x = dados2022Det(det)
  if (!x) return ''
  const p22 = pctDe(x.cand[cd] || 0, x.j.validos[cd] || 0)
  return `<div class="h22-mun">2022: ${fmtPct.format(p22)}% <span class="h22-delta ${pctAgora >= p22 ? 'sobe' : 'desce'}">${seta(pctAgora - p22)}</span></div>`
}
function linha2022Grupo(det, cds, pctAgora) {
  if (!PREF.mostrar2022) return ''
  const x = dados2022Det(det)
  if (!x || !cds || pctAgora == null) return ''
  const v = cds.reduce((a, cd) => a + (x.cand[cd] || 0), 0), t = cds.reduce((a, cd) => a + (x.j.validos[cd] || 0), 0)
  const p22 = pctDe(v, t)
  return `<div class="h22-mun">2022: ${fmtPct.format(p22)}% <span class="h22-delta ${pctAgora >= p22 ? 'sobe' : 'desce'}">${seta(pctAgora - p22)}</span></div>`
}

// aba 📅 2022
async function carregar2022(ctrl) {
  try {
    await resumo2022()
  } catch {
    conteudo.innerHTML = '<div class="cartao vazio erro"><p>Não consegui carregar os dados de 2022.</p></div>'
    return
  }
  estado.dados = { h22: true }
  renderizar()
  // quem de 2022 está na disputa de 2026 (estado inteiro)
  if (!H22.atual || Date.now() - H22.atualT > 120_000) {
    const mapa = new Map()
    await Promise.allSettled(
      Object.values(ABA_DO_CARGO).map(async (id) => {
        const aba = ABAS.find((a) => a.id === id)
        const d = await buscar(aba, UF, TURNO, ctrl.signal)
        registrarSessao(aba.id, UF, null, d)
        d.candidatos.forEach((c, i) => mapa.set(chaveNomeCompleto(c.nomeCompleto), { aba, c, d, pos: i + 1 }))
      }),
    )
    if (ctrl.signal.aborted) return
    if (mapa.size) {
      H22.atual = mapa
      H22.atualT = Date.now()
    }
  }
  renderizar()
  statusEl.textContent = 'Dados de 2022 · TSE'
  statusEl.className = 'status ok'
  if (estado.controlador === ctrl) agendar()
}

function atual2026(c22) {
  return H22.atual?.get(chaveNomeCompleto(c22.nomeCompleto)) || null
}

// arquivos por município com os votos de cada seção (dados2022/secoes/<código TSE>.json)
function secoes2022(cd) {
  if (!H22.sec) H22.sec = new Map()
  if (!H22.sec.has(cd)) {
    const p = fetch(`dados2022/secoes/${cd}.json?v=${VERSAO}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP'))))
    p.then((j) => {
      p.valor = j
      renderizar()
    }).catch(() => {
      H22.sec.delete(cd)
      H22.erroSec = cd
      renderizar()
    })
    H22.sec.set(cd, p)
  }
  return H22.sec.get(cd).valor || null
}

const BAIRRO_LOCAL_FLORIPA = new Map(FLORIPA.locais.map((l) => [`${l.z}-${l.cod}`, l.bairro]))
const tituloLocal = (s) => titulo22(s)
function titulo22(s) {
  const MIN = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em'])
  return String(s)
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i && MIN.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\b(Sc|Br|Ii|Iii|Iv|Ifsc|Udesc|Ufsc|Senai|Sesi|Sesc)\b/g, (m) => m.toUpperCase())
}

// Soma os votos das seções do município filtrando por zona/local/bairro/seção, e agrupa.
function agregar2022(arq, el, filtro, grupo, foco) {
  const votos = arq.votos[el.id] || {}
  const anul = new Set(H22.resumo.anulados.filter((x) => x.startsWith(el.id + '-')).map((x) => Number(x.split('-')[2])))
  const prop = el.cargo === 6 || el.cargo === 7
  const total = new Map()
  const grupos = new Map()
  let validos = 0, brancos = 0, nulos = 0, secoes = 0
  for (const [zs, arr] of Object.entries(votos)) {
    const [z] = zs.split('-')
    const loc = arq.secoes[zs]
    const bairro = arq.cd === FLORIPA_CD ? BAIRRO_LOCAL_FLORIPA.get(loc) || 'Bairro não informado' : null
    if (filtro.zona && z !== filtro.zona) continue
    if (filtro.local && loc !== filtro.local) continue
    if (filtro.bairro && bairro !== filtro.bairro) continue
    if (filtro.secao && zs !== filtro.secao) continue
    secoes++
    const chave = grupo === 'zona' ? z : grupo === 'local' ? loc : grupo === 'bairro' ? bairro : zs
    const g = grupos.get(chave) || { chave, validos: 0, foco: 0, top: new Map() }
    for (let i = 0; i < arr.length; i += 2) {
      const nr = arr[i], v = arr[i + 1]
      if (nr === 95) { brancos += v; continue }
      if (nr === 96 || nr === 97 || anul.has(nr)) { nulos += v; continue }
      validos += v
      g.validos += v
      total.set(nr, (total.get(nr) || 0) + v)
      if (nr === foco) g.foco += v
      if (!prop || nr > 99) g.top.set(nr, (g.top.get(nr) || 0) + v)
    }
    grupos.set(chave, g)
  }
  return { total, grupos: [...grupos.values()], validos, brancos, nulos, secoes }
}

function nomeVotavel(el, nr) {
  if (nr < 100 && (el.cargo === 6 || el.cargo === 7)) {
    const sg = H22.resumo.partidos[String(nr)] || String(nr)
    return { nome: `Legenda ${sg}`, partido: sg, legenda: true }
  }
  const c = el.porNumero?.get(String(nr))
  return c ? { nome: c.nome, partido: c.partido, sit: c.sit, c } : { nome: `Nº ${nr}`, partido: '' }
}

function rotuloGrupo(arq, grupo, chave) {
  if (grupo === 'zona') return `${Number(chave)}ª zona${arq.cd === FLORIPA_CD && ROTULO_ZONA[z4(chave)] ? ` · ${ROTULO_ZONA[z4(chave)]}` : ''}`
  if (grupo === 'local') {
    const l = arq.locais[chave] || ['Local ' + chave, '']
    const b = arq.cd === FLORIPA_CD ? BAIRRO_LOCAL_FLORIPA.get(chave) : null
    return `${tituloLocal(l[0])}<div class="cand-meta">${b ? esc(b) + ' · ' : ''}${esc(tituloLocal(l[1]))} · ${Number(chave.split('-')[0])}ª zona</div>`
  }
  if (grupo === 'bairro') return esc(chave)
  const [z, sec] = chave.split('-')
  const l = arq.locais[arq.secoes[chave]] || ['']
  return `Seção ${sec}<div class="cand-meta">${esc(tituloLocal(l[0]))} · ${Number(z)}ª zona</div>`
}

function render2022Local(el) {
  const L = H22.local
  const arq = secoes2022(L.cd)
  if (!arq) return `<section class="cartao vazio">${H22.erroSec === L.cd ? 'Não consegui carregar as seções deste município.' : `Carregando as seções de ${esc(L.nm)}…`}</section>`
  arq.cd = L.cd
  if (!el.porNumero) el.porNumero = new Map(el.candidatos.map((c) => [c.numero, c]))
  const floripa = L.cd === FLORIPA_CD
  const grupos = ['zona', 'local', ...(floripa ? ['bairro'] : []), 'secao']
  const grupo = grupos.includes(H22.grupo) ? H22.grupo : 'zona'
  const filtro = { zona: L.zona, local: L.localVot, bairro: L.bairro, secao: L.secao }
  const ag = agregar2022(arq, el, filtro, grupo, H22.foco)
  const ranking = [...ag.total.entries()].sort((a, b) => b[1] - a[1])
  const prop = el.cargo === 6 || el.cargo === 7
  const zonas = [...new Set(Object.keys(arq.secoes).map((zs) => zs.split('-')[0]))].sort((a, b) => a - b)
  const migalhas = [
    `<button type="button" class="atalho" data-h22-nivel="mun">${esc(L.nm)}</button>`,
    L.zona ? `<button type="button" class="atalho" data-h22-nivel="zona">${Number(L.zona)}ª zona</button>` : '',
    L.bairro ? `<span class="atalho ativo">${esc(L.bairro)}</span>` : '',
    L.localVot ? `<span class="atalho ativo">${esc(tituloLocal((arq.locais[L.localVot] || [''])[0]))}</span>` : '',
    L.secao ? `<span class="atalho ativo">Seção ${L.secao.split('-')[1]}</span>` : '',
  ].filter(Boolean).join('<span class="mudo">›</span>')
  const focoInfo = H22.foco != null ? nomeVotavel(el, H22.foco) : null
  const linhasRank = ranking.slice(0, H22.verTodos ? 400 : 25).map(([nr, v], i) => {
    const n = nomeVotavel(el, nr)
    const cor = corPartido(n.partido)
    return `<li class="h22-cand ${H22.foco === nr ? 'foco' : ''}" style="${estiloCor(cor)}" data-h22-foco="${nr}">
      <div class="cand-linha"><span class="pos">${i + 1}º</span><span class="cand-nome">${esc(n.nome)}</span> ${n.partido ? pill(n.partido) : ''} ${n.sit ? situ2022(n.sit) : ''}</div>
      <div class="cand-meta">${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, ag.validos))}% dos válidos${n.c ? ` · em SC: ${fmt.format(n.c.votos)}` : ''}</div></li>`
  }).join('')
  const linhasGrupo = ag.grupos
    .map((g) => {
      const [nrTop, vTop] = [...g.top.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0]
      return { g, nrTop, vTop }
    })
    .sort((a, b) => (H22.foco != null ? b.g.foco - a.g.foco : b.g.validos - a.g.validos))
  const maxLinhas = H22.verGrupos ? linhasGrupo.length : 60
  return `<section class="cartao">
      <h3>📍 ${esc(L.nm)} · 2022</h3>
      <div class="atalhos-chips migalhas">${migalhas}</div>
      ${!L.zona && zonas.length > 1 ? `<div class="zonas"><span class="zonas-rot">Zona:</span>${zonas.map((z) => `<button type="button" class="filtro" data-h22-zona="${z}">${Number(z)}ª${floripa && ROTULO_ZONA[z4(z)] ? ` · ${ROTULO_ZONA[z4(z)]}` : ''}</button>`).join('')}</div>` : ''}
      <div class="calc-num h22-tot">
        <div><span>Votos válidos</span><strong>${fmt.format(ag.validos)}</strong>${prop ? '<small>nominais + legenda</small>' : ''}</div>
        <div><span>Brancos</span><strong>${fmt.format(ag.brancos)}</strong></div>
        <div><span>Nulos</span><strong>${fmt.format(ag.nulos)}</strong><small>inclui anulados</small></div>
        <div><span>Seções</span><strong>${fmt.format(ag.secoes)}</strong></div>
      </div>
    </section>
    <section class="cartao"><h3>Mais votados aqui · ${esc(ROTULO_ELEICAO[el.id] || el.nome)}</h3>
      <p class="nota">Toque num candidato para ver os votos dele em cada ${grupo === 'secao' ? 'seção' : grupo}.</p>
      <ul class="h22-lista">${linhasRank}</ul>
      ${ranking.length > 25 && !H22.verTodos ? `<button type="button" class="botao secundario" data-h22-todos>Mostrar todos (${ranking.length})</button>` : ''}
    </section>
    <section class="cartao"><h3>Por ${grupo === 'secao' ? 'seção' : grupo === 'local' ? 'local de votação' : grupo}${focoInfo ? ` · ${esc(focoInfo.nome)}` : ''}</h3>
      <div class="segmentado" role="group">${grupos
        .map((k) => `<button type="button" data-h22-grupo="${k}" aria-pressed="${grupo === k}">${{ zona: 'Zonas', local: 'Locais', bairro: 'Bairros', secao: 'Seções' }[k]}</button>`)
        .join('')}</div>
      ${focoInfo ? `<p class="nota">Votos de <strong>${esc(focoInfo.nome)}</strong> em cada linha. <button type="button" class="link-zonas" data-h22-foco="">limpar</button></p>` : ''}
      <table class="tabela h22-grupos"><thead><tr><th>${{ zona: 'Zona', local: 'Local', bairro: 'Bairro', secao: 'Seção' }[grupo]}</th><th class="dir">${focoInfo ? 'Votos dele' : 'Válidos'}</th></tr></thead><tbody>${linhasGrupo
        .slice(0, maxLinhas)
        .map(({ g, nrTop, vTop }) => {
          const top = nrTop != null ? nomeVotavel(el, nrTop) : null
          const alvo = grupo === 'zona' ? `data-h22-zona="${g.chave}"` : grupo === 'local' ? `data-h22-local="${esc(g.chave)}"` : grupo === 'bairro' ? `data-h22-bairro="${esc(g.chave)}"` : `data-h22-secao="${esc(g.chave)}"`
          return `<tr class="clicavel" ${alvo}><td>${rotuloGrupo(arq, grupo, g.chave)}
              ${top ? `<div class="cand-meta">🏆 ${esc(top.nome)} ${pill(top.partido)} ${fmtPct.format(pctDe(vTop, g.validos))}%</div>` : ''}</td>
            <td class="dir">${focoInfo ? `<strong>${fmt.format(g.foco)}</strong><div class="cand-meta">${fmtPct.format(pctDe(g.foco, g.validos))}%</div>` : fmt.format(g.validos)}</td></tr>`
        })
        .join('')}</tbody></table>
      ${linhasGrupo.length > maxLinhas ? `<button type="button" class="botao secundario" data-h22-vergrupos>Mostrar todas as ${linhasGrupo.length} linhas</button>` : ''}
      <p class="nota">Toque numa linha para entrar nela. Fonte: TSE, votação por seção eleitoral 2022.${floripa ? ' Bairros pelo cadastro de locais de votação do TRE-SC.' : ''}</p>
    </section>`
}

function seletorLocal2022() {
  const L = H22.local
  const termo = semAcento((H22.buscaMun || '').trim())
  const achados = termo ? MUNICIPIOS_SC.filter((m) => semAcento(m[2]).includes(termo)).slice(0, 10) : []
  const gf = GRANDE_FLORIPA.map((nm) => MUNICIPIOS_SC.find((m) => chaveNome(m[2]) === chaveNome(nm))).filter(Boolean).slice(0, 5)
  const atalhos = [...gf, ...MUNICIPIOS_SC.filter((m) => !gf.includes(m)).slice(0, 6)]
  return `<div class="h22-onde">
    <div class="atalhos-chips">
      <button type="button" class="atalho regiao ${!L ? 'ativo' : ''}" data-h22-mun="">🗺️ SC inteira</button>
      ${atalhos.map((m) => `<button type="button" class="atalho ${L?.cd === m[0] ? 'ativo' : ''}" data-h22-mun="${m[0]}" data-h22-nm="${esc(m[2])}">${esc(m[2])}</button>`).join('')}
    </div>
    <input id="h22-mun" type="search" autocomplete="off" placeholder="📍 Outro município (resultados por zona, local e seção)…" value="${esc(H22.buscaMun || '')}">
    ${termo ? `<div class="atalhos-chips">${achados.map((m) => `<button type="button" class="atalho" data-h22-mun="${m[0]}" data-h22-nm="${esc(m[2])}">${esc(m[2])}</button>`).join('') || '<span class="nota">Nenhum município encontrado.</span>'}</div>` : ''}
  </div>`
}

function render2022() {
  const j = H22.resumo
  if (!j) return '<div class="cartao vazio">Carregando 2022…</div>'
  const el = j.eleicoes.find((e) => e.id === H22.sel) || j.eleicoes[0]
  const prop = el.cargo === 6 || el.cargo === 7
  const pills = `<div class="segmentado h22-pills" role="group">${j.eleicoes
    .map((e) => `<button type="button" data-h22="${e.id}" aria-pressed="${e.id === el.id}">${esc(ROTULO_ELEICAO[e.id] || e.nome)}</button>`)
    .join('')}</div>`
  const eleitos = el.candidatos.filter((c) => /^ELEITO/.test(c.sit))
  const destaque = prop ? eleitos : el.candidatos.slice(0, Math.max(eleitos.length, el.cargo === 5 ? 4 : 4))
  const st26 = (c) => {
    const a = atual2026(c)
    if (!a) return H22.atual ? '<span class="mudo">Não está na disputa de 2026 em SC</span>' : '<span class="mudo">consultando 2026…</span>'
    const mesmo = a.aba.cargo === el.cargo
    const p22 = pctDe(c.votos, el.validos)
    return `<span class="h22-26">🔁 2026: <strong>${esc(a.aba.rotulo.replace(/ SC$/, ''))}</strong> ${pill(a.c.partido)} · ${a.pos}º · ${fmt.format(a.c.votos)} votos (${fmtPct.format(a.c.percentual)}%)${
      mesmo ? ` <span class="h22-delta ${a.c.percentual >= p22 ? 'sobe' : 'desce'}">${seta(a.c.percentual - p22)} p.p.</span>` : ''
    } ${selo(a.c)}</span>`
  }
  const cartaoCand = (c) => {
    const a = atual2026(c)
    const cor = corPartido(c.partido)
    return `<li class="h22-cand" style="${estiloCor(cor)}" ${a ? attrCand(a.c, a.aba.id, UF) : ''}>
      <div class="cand-linha"><span class="pos">${c.pos}º</span><span class="cand-nome">${esc(c.nome)}</span> ${pill(c.partido)} ${situ2022(c.sit)}</div>
      <div class="cand-meta">${fmt.format(c.votos)} votos · ${fmtPct.format(pctDe(c.votos, el.validos))}%${c.fed ? ` · ${esc(c.fed)}` : ''}</div>
      <div class="cand-meta">${st26(c)}</div>
    </li>`
  }
  // partidos: 2022 × 2026 (votos nominais do mesmo cargo)
  let partidos = ''
  if (prop) {
    const g22 = new Map()
    for (const c of el.candidatos) {
      const g = g22.get(c.partido) || { votos: 0, eleitos: 0 }
      g.votos += c.votos
      g.eleitos += /^ELEITO/.test(c.sit) ? 1 : 0
      g22.set(c.partido, g)
    }
    let d26 = null
    for (const v of H22.atual?.values() || []) if (v.aba.cargo === el.cargo) { d26 = v.d; break }
    const g26 = new Map()
    if (d26) for (const c of d26.candidatos) {
      const g = g26.get(c.partido) || { votos: 0, vagas: 0 }
      g.votos += c.valido ? c.votos : 0
      g.vagas += c.eleito || (c.projecao && !c.tseDefinido) ? 1 : 0
      g26.set(c.partido, g)
    }
    const tot22 = [...g22.values()].reduce((a, g) => a + g.votos, 0) || 1
    const tot26 = [...g26.values()].reduce((a, g) => a + g.votos, 0) || 1
    const siglas = [...new Set([...g22.keys(), ...g26.keys()])].sort((a, b) => (g22.get(b)?.votos || 0) - (g22.get(a)?.votos || 0))
    partidos = `<section class="cartao"><h3>Partidos: 2022 × 2026</h3>
      <p class="nota">% dos votos nominais do cargo. Vagas 2026 = eleitos pelo TSE ou, antes disso, a projeção do app${d26 ? ` (${fmtPct.format(d26.secoes.percentual)}% apurado)` : ''}.</p>
      <table class="tabela h22-part"><thead><tr><th>Partido</th><th class="dir">2022</th><th class="dir">2026</th></tr></thead><tbody>${siglas
        .filter((sg) => (g22.get(sg)?.votos || 0) / tot22 > 0.003 || (g26.get(sg)?.votos || 0) / tot26 > 0.003)
        .map((sg) => {
          const a = g22.get(sg), b = g26.get(sg)
          const p22 = a ? pctDe(a.votos, tot22) : 0, p26 = b ? pctDe(b.votos, tot26) : 0
          return `<tr style="${estiloCor(corPartido(sg))}"><td>${pill(sg)}</td>
            <td class="dir">${fmtPct.format(p22)}%<div class="cand-meta">${a?.eleitos || 0} eleitos</div></td>
            <td class="dir">${d26 ? `${fmtPct.format(p26)}% <span class="h22-delta ${p26 >= p22 ? 'sobe' : 'desce'}">${seta(p26 - p22)}</span><div class="cand-meta">${b?.vagas || 0} vagas</div>` : '–'}</td></tr>`
        })
        .join('')}</tbody></table>
      <p class="nota">Partidos mudaram de nome ou se fundiram desde 2022; a comparação é pela sigla.</p></section>`
  }
  const termo = semAcento(H22.busca.trim())
  const lista = el.candidatos.filter((c) => !termo || semAcento(`${c.nome} ${c.nomeCompleto} ${c.partido} ${c.numero}`).includes(termo))
  return `<section class="cartao resumo">
      <div class="resumo-titulo"><h2>Eleições 2022 · ${esc(el.nome)}${el.turno === 2 ? ' (2º turno)' : ''} · SC</h2><span class="selo final">Resultado oficial</span></div>
      ${pills}
      ${seletorLocal2022()}
      <p class="nota">${fmt.format(el.validos)} votos nominais válidos · ${el.candidatos.length} candidatos${prop ? ` · ${el.vagas} vagas` : ''}. Toque num candidato que concorre em 2026 para abrir a ficha atual.</p>
    </section>
    ${H22.local ? render2022Local(el) : `<section class="cartao"><h3>${prop ? `Eleitos em 2022 (${eleitos.length}) e onde estão em 2026` : 'Principais candidatos de 2022 e onde estão em 2026'}</h3>
      <ul class="h22-lista">${destaque.map(cartaoCand).join('')}</ul></section>
    ${partidos}
    <section class="cartao"><h3>Todos os candidatos de 2022</h3>
      <input id="h22-busca" type="search" placeholder="Buscar por nome, partido ou número…" value="${esc(H22.busca)}" autocomplete="off">
      <ul class="h22-lista">${lista.slice(0, termo ? 200 : 60).map(cartaoCand).join('')}</ul>
      ${lista.length > 60 && !termo ? `<p class="nota">Mostrando 60 de ${lista.length}. Use a busca.</p>` : ''}
    </section>
    `}
    <p class="nota centro">Fonte: TSE, Portal de Dados Abertos (votação por candidato/município/zona e por seção eleitoral, 2022).</p>
    <p class="centro"><label class="mini-pref"><input type="checkbox" data-pref="2022" checked> Mostrar dados de 2022 no app</label></p>`
}

/* ---------------- início ---------------- */

if (DEMO) {
  $('#aviso-demo').hidden = false
  $('#link-demo').hidden = true
}
if (TURNO === 2) $('.sub').textContent = 'Eleições Gerais · 2º turno · foco em Santa Catarina'
montarAbas()
carregar()
