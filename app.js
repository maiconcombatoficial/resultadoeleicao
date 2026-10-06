// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

import { calcularVagas } from './vagas.js?v=202610071300'
import { chanceDe, NIVEIS } from './chances.js?v=202610071300'
import { MESORREGIOES, MICRORREGIOES, MUNICIPIOS_SC, ASSOCIACOES, ASSOCIACAO_MUN } from './regioes.js?v=202610071300'
import { FLORIPA } from './floripa.js?v=202610071300'
import { corPartido, corTexto } from './cores.js?v=202610071300'

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
  { id: 'bairros', rotulo: '🏘️ Bairros', tipo: 'bai', abrangencias: ['sc'] },
  { id: 'analises', rotulo: '🔒 Análises', tipo: 'pro', abrangencias: ['sc'] },
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
const MUN_REG = new Map(MUNICIPIOS_SC.map(([cd, , nm, pop, meso, micro]) => [cd, { cd, nm, pop, meso, micro, assoc: ASSOCIACAO_MUN[cd] }]))

function regiao(id) {
  const [tipo, cod] = String(id).split(':')
  if (tipo === 'assoc') {
    if (!ASSOCIACOES[cod]) return null
    const membros = MUNICIPIOS_SC.filter((m) => ASSOCIACAO_MUN[m[0]] === cod).map(([cd, , nm]) => ({ cd, nm }))
    return { regiao: id, nm: `${cod} · ${ASSOCIACOES[cod]}`, membros }
  }
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
    <p><strong>${Number(mun.zona)}ª zona · ${esc(info.rotulo)}</strong> <span class="mudo">· ${info.locais.length} locais · ${fmt.format(info.secoes)} seções · ${fmt.format(info.eleitores)} eleitores (2026)</span></p>
    <p class="zona-bairros">🏘️ ${info.bairros.map((b) => esc(b)).join(' · ')}</p>
    <button type="button" class="link-zonas" data-ver-locais aria-expanded="${!!aberto}">🏫 ${aberto ? 'Esconder locais de votação' : `Ver os ${info.locais.length} locais de votação`} <span class="seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span></button>
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
  if (!estado.dados) conteudo.innerHTML = (['fav', 'mun', 'h22', 'bai', 'pro', 'sobre'].includes(aba.tipo) ? '' : cabecalhoAbrangencia()) + `<div class="cartao vazio">Carregando ${esc(aba.rotulo)}${munAtual() ? ` em ${esc(munAtual().nm)}` : ''}…${munAtual()?.regiao ? '<br><small id="progresso-regiao" class="mudo"></small>' : ''}</div>`
  if (aba.tipo === 'fav') return carregarFavoritos(ctrl)
  if (aba.tipo === 'mun') return carregarPainelMunicipios(ctrl)
  if (aba.tipo === 'h22') {
    if (!PREF.mostrar2022) return trocarAba('presidente')
    return carregar2022(ctrl)
  }
  if (aba.tipo === 'bai') return carregarBairros(ctrl)
  if (aba.tipo === 'pro') return carregarPro(ctrl)
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
    if (!mun && dados.projecao?.qe) (estado.qeSC ??= {})[aba.id] = dados.projecao.qe
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
  // associações da FECAM sempre à mostra (uma linha que rola para o lado)
  const assoc = `<div class="assoc-linha"><span class="atalhos-rot">🤝 Associações</span><div class="assoc-chips">${Object.keys(ASSOCIACOES)
    .map((sg) => `<button type="button" class="atalho regiao ${mun?.regiao === 'assoc:' + sg ? 'ativo' : ''}" data-regiao="assoc:${sg}" title="${esc(ASSOCIACOES[sg])}">${esc(sg)}</button>`)
    .join('')}</div></div>`
  if (!aberto) return `${assoc}<button type="button" class="atalhos-toggle" data-atalhos="1" aria-expanded="false">⚡ Mostrar cidades e regiões <span aria-hidden="true">▾</span></button>`
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
    <div class="atalhos-grupo"><span class="atalhos-rot">🤝 Associações de municípios <small>(FECAM · soma dos municípios)</small></span>
      <div class="atalhos-chips">${Object.keys(ASSOCIACOES)
        .map((sg) => `<button type="button" class="atalho regiao ${mun?.regiao === 'assoc:' + sg ? 'ativo' : ''}" data-regiao="assoc:${sg}" title="${esc(ASSOCIACOES[sg])}">${esc(sg)}</button>`)
        .join('')}</div></div>
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
  const assocs = termo.length >= 2 ? Object.entries(ASSOCIACOES).filter(([sg, nm]) => semAcento(sg).includes(termo) || semAcento(nm).includes(termo)).slice(0, 6) : []
  const bairros = termo.length >= 3 ? BAIRROS_FLORIPA.filter((b) => semAcento(b.nome).includes(termo)).slice(0, 6) : []
  ul.innerHTML =
    `<li><button type="button" data-mun-limpar class="sug-estado">🗺️ Santa Catarina inteira</button></li>` +
    assocs.map(([sg, nm]) => `<li><button type="button" data-regiao="assoc:${sg}">🤝 ${esc(sg)} <span class="mudo">· ${esc(nm)} (associação)</span></button></li>`).join('') +
    bairros
      .map((b) => `<li><button type="button" data-bairro-zona="${b.zona}">🏘️ ${esc(b.nome)} <span class="mudo">· Florianópolis, ${Number(b.zona)}ª zona</span></button></li>`)
      .join('') +
    (achados.length
      ? achados
          .map((m) => `<li><button type="button" data-mun-cd="${esc(m.cd)}" data-mun-nm="${esc(m.nm)}">${esc(m.nm)}${m.capital ? ' <span class="mudo">· capital</span>' : ''}</button></li>`)
          .join('')
      : bairros.length || assocs.length ? '' : `<li class="sug-info">Nenhum município encontrado para “${esc(input.value)}”.</li>`)
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
  const X = estadoLocal()
  if (h('[data-h22-mun]')) {
    const b = h('[data-h22-mun]')
    X.local = b.dataset.h22Mun ? { cd: b.dataset.h22Mun, nm: b.dataset.h22Nm } : null
    Object.assign(X, { buscaMun: '', foco: X === B26 ? X.foco : null, grupo: X === B26 && X.foco != null ? 'bairro' : 'zona', verTodos: false, verGrupos: false })
    renderizar()
    return
  }
  if (X.local) {
    const L = X.local
    const acao = (mud) => {
      Object.assign(L, mud)
      X.verGrupos = false
      renderizar()
      document.querySelector('.migalhas')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    if (h('[data-h22-nivel]')) return acao(h('[data-h22-nivel]').dataset.h22Nivel === 'mun' ? { zona: null, localVot: null, bairro: null, secao: null } : { localVot: null, bairro: null, secao: null })
    if (h('[data-h22-zona]')) return acao({ zona: h('[data-h22-zona]').dataset.h22Zona, localVot: null, bairro: null, secao: null, _g: (X.grupo = 'local') })
    if (h('[data-h22-local]')) return acao({ localVot: h('[data-h22-local]').dataset.h22Local, zona: h('[data-h22-local]').dataset.h22Local.split('-')[0], secao: null, _g: (X.grupo = 'secao') })
    if (h('[data-h22-bairro]')) return acao({ bairro: h('[data-h22-bairro]').dataset.h22Bairro, secao: null, _g: (X.grupo = 'local') })
    if (h('[data-h22-secao]')) return acao({ secao: h('[data-h22-secao]').dataset.h22Secao })
    if (h('[data-h22-grupo]')) {
      X.grupo = h('[data-h22-grupo]').dataset.h22Grupo
      X.verGrupos = false
      return renderizar()
    }
    if (h('[data-h22-foco]')) {
      const v = h('[data-h22-foco]').dataset.h22Foco
      X.foco = v === '' || Number(v) === X.foco ? null : Number(v)
      return renderizar()
    }
    if (h('[data-h22-todos]')) return ((X.verTodos = true), renderizar())
    if (h('[data-h22-vergrupos]')) return ((X.verGrupos = true), renderizar())
  }
  if (h('[data-h22-todos-est]')) return ((B26.verTodos = true), renderizar())
  if (estado.aba.tipo === 'bai') {
    const fav = h('[data-b26-fav]')
    if (fav) {
      const [abaId, sq] = fav.dataset.b26Fav.split('|')
      const cargo = ABAS.find((a) => a.id === abaId)?.cargo
      const sel = eleicaoDoCargo(cargo)
      Object.assign(B26, { focoSq: sq, buscaCand: '' })
      if (sel !== B26.sel) {
        B26.sel = sel
        B26.foco = null
        return carregar()
      }
      return renderizar()
    }
    if (h('[data-b26-cand]')) return ((B26.foco = Number(h('[data-b26-cand]').dataset.b26Cand)), (B26.buscaCand = ''), B26.local && (B26.grupo = 'bairro'), renderizar())
    if (h('[data-b26-limpar]')) return ((B26.foco = null), (B26.semAuto ??= new Set()).add(B26.sel), renderizar())
    const ir = h('[data-b26-ir]')
    if (ir) {
      Object.assign(B26, { local: { cd: ir.dataset.b26Ir, nm: NOME_MUN.get(ir.dataset.b26Ir) || ir.dataset.b26Ir, bairro: ir.dataset.b26Bairro }, grupo: 'local', verTodos: false, verGrupos: false })
      renderizar()
      return window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  if (h('[data-csv-local]') && X.csv) return baixarCSV(X.csv)
  const h22Btn = ev.target.closest('[data-h22]')
  if (h22Btn) {
    X.sel = h22Btn.dataset.h22
    X.busca = ''
    X.foco = null
    if (X === B26) carregar()
    else renderizar()
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

conteudo.addEventListener('click', async (ev) => {
  if (!ev.target.closest('[data-instalar]') || !pedidoInstalar) return
  pedidoInstalar.prompt()
  await pedidoInstalar.userChoice.catch(() => {})
  pedidoInstalar = null
  renderizar()
})
conteudo.addEventListener('change', (ev) => {
  if (ev.target.dataset?.pref === '2022') definirMostrar2022(ev.target.checked)
})

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'mun-busca') {
    mostrarSugestoes()
    return
  }
  if (ev.target.id === 'b26-busca') {
    B26.buscaCand = ev.target.value
    renderizar()
    return
  }
  if (ev.target.id === 'h22-mun') {
    estadoLocal().buscaMun = ev.target.value
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

// card com os mais votados da tela atual (cargo, estado ou município)
function cardLista(d) {
  const aba = estado.aba
  const mun = munAtual()
  const lista = d.candidatos.filter((c) => c.valido).slice(0, 8)
  const max = Math.max(1, ...lista.map((c) => c.percentual))
  const onde = mun ? mun.nm : NOMES_ABR[abrAtual()] || 'Santa Catarina'
  return {
    chapeu: `APURAÇÃO 2026 · ${onde.toUpperCase()}`, nome: aba.rotulo.replace(/ SC$/, ''), cor: corPartido(lista[0]?.partido),
    sub: `${onde} · ${d.final ? 'resultado final' : `${fmtPct.format(d.secoes.percentual)}% das seções apuradas`}`,
    titulo: aba.tipo === 'prop' ? 'Mais votados' : 'Resultado', subtitulo: d.atualizadoEm ? `Dados do TSE de ${d.atualizadoEm}` : '',
    total: totalCard(`Votos válidos · ${onde}`, d.votos.validos),
    linhas: lista.map((c) => ({ foto: c.foto, nome: c.nome, extra: `${c.partido} · nº ${c.numero}${c.eleito ? ' · ✔ eleito (TSE)' : c.projecao && !c.tseDefinido ? ' · ★ eleito pela projeção' : ''}`, valor: fmt.format(c.votos), dir2: `${fmtPct.format(c.percentual)}%`, frac: c.percentual / max, corBarra: corPartido(c.partido) })),
  }
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
      <div class="exportar">${botaoCard('lista', cardLista(d))}</div>
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
  return `<p class="nota">Votos de cada partido ou federação: nominais + legenda.${comProj ? ` Quociente eleitoral: <strong>${fmt.format(d.projecao.qe)}</strong>. "QE" = quantos quocientes o partido fez; "QP" = quociente partidário (vagas diretas); "Vagas" = QP + sobras, pela projeção do cálculo do TSE.` : ''}
    Toque numa linha para ver os candidatos dela.</p>
    <table class="tabela">
    <thead><tr><th>Partido / federação</th><th class="dir">Votos</th><th class="dir">%</th>${comProj ? '<th class="dir" title="Quociente partidário: vagas diretas">QP</th>' : ''}<th class="dir">${comProj ? 'Vagas' : 'Eleitos'}</th></tr></thead>
    <tbody>
    ${lista
      .map(
        (g) => `<tr class="clicavel" data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}">
        <td><div class="cand-linha">${pill(nomeCurto(g.nome), g.cor)}</div>
          <div class="cand-meta">${g.partidos.length > 1 || g.partidos[0] !== g.nome ? esc(g.partidos.join(', ')) + ' · ' : ''}${g.cands} candidatos${
            g.legenda ? ` · legenda ${fmt.format(g.legenda)}` : ''
          }${comProj ? ` · <strong>${fmtDec(g.total / d.projecao.qe)}</strong> QE` : ''}</div>
          <div class="barra fina"><span style="width:${(100 * g.total) / max}%"></span></div></td>
        <td class="dir">${fmt.format(g.total)}</td>
        <td class="dir">${fmtPct.format((100 * g.total) / total)}</td>
        ${comProj ? `<td class="dir">${g.qp || '—'}</td>` : ''}
        <td class="dir"><strong>${comProj ? g.vagasProj || '—' : g.eleitos || '—'}</strong></td>
      </tr>`,
      )
      .join('')}
    </tbody></table>`
}

// Quadro sempre visível com o quociente eleitoral e quem já atingiu (abas de deputados, estado inteiro).
function faixaQuociente(d) {
  const r = d.projecao
  const gs = [...estado.grupos].filter((g) => g.total > 0).sort((a, b) => b.total - a.total)
  const atingiram = gs.filter((g) => g.total >= r.qe)
  const perto = gs.filter((g) => g.total < r.qe && g.total >= 0.8 * r.qe)
  const parcial = !d.final && !d.tseDefinido
  return `<section class="cartao quociente">
    <h3>📐 Quociente eleitoral: <span class="qe-num">${fmt.format(r.qe)}</span> votos</h3>
    <p class="nota">${fmt.format(r.validos)} votos válidos (nominais + legenda) ÷ ${d.vagas} vagas${parcial ? ` · com ${fmtPct.format(d.secoes.percentual)}% das seções apuradas, ainda muda` : ''}.
      Cada partido ou federação elege direto uma vaga para cada quociente que atingir: é o <strong>quociente partidário (QP)</strong>.</p>
    <div class="calc-num">
      <div><span>Quociente eleitoral</span><strong>${fmt.format(r.qe)}</strong><small>votos por vaga</small></div>
      <div><span>Candidato precisa de</span><strong>${fmt.format(Math.ceil(0.1 * r.qe))}</strong><small>10% do QE para vaga por QP</small></div>
      <div><span>Partido nas sobras</span><strong>${fmt.format(Math.ceil(0.8 * r.qe))}</strong><small>80% do QE</small></div>
      <div><span>Atingiram o QE</span><strong>${atingiram.length}</strong><small>partidos/federações</small></div>
    </div>
    <ul class="qe-lista">${atingiram
      .map((g) => `<li data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}">${pill(nomeCurto(g.nome), g.cor)} <span><strong>${fmtDec(g.total / r.qe)}</strong> QE → <strong>QP ${g.qp}</strong>${g.vagasProj > g.qp ? ` + ${g.vagasProj - g.qp} nas sobras` : ''}</span></li>`)
      .join('')}${perto.map((g) => `<li class="qe-perto" data-partido="${esc(g.nome)}" style="${estiloCor(g.cor)}">${pill(nomeCurto(g.nome), g.cor)} <span>${fmtDec(g.total / r.qe)} QE · sem QP, disputa sobras${g.vagasProj ? ` (${g.vagasProj})` : ''}</span></li>`).join('')}</ul>
    <p class="nota">QE = quantas vezes o partido fez o quociente eleitoral. Detalhes do cálculo, fase a fase, logo abaixo em "Como as ${d.vagas} vagas foram calculadas".</p>
  </section>`
}
const fmtDec = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  return `${!mun && d.projecao?.qe ? faixaQuociente(d) : mun && estado.qeSC?.[estado.aba.id] ? `<p class="nota">📐 Quociente eleitoral de SC: <strong>${fmt.format(estado.qeSC[estado.aba.id])}</strong> votos por vaga (a eleição de deputados é estadual; veja em "SC inteira").</p>` : ''}${bancada}
    <section class="cartao">
      <h3>Votos por partido / federação</h3>
      ${barraEmpilhada(fatias)}
      <p class="nota">Toque numa cor para filtrar os candidatos daquele partido.</p>
      <div class="exportar">${botaoCard('lista', cardLista(d))}</div>
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
  if (estado.aba.tipo === 'h22' || estado.aba.tipo === 'bai' || estado.aba.tipo === 'pro') {
    const idf = ['h22-busca', 'h22-mun', 'pro-busca', 'b26-busca'].includes(document.activeElement?.id) ? document.activeElement.id : null
    const foco = idf ? document.activeElement.selectionStart : null
    conteudo.innerHTML = estado.aba.tipo === 'pro' ? renderPro() : estado.aba.tipo === 'bai' ? renderBairros26() : render2022()
    if (estado.aba.tipo === 'pro' && PRO.chave && PRO.aba === 'mapa') montarMapaPro()
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

// Ficha de deputado: o quociente eleitoral, o do partido do candidato e a régua dos 10%.
function secaoQuocienteFicha(d, c, det) {
  const r = d.projecao
  if (!r?.qe || det.mun) {
    const qe = estado.qeSC?.[det.aba]
    return qe ? `<section class="cartao quociente"><h3>📐 Quociente eleitoral</h3><p>Em SC: <strong>${fmt.format(qe)}</strong> votos por vaga. Abra a ficha em "SC inteira" para ver o quociente do partido.</p></section>` : ''
  }
  const g = r.grupos.find((x) => x.cands.some((y) => y.sqcand === c.sqcand))
  if (!g) return ''
  const posNoPartido = g.cands.findIndex((y) => y.sqcand === c.sqcand) + 1
  const pctQE = (100 * c.votos) / r.qe
  const passou10 = c.votos >= 0.1 * r.qe, passou20 = c.votos >= 0.2 * r.qe
  const vagas = g.eleitos.length
  const nome = nomeCurto(g.nome)
  return `<section class="cartao quociente"><h3>📐 Quociente eleitoral e partidário</h3>
    <div class="calc-num">
      <div><span>Quociente eleitoral</span><strong>${fmt.format(r.qe)}</strong><small>votos por vaga em SC</small></div>
      <div><span>${esc(nome)} fez</span><strong>${fmtDec(g.votos / r.qe)} QE</strong><small>${fmt.format(g.votos)} votos (nominais + legenda)</small></div>
      <div><span>Quociente partidário</span><strong>${g.qp}</strong><small>vaga${g.qp === 1 ? '' : 's'} direta${g.qp === 1 ? '' : 's'} do partido</small></div>
      <div><span>Vagas do partido</span><strong>${vagas}</strong><small>QP ${g.porQP} + sobras ${g.porMedia}</small></div>
    </div>
    <ul class="det-lista">
      <li>${esc(c.nome)} tem <strong>${fmt.format(c.votos)}</strong> votos = <strong>${fmtPct.format(pctQE)}%</strong> do quociente eleitoral.</li>
      <li>${passou10 ? '✅' : '❌'} ${passou10 ? 'Passou' : 'Não passou'} dos 10% do QE (<strong>${fmt.format(Math.ceil(0.1 * r.qe))}</strong> votos), mínimo para ocupar vaga do quociente partidário.${!passou10 ? ' Só pode entrar nas sobras finais.' : ''}</li>
      <li>${passou20 ? '✅' : '➖'} ${passou20 ? 'Passou' : 'Não passou'} dos 20% do QE (<strong>${fmt.format(Math.ceil(0.2 * r.qe))}</strong>), exigido nas sobras da 2ª fase.</li>
      <li>É o <strong>${posNoPartido}º</strong> mais votado de ${esc(nome)}: as ${vagas} vaga${vagas === 1 ? '' : 's'} do partido ${vagas === 1 ? 'vai' : 'vão'} para os mais votados da legenda.</li>
    </ul>
    <p class="nota">${d.tseDefinido || d.final ? 'Com o resultado final.' : `Projeção com ${fmtPct.format(d.secoes.percentual)}% das seções apuradas.`} Código Eleitoral, arts. 106 a 109.</p>
  </section>`
}

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
  const idFoco = ['det-busca-mun', 'comp-busca', 'det-busca-bairro-mun'].includes(document.activeElement?.id) ? document.activeElement.id : null
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
  // comparação: o outro candidato pode ser de outro cargo (lista carregada à parte)
  const aba2 = det.comp?.aba ? ABAS.find((a) => a.id === det.comp.aba) : aba
  const d2 = det.comp?.aba ? det.compListas?.[det.comp.aba] : d
  const c2 = det.comp && d2?.candidatos?.find((x) => x.sqcand === det.comp.sqcand)
  if (c2) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${renderComparacao(d, c, c2, aba, d2, aba2)}</div>`
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
      <div class="exportar">${botaoCard('ficha-resumo', cardFicha(det, d, c, aba, pos, total), '📸 Compartilhar desempenho', 'botao secundario')}</div>
    </section>
    <section class="cartao"><h3>Tendência</h3>${tendTxt}
      ${graficoLinha(ptsPct, { cor, fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoLinha(ptsVot, { cor, fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${ptsPos.length > 1 && new Set(ptsPos.map((p) => p.y)).size > 1 ? graficoLinha(ptsPos, { cor, fmtY: (v) => `${Math.round(-v)}º`, titulo: 'Posição (mais alto = melhor)' }) : ''}
    </section>
    ${secao2022(c, d, aba)}
    ${secaoBairros(det, c, aba)}
    <section class="cartao"><h3>${c.eleito || d.tseDefinido ? 'Situação oficial (TSE)' : 'Chance de reverter'}</h3>${textoChance(d, c, aba)}</section>
    <section class="cartao"><h3>Disputa</h3>${blocoDisputa(d, c, aba)}</section>
    ${aba?.tipo === 'prop' ? secaoQuocienteFicha(d, c, det) : ''}
    ${vices}
    ${floripa}
  </div>`
}

// card da ficha: números do candidato, 2022 e (se já carregados) os bairros mais fortes
function cardFicha(det, d, c, aba, pos, total) {
  const cor = corPartido(c.partido)
  const situ = c.eleito ? '✔ Eleito conforme TSE' : c.tseDefinido ? (c.situacao || 'Situação definida pelo TSE') : c.projecao ? '★ Eleito pela projeção do app' : ''
  const tiles = [
    { rot: 'Votos', valor: fmt.format(c.votos) },
    { rot: '% dos válidos', valor: `${fmtPct.format(c.percentual)}%` },
    { rot: 'Posição', valor: `${pos}º`, sub: `de ${total} candidatos` },
    { rot: 'Apuração', valor: `${fmtPct.format(d.secoes.percentual)}%`, sub: 'das seções' },
  ]
  const p22 = PREF.mostrar2022 && H22.resumo ? achar2022(c).filter((p) => p.el.turno === 1).sort((x, y) => (y.el.cargo === aba?.cargo) - (x.el.cargo === aba?.cargo))[0] : null
  if (p22) {
    const va = variacao(c.votos, p22.c.votos)
    tiles.push({ rot: `Em 2022 · ${ROTULO_ELEICAO[p22.el.id] || ''}`, valor: fmt.format(p22.c.votos), sub: va ? `agora ${va.txt}` : '', corSub: va ? COR_VAR[va.cls] : null, cor: '#9aa19d' })
  }
  let linhas = []
  const idx = aba?.cargo && ARQ_ANO.get(`dados2026/bairros-${eleicaoDoCargo(aba.cargo)}.json`)?.valor
  const x = idx?.c[Number(c.numero)]
  if (x) linhas = linhasBairroCard(x.v.slice(0, 3).map(([bi, v, v22]) => { const [cd, nome, val] = idx.b[bi]; return { nome, extra: NOME_MUN.get(cd) || cd, v, pct: pctDe(v, val), v22: v22 != null && PREF.mostrar2022 ? v22 : null, va: v22 != null && PREF.mostrar2022 ? variacao(v, v22) : null } }))
  return { foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${aba ? aba.rotulo.replace(/ SC$/, '') : ''}${det.mun ? ` · ${det.mun.nm}` : ''}`, titulo: 'Desempenho na apuração', subtitulo: situ || (d.atualizadoEm ? `Dados do TSE de ${d.atualizadoEm}` : ''), tiles, linhas, numerar: true, rodape: linhas.length ? 'Bairros onde foi mais votado (boletins de urna)' : '' }
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
          ${[['mun', 'Municípios'], ['assoc', 'Associações'], ['meso', 'Regiões'], ['micro', 'Microrregiões']]
            .map(([k, r]) => `<button type="button" data-agrupar="${k}" aria-pressed="${agrupar === k}">${r}</button>`)
            .join('')}</div>`
      : ''
  if (agrupar !== 'mun') {
    const grupos = new Map()
    for (const l of pm.linhas) {
      const info = MUN_REG.get(l.cd)
      const chave = info ? (agrupar === 'meso' ? info.meso : agrupar === 'assoc' ? info.assoc : info.micro) : '?'
      const g = grupos.get(chave) || { nome: agrupar === 'meso' ? MESORREGIOES[chave] : agrupar === 'assoc' ? `${chave} · ${ASSOCIACOES[chave] || ''}` : MICRORREGIOES[chave] || 'Outros', meso: info && MESORREGIOES[info.meso], votos: 0, validos: 0, n: 0, top: null }
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
      <table class="tabela pm-tabela"><thead><tr><th>${agrupar === 'meso' ? 'Região' : agrupar === 'assoc' ? 'Associação' : 'Microrregião'}</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead><tbody>${lista
        .map(
          (g) => `<tr style="${estiloCor(cor)}"><td><strong>${esc(g.nome)}</strong><div class="cand-meta">${agrupar === 'micro' && g.meso ? esc(g.meso) + ' · ' : ''}${g.n} municípios · mais votos em ${esc(g.top.nm)}</div>
            <div class="barra fina"><span style="width:${(100 * g.votos) / max}%"></span></div></td>
            <td class="dir">${fmt.format(g.votos)}</td><td class="dir">${g.validos ? fmtPct.format((100 * g.votos) / g.validos) : '–'}%${linha2022Grupo(det, g.cds, g.validos ? (100 * g.votos) / g.validos : null)}</td></tr>`,
        )
        .join('')}</tbody></table>
      <p class="nota">${agrupar === 'assoc' ? 'Associações de municípios da FECAM' : 'Regiões do IBGE'}. % = votos do candidato ÷ votos válidos ${agrupar === 'assoc' ? 'da associação' : 'da região'}. Total: <strong>${fmt.format(total)}</strong> votos.</p>
    </section>`
  }
  return `<section class="cartao"><h3>📍 Votos por município e zona</h3>${botoes}${abasAgrupar}
    ${pm.carregando ? `<p class="nota">Consultando ${pm.feitos} de ${pm.total} municípios…</p>` : ''}
    ${pm.escopo === 'todos' ? `<input id="det-busca-mun" type="search" placeholder="Buscar município…" value="${esc(pm.busca || '')}" autocomplete="off">` : ''}
    <table class="tabela pm-tabela"><thead><tr><th>Município</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead><tbody>${linhas
      .slice(0, limite)
      .map(
        (l) => `<tr style="${estiloCor(cor)}"><td>${esc(l.nm)}<div class="cand-meta">${l.semDados ? 'sem dados ainda' : `${fmtPct.format(l.pst)}% apurado · ${l.pos}º no município`}</div>
          ${l.zonas.length > 1 ? `<button type="button" class="link-zonas" data-zonas-mun="${esc(l.cd)}" aria-expanded="${!!pm.zonas[l.cd]}">${pm.zonas[l.cd] ? 'Ocultar zonas <span class="seta" aria-hidden="true">▴</span>' : `Ver ${l.zonas.length} zonas <span class="seta" aria-hidden="true">▾</span>`}</button>` : l.zonas.length === 1 ? `<div class="cand-meta">zona única: ${Number(l.zonas[0])}ª</div>` : ''}</td>
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

// cargos que podem entrar na comparação (em SC, qualquer cargo: ex. Dep. Federal × Dep. Estadual)
const abasComparaveis = (det) => (det.abr === UF ? ABAS.filter((a) => a.cargo && a.abrangencias.includes(UF)) : [])

function carregarListaComp(det, abaId) {
  det.compListas ??= {}
  if (det.compListas[abaId]) return
  det.compListas[abaId] = { carregando: true }
  buscar(ABAS.find((a) => a.id === abaId), UF, TURNO)
    .then((d) => (det.compListas[abaId] = d))
    .catch(() => (det.compListas[abaId] = { erro: true }))
    .finally(() => estado.detalhe === det && renderDetalhe())
}

function escolherComparacao(d, c) {
  const det = estado.detalhe
  const outras = abasComparaveis(det).filter((a) => a.id !== det.aba)
  const abaSel = outras.find((a) => a.id === det.compCargo) || null
  let base = d
  if (abaSel) {
    carregarListaComp(det, abaSel.id)
    base = det.compListas[abaSel.id]
  }
  const seletor = outras.length
    ? `<div class="segmentado comp-cargos" role="group" aria-label="Cargo do outro candidato"><button type="button" data-comp-cargo="" aria-pressed="${!abaSel}">Mesmo cargo</button>${outras
        .map((a) => `<button type="button" data-comp-cargo="${a.id}" aria-pressed="${abaSel === a}">${esc(a.rotulo.replace(/ SC$/, ''))}</button>`)
        .join('')}</div>`
    : ''
  const cab = `<section class="cartao">
    <h3>⚖️ Comparar ${esc(c.nome)} com…</h3>${seletor}
    <input id="comp-busca" type="search" placeholder="Buscar ${abaSel ? esc(abaSel.rotulo.replace(/ SC$/, '')) : ''} por nome, partido ou número…" value="${esc(det.buscaComp || '')}" autocomplete="off">`
  if (!base?.candidatos) return `${cab}<p class="nota">${base?.erro ? 'Não consegui carregar os candidatos deste cargo agora.' : 'Carregando os candidatos…'}</p><button type="button" class="botao secundario" data-sair-comp>Cancelar</button></section>`
  const termo = semAcento((det.buscaComp || '').trim())
  const lista = base.candidatos
    .filter((x) => x !== c && x.valido)
    .filter((x) => !termo || semAcento(`${x.nome} ${x.nomeCompleto} ${x.partido} ${x.numero}`).includes(termo))
    .slice(0, termo ? 60 : 25)
  const abaId = abaSel ? abaSel.id : det.aba
  const favs = base.candidatos.filter((x) => x !== c && ehFavorito(abaId, det.abr, x.sqcand))
  const item = (x) => {
    const cor = corPartido(x.partido)
    return `<li><button type="button" data-comp-sq="${esc(x.sqcand)}" data-comp-aba="${abaSel ? abaSel.id : ''}" style="${estiloCor(cor)}">
      <span class="pos">${base.candidatos.indexOf(x) + 1}º</span>
      <span class="comp-nome"><strong>${esc(x.nome)}</strong> ${pill(x.partido, cor)}</span>
      <span class="mudo">${fmt.format(x.votos)}</span></button></li>`
  }
  return `${cab}
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

function renderComparacao(d, a, b, aba, d2 = d, aba2 = aba) {
  const det = estado.detalhe
  const outroCargo = aba2 !== aba
  const corA = corPartido(a.partido)
  let corB = corPartido(b.partido)
  // mesmo partido: o segundo fica com uma cor neutra para as barras se distinguirem
  if (corB === corA) corB = '#6b7570'
  const pa = d.candidatos.indexOf(a) + 1, pb = d2.candidatos.indexOf(b) + 1
  const cargoDe = (ab) => (ab ? ab.rotulo.replace(/ SC$/, '') : '')
  const lider = a.votos >= b.votos ? a : b
  const outro = lider === a ? b : a
  const dif = lider.votos - outro.votos
  const sa = serieDe(det, a.sqcand), sb = outroCargo ? [] : serieDe(det, b.sqcand)
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
      ${outroCargo ? `<span class="comp-cargo">${esc(cargoDe(c === a ? aba : aba2))}</span>` : ''}
      <strong class="comp-nome-g">${esc(c.nome)}</strong>
      <div>${pill(c.partido, cor)}</div>
      <div class="comp-selos">${selo(c)} ${seloChance(c === a ? d : d2, c, c === a ? aba : aba2, true)}</div>
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
        ${dif === 0 ? 'Empatados' : outroCargo ? `<strong>${esc(lider.nome)}</strong> teve <strong>${fmt.format(dif)}</strong> votos a mais em SC` : `<strong>${esc(lider.nome)}</strong> está <strong>${fmt.format(dif)}</strong> votos à frente (${fmtPct.format(Math.abs(a.percentual - b.percentual))} p.p.)`}
      </div>
      <table class="comp-tabela"><tbody>
        ${linha('Votos', a.votos, b.votos, true, (v) => fmt.format(v))}
        ${linha(outroCargo ? '% dos válidos (no seu cargo)' : '% dos válidos', a.percentual, b.percentual, true, (v) => `${fmtPct.format(v)}%`)}
        ${linha(outroCargo ? 'Posição no seu cargo' : 'Posição', pa, pb, false, (v) => `${v}º`)}
        ${ga || gb ? linha('Ganho na última atualização', ga, gb, true, (v) => `+${fmt.format(v)}`) : ''}
      </tbody></table>
      <p class="nota">${fmtPct.format(d.secoes.percentual)}% das seções apuradas${det.mun && !outroCargo ? ` · ${esc(det.mun.nm)}` : outroCargo ? ' · Santa Catarina' : ''}. Em verde, quem leva vantagem em cada linha.${outroCargo ? ` Cargos diferentes: ${esc(a.nome)} (${esc(cargoDe(aba))}) × ${esc(b.nome)} (${esc(cargoDe(aba2))}); cada eleitor vota nos dois cargos, então os votos podem ser comparados lugar a lugar.` : ''}</p>
      <div class="pm-botoes"><button type="button" class="botao secundario" data-trocar-comp>Trocar candidato</button>
        <button type="button" class="botao secundario" data-sair-comp>Sair da comparação</button></div>
      <div class="exportar">${botaoCard('comparacao', {
        nome: `${a.nome} × ${b.nome}`, cor: corA, fotos: [b.foto, a.foto], sub: outroCargo ? `${cargoDe(aba)} × ${cargoDe(aba2)} · SC` : `${aba ? aba.rotulo.replace(/ SC$/, '') : ''}${det.mun ? ` · ${det.mun.nm}` : ''} · ${fmtPct.format(d.secoes.percentual)}% apurado`,
        titulo: 'Comparação', subtitulo: dif === 0 ? 'Empatados' : outroCargo ? `${lider.nome} teve ${fmt.format(dif)} votos a mais` : `${lider.nome} está ${fmt.format(dif)} votos à frente`,
        tiles: [
          { rot: `${a.nome} · votos`, valor: fmt.format(a.votos), cor: corA }, { rot: `${b.nome} · votos`, valor: fmt.format(b.votos), cor: corB },
          { rot: '% dos válidos', valor: `${fmtPct.format(a.percentual)}%`, cor: corA }, { rot: '% dos válidos', valor: `${fmtPct.format(b.percentual)}%`, cor: corB },
          { rot: outroCargo ? `Posição · ${cargoDe(aba)}` : 'Posição', valor: `${pa}º`, sub: a.partido, cor: corA }, { rot: outroCargo ? `Posição · ${cargoDe(aba2)}` : 'Posição', valor: `${pb}º`, sub: b.partido, cor: corB },
        ],
      })}</div>
    </section>
    ${outroCargo ? '' : `<section class="cartao"><h3>Evolução</h3>${tendDif}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsPct(sa) }, { nome: b.nome, cor: corB, pontos: ptsPct(sb) }], { fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsVot(sa) }, { nome: b.nome, cor: corB, pontos: ptsVot(sb) }], { fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${sa.length < 2 || sb.length < 2 ? '<p class="nota">Os gráficos aparecem depois de algumas atualizações com votos novos.</p>' : ''}
    </section>`}
    ${secaoCompDiferenca(det, a, b, corA, corB, aba, aba2) ?? (det.abr === UF || aba?.id === 'presidente' ? secaoCompMunicipios(det, a, b, corA, corB) : '')}`
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
  if (agrupar === 'meso' || agrupar === 'assoc') {
    const g = new Map()
    for (const l of cm.linhas) {
      const k = MUN_REG.get(l.cd)?.[agrupar] || '?'
      const x = g.get(k) || { nm: agrupar === 'assoc' ? `${k} · ${ASSOCIACOES[k] || ''}` : MESORREGIOES[k] || 'Outros', a: 0, b: 0 }
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
    ${cm.escopo === 'todos' && !cm.carregando ? `<div class="segmentado" role="group"><button type="button" data-comp-agrupar="mun" aria-pressed="${agrupar === 'mun'}">Municípios</button><button type="button" data-comp-agrupar="assoc" aria-pressed="${agrupar === 'assoc'}">Associações</button><button type="button" data-comp-agrupar="meso" aria-pressed="${agrupar === 'meso'}">Regiões</button></div>` : ''}
    ${cm.carregando ? `<p class="nota">Consultando ${cm.feitos} de ${cm.total} municípios…</p>` : `<p class="comp-placar"><span style="${estiloCor(corA)}">${esc(a.nome)}: <strong>${venceA}</strong></span> × <span style="${estiloCor(corB)}">${esc(b.nome)}: <strong>${venceB}</strong></span> <span class="mudo">municípios na frente</span></p>`}
    <table class="tabela comp-mun"><thead><tr><th>${agrupar === 'meso' ? 'Região' : agrupar === 'assoc' ? 'Associação' : 'Município'}</th><th class="dir">${esc(a.nome)}</th><th class="dir">${esc(b.nome)}</th></tr></thead><tbody>${linhas
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

// ---------- comparação: onde a diferença entre os dois foi maior ou menor ----------
// Usa os votos de 2026 já no app (boletins de urna): por município (dados2026/municipios-*.json) e,
// num lugar escolhido, por zona/bairro/local (dados2026/secoes). Funciona entre cargos diferentes.
function dadosDiferenca(D, A, B, re) {
  const fora = D.mun ? new Set(D.mun.cds) : null
  if (D.grupo === 'mun' || D.grupo === 'assoc' || D.grupo === 'meso') {
    const MA = arquivoAno(`dados2026/municipios-${A.el}.json`, re), MB = arquivoAno(`dados2026/municipios-${B.el}.json`, re)
    if (MA.erro || MB.erro) return { erro: true }
    if (!MA.valor || !MB.valor) return { msg: 'Carregando os votos por município…' }
    const va = MA.valor.c[A.nr] || {}, vb = MB.valor.c[B.nr] || {}
    const g = new Map()
    for (const cd of Object.keys(MA.valor.validos)) {
      if (fora && !fora.has(cd)) continue
      const k = D.grupo === 'mun' ? cd : D.grupo === 'assoc' ? ASSOCIACAO_MUN[cd] : MUN_REG.get(cd)?.meso
      if (!k) continue
      const x = g.get(k) || { k, a: 0, b: 0, valA: 0, valB: 0 }
      x.a += va[cd] || 0
      x.b += vb[cd] || 0
      x.valA += MA.valor.validos[cd] || 0
      x.valB += MB.valor.validos[cd] || 0
      g.set(k, x)
    }
    return {
      linhas: [...g.values()].map((x) => ({
        ...x,
        nome: D.grupo === 'mun' ? NOME_MUN.get(x.k) || x.k : D.grupo === 'assoc' ? x.k : MESORREGIOES[x.k] || x.k,
        sub: D.grupo === 'assoc' ? ASSOCIACOES[x.k] || '' : '',
        ir: D.grupo === 'mun' ? `data-bai-lugar="${esc(x.k)}"` : D.grupo === 'assoc' ? `data-bai-lugar="assoc:${esc(x.k)}"` : `data-bai-lugar="meso:${esc(x.k)}"`,
      })),
    }
  }
  // zonas, bairros ou locais do lugar escolhido (arquivos de seções de cada município)
  const cds = D.mun.cds
  const regiao = cds.length > 1
  const arqs = cds.map((cd) => [cd, secoesAno(2026, cd, re)])
  const prontos = arqs.filter(([, a]) => a)
  const faltam = arqs.filter(([cd, a]) => !a && !erroSecoes(2026, cd)).length
  if (!prontos.length) return { msg: faltam ? `Carregando as seções de ${esc(D.mun.nm)}…` : 'Os boletins deste lugar ainda não estão no app.' }
  const linhas = []
  for (const [cd, arq] of prontos) {
    const ga = new Map(agregarSecoes(arq, { id: A.el, cargo: A.cargo, anul: new Set() }, {}, D.grupo, A.nr).grupos.map((x) => [x.chave, x]))
    const gb = new Map(agregarSecoes(arq, { id: B.el, cargo: B.cargo, anul: new Set() }, {}, D.grupo, B.nr).grupos.map((x) => [x.chave, x]))
    const nmMun = NOME_MUN.get(cd) || cd
    for (const k of new Set([...ga.keys(), ...gb.keys()])) {
      const xa = ga.get(k), xb = gb.get(k)
      let nome = k, sub = regiao ? nmMun : ''
      if (D.grupo === 'zona') nome = `${Number(k)}ª zona${cd === FLORIPA_CD && ROTULO_ZONA[z4(k)] ? ` · ${ROTULO_ZONA[z4(k)]}` : ''}`
      else if (D.grupo === 'local') {
        nome = tituloLocal((arq.locais[k] || [k])[0])
        sub = [bairroDoLocal(arq, k), regiao ? nmMun : ''].filter(Boolean).join(' · ')
      }
      linhas.push({ k: `${cd}|${k}`, nome, sub, a: xa?.foco || 0, b: xb?.foco || 0, valA: xa?.validos || 0, valB: xb?.validos || 0 })
    }
  }
  return { linhas, aviso: faltam ? `Carregando mais ${faltam} município(s)…` : '' }
}

// barras lado a lado dos dois candidatos em cada lugar
function listaDuelo(itens, A, B) {
  const max = Math.max(1, ...itens.map((i) => Math.max(i.a, i.b)))
  const barra = (v) => `${Math.max(v ? 1.5 : 0, (100 * v) / max)}%`
  const lado = (X, v, cls) => `<div class="cmp-ano duo ${cls}" style="--cor:${X.cor}"><span class="cmp-rot" title="${esc(X.nome)}">${esc(X.nome)}</span><span class="cmp-trilho"><span style="width:${barra(v)};background:${X.cor}"></span></span><span class="cmp-num"><strong>${fmt.format(v)}</strong></span></div>`
  return `<div class="cmp-lista" role="list">${itens
    .map((i) => {
      const d = i.a - i.b
      const quem = d > 0 ? A : B
      return `<div class="cmp-linha ${i.ir ? 'clicavel' : ''}" role="listitem" ${i.ir || ''}>
        <div class="cmp-topo"><div class="cmp-nome"><strong>${esc(i.nome)}</strong>${i.sub ? ` <span class="mudo">· ${esc(i.sub)}</span>` : ''}</div>${d ? `<span class="var ${d > 0 ? 'var-a' : 'var-b'}" style="--cor:${quem.cor}">+${fmt.format(Math.abs(d))}</span>` : '<span class="var">empate</span>'}</div>
        ${lado(A, i.a, 'a')}${lado(B, i.b, 'b')}
        <div class="cand-meta">${d ? `${esc(quem.nome)} teve ${fmt.format(Math.abs(d))} votos a mais${Math.min(i.a, i.b) > 0 ? ` (${fmtDec(Math.max(i.a, i.b) / Math.min(i.a, i.b))}×)` : ''}` : 'Mesma votação'}${i.valA ? ` · ${fmtPct.format(pctDe(i.a, i.valA))}% × ${fmtPct.format(pctDe(i.b, i.valB))}% dos válidos` : ''}</div>
      </div>`
    })
    .join('')}</div>`
}

function secaoCompDiferenca(det, a, b, corA, corB, aba, aba2) {
  if (det.abr !== UF || !aba?.cargo || !aba2?.cargo) return null
  const D = (det.comp.dif ??= { grupo: 'mun', modo: 'a', mun: null, painel: false, busca: '', todos: false })
  const re = () => estado.detalhe === det && renderDetalhe()
  const A = { nome: a.nome, cor: corA, nr: Number(a.numero), el: eleicaoDoCargo(aba.cargo), cargo: aba.cargo, rot: aba.rotulo.replace(/ SC$/, '') }
  const B = { nome: b.nome, cor: corB, nr: Number(b.numero), el: eleicaoDoCargo(aba2.cargo), cargo: aba2.cargo, rot: aba2.rotulo.replace(/ SC$/, '') }
  const niveis = D.mun
    ? [...(D.mun.cds.length > 1 ? [['mun', 'Municípios']] : []), ['zona', 'Zonas'], ['bairro', 'Bairros'], ['local', 'Locais']]
    : [['mun', 'Municípios'], ['assoc', 'Associações'], ['meso', 'Regiões']]
  if (!niveis.some(([k]) => k === D.grupo)) D.grupo = niveis[0][0]
  const nomeNivel = Object.fromEntries(niveis)[D.grupo]
  const r = dadosDiferenca(D, A, B, re)
  // sem os arquivos de 2026: no mesmo cargo, cai na consulta ao TSE de antes
  if (r.erro && aba === aba2) return null
  const modos = [['a', `${a.nome} na frente`], ['b', `${b.nome} na frente`], ['eq', '≈ Mais parecidos'], ['v', 'Mais votos']]
  const lugar = D.mun ? D.mun.nm : 'Santa Catarina'
  const controles = `${escolhaLugarBairros(D)}
    <div class="segmentado" role="group" aria-label="Ver por">${niveis.map(([k, rot]) => `<button type="button" data-cd-grupo="${k}" aria-pressed="${D.grupo === k}">${rot}</button>`).join('')}</div>
    <div class="segmentado" role="group" aria-label="Ordem">${modos.map(([k, rot]) => `<button type="button" data-cd-modo="${k}" aria-pressed="${D.modo === k}">${esc(rot)}</button>`).join('')}</div>`
  D.export = null
  let corpo
  if (r.erro) corpo = '<p class="nota">Os votos por município de 2026 ainda não estão no app para estes cargos.</p>'
  else if (r.msg) corpo = `<p class="nota">${r.msg}</p>`
  else {
    const ls = r.linhas
    const ord = { a: (x, y) => y.a - y.b - (x.a - x.b), b: (x, y) => y.b - y.a - (x.b - x.a), eq: (x, y) => Math.abs(x.a - x.b) / (x.a + x.b) - Math.abs(y.a - y.b) / (y.a + y.b) || y.a + y.b - (x.a + x.b), v: (x, y) => y.a + y.b - (x.a + x.b) }
    ls.sort(ord[D.modo] || ord.a)
    const vis = ls.filter(D.modo === 'a' ? (l) => l.a > l.b : D.modo === 'b' ? (l) => l.b > l.a : D.modo === 'eq' ? (l) => l.a > 0 && l.b > 0 && l.a + l.b >= (D.grupo === 'zona' || D.grupo === 'bairro' || D.grupo === 'local' ? 50 : 300) : (l) => l.a + l.b > 0)
    const lim = D.todos ? vis.length : 15
    const venceA = ls.filter((l) => l.a > l.b).length, venceB = ls.filter((l) => l.b > l.a).length
    const sA = ls.reduce((t, l) => t + l.a, 0), sB = ls.reduce((t, l) => t + l.b, 0)
    const nivelMin = nomeNivel.toLowerCase()
    const rotOrdem = { a: `onde ${a.nome} ficou mais à frente`, b: `onde ${b.nome} ficou mais à frente`, eq: 'onde os dois tiveram votação mais parecida', v: 'mais votos somados' }[D.modo]
    corpo = (r.aviso ? `<p class="nota">${r.aviso}</p>` : '') +
      `<p class="comp-placar"><span style="${estiloCor(corA)}">${esc(a.nome)}: <strong>${fmt.format(sA)}</strong> votos · na frente em <strong>${fmt.format(venceA)}</strong></span> <span style="${estiloCor(corB)}">${esc(b.nome)}: <strong>${fmt.format(sB)}</strong> votos · na frente em <strong>${fmt.format(venceB)}</strong></span> <span class="mudo">${esc(nivelMin)} em ${esc(lugar)}</span></p>` +
      (vis.length ? listaDuelo(vis.slice(0, lim), A, B) : `<p class="nota">${D.modo === 'a' ? `${esc(a.nome)} não ficou à frente em nenhum lugar` : D.modo === 'b' ? `${esc(b.nome)} não ficou à frente em nenhum lugar` : 'Sem votos dos dois'} em ${esc(lugar)}.</p>`) +
      (vis.length > lim ? `<button type="button" class="botao secundario" data-cd-todos>Mostrar todos (${fmt.format(vis.length)})</button>` : '') +
      `<p class="nota">${D.mun ? '' : 'Toque num município, associação ou região para ver as zonas e os bairros. '}Votos do 1º turno nos boletins de urna (TSE).${aba !== aba2 ? ' Cada eleitor vota nos dois cargos, então a diferença mostra onde um puxou mais votos que o outro.' : ''}</p>`
    // imagem, carrossel e planilha
    const tit = `${nomeNivel} · ${lugar}`
    const lider = sA === sB ? null : sA > sB ? a : b
    const total = { rot: D.mun ? `Soma ${{ mun: 'dos municípios', zona: 'das zonas', bairro: 'dos bairros', local: 'dos locais' }[D.grupo]} de ${lugar}` : 'Santa Catarina inteira', quem: `${a.nome} × ${b.nome}`,
      valor: `${fmt.format(sA)} × ${fmt.format(sB)}`, sub: lider ? `${lider.nome} +${fmt.format(Math.abs(sA - sB))}` : 'empate' }
    const base = { turno: turnoDe(A.el), foto: b.foto, fotos: [b.foto, a.foto], nome: `${a.nome} × ${b.nome}`, cor: corA, sub: aba === aba2 ? `${A.rot} · ${a.partido} × ${b.partido}` : `${A.rot} × ${B.rot}` }
    const linhaCar = (x, max) => {
      const d = x.a - x.b
      return { nome: x.nome, extra: x.sub || '', par: { a: x.a, b: x.b, max, rotA: a.nome, rotB: b.nome, corA, corB }, dir2: d ? `+${fmt.format(Math.abs(d))} ${(d > 0 ? a : b).nome}` : 'empate', corDir2: d > 0 ? corA : d < 0 ? corB : null }
    }
    const POR = 6
    const montar = () => {
      const capaLin = vis.slice(0, 3)
      const capa = { ...base, total, titulo: tit, subtitulo: rotOrdem,
        tiles: [{ rot: `${a.nome} · votos`, valor: fmt.format(sA), sub: `na frente em ${fmt.format(venceA)} ${nivelMin}`, cor: corA }, { rot: `${b.nome} · votos`, valor: fmt.format(sB), sub: `na frente em ${fmt.format(venceB)} ${nivelMin}`, cor: corB }],
        linhas: capaLin.map((x) => linhaCar(x, Math.max(1, ...capaLin.map((y) => Math.max(y.a, y.b))))) }
      const paginas = [capa]
      const max = Math.max(1, ...vis.map((x) => Math.max(x.a, x.b)))
      // até 9 páginas depois da capa (os 54 primeiros lugares da ordem escolhida)
      const n = Math.min(9, Math.ceil(vis.length / POR))
      for (let k = 0; k < n; k++) paginas.push({ ...base, total, titulo: tit, subtitulo: `${rotOrdem}${n > 1 ? ` · parte ${k + 1} de ${n}` : ''}`, numerar: false, linhas: vis.slice(k * POR, (k + 1) * POR).map((x) => linhaCar(x, max)) })
      return paginas
    }
    const topo = vis.slice(0, POR)
    D.export = {
      card: { ...base, total, titulo: tit, subtitulo: rotOrdem, numerar: false, linhas: topo.map((x) => linhaCar(x, Math.max(1, ...topo.map((y) => Math.max(y.a, y.b))))) },
      carrossel: montar,
      paginas: 1 + Math.min(9, Math.ceil(vis.length / POR)),
      legenda: legendaShare(`${a.nome} × ${b.nome} · ${tit}`),
      csv: { nome: `${nomeArquivo(a.nome)}-x-${nomeArquivo(b.nome)}-${nomeArquivo(nomeNivel)}-${nomeArquivo(lugar)}.csv`,
        cab: [nomeNivel, 'Onde', `${a.nome} (${A.rot})`, `${b.nome} (${B.rot})`, `Diferença (${a.nome} − ${b.nome})`, `% válidos ${a.nome}`, `% válidos ${b.nome}`],
        linhas: vis.map((l) => [l.nome, l.sub || '', l.a, l.b, l.a - l.b, pctDe(l.a, l.valA), pctDe(l.b, l.valB)]) },
    }
  }
  return `<section class="cartao bai cdif"><h3>📍 Onde a diferença foi maior</h3>${controles}${corpo}
    ${D.export ? `<div class="exportar">${botaoCard('comp-diferenca', D.export.card)}<button type="button" class="botao" data-cd-carrossel>🎞️ Carrossel (${D.export.paginas} imagens)</button><button type="button" class="botao secundario" data-cd-csv>⬇️ Planilha (CSV)</button><button type="button" class="botao secundario" data-cd-legenda>📋 Copiar legenda com o link do Instagram</button></div>` : ''}
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
    det.compCargo = det.comp?.aba || null
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  const compSq = ev.target.closest('[data-comp-sq]')
  if (compSq) {
    det.escolhendo = false
    det.comp = { sqcand: compSq.dataset.compSq, aba: compSq.dataset.compAba || null, porMun: null, dif: { grupo: 'mun', modo: 'a', mun: null, painel: false, busca: '', todos: false } }
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  if (ev.target.closest('[data-sair-comp]')) {
    det.escolhendo = false
    det.ctrlComp?.abort()
    det.comp = null
    return renderDetalhe()
  }
  const ccBtn = ev.target.closest('[data-comp-cargo]')
  if (ccBtn) return ((det.compCargo = ccBtn.dataset.compCargo || null), (det.buscaComp = ''), renderDetalhe())
  const D = !det?.escolhendo && det?.comp?.dif
  if (D) {
    const vai = () => (renderDetalhe(), detalheEl.querySelector('.cartao.cdif')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    if (ev.target.closest('[data-bai-sc]')) return ((D.mun = null), (D.todos = false), (D.painel = false), (D.grupo = 'mun'), vai())
    if (ev.target.closest('[data-bai-painel]')) return ((D.painel = !D.painel), (D.busca = ''), renderDetalhe())
    const lg = ev.target.closest('[data-bai-lugar]')
    if (lg) {
      const L = lugarBairros(lg.dataset.baiLugar)
      return (Object.assign(D, { mun: L, todos: false, painel: false, busca: '', grupo: L?.cds.length > 1 ? 'mun' : 'zona' }), vai())
    }
    const g = ev.target.closest('[data-cd-grupo]')
    if (g) return ((D.grupo = g.dataset.cdGrupo), (D.todos = false), renderDetalhe())
    const m = ev.target.closest('[data-cd-modo]')
    if (m) return ((D.modo = m.dataset.cdModo), (D.todos = false), renderDetalhe())
    if (ev.target.closest('[data-cd-todos]')) return ((D.todos = true), renderDetalhe())
    if (D.export && ev.target.closest('[data-cd-csv]')) return baixarCSV(D.export.csv)
    const lgd = ev.target.closest('[data-cd-legenda]')
    if (lgd && D.export) {
      const ok = () => ((lgd.textContent = '✅ Legenda copiada! Cole na publicação'), setTimeout(() => renderDetalhe(), 2500))
      return navigator.clipboard?.writeText(D.export.legenda).then(ok).catch(() => window.prompt('Copie a legenda:', D.export.legenda))
    }
    const car = ev.target.closest('[data-cd-carrossel]')
    if (car && D.export) {
      const cards = D.export.carrossel()
      car.disabled = true
      return compartilharCarrossel(cards, `${cards[0].nome} · ${cards[0].titulo}`, car).finally(() => (car.disabled = false))
    }
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
  if (det && ev.target.closest('[data-pro-abrir]')) return abrirAnalises(det)
  const zc = ev.target.closest('[data-bai-zona-comp]')
  if (zc && det?.bai) {
    const fora = (det.bai.zonasFora ??= new Set())
    const k = zc.dataset.baiZonaComp
    fora.has(k) ? fora.delete(k) : fora.add(k)
    return renderDetalhe()
  }
  const lg = ev.target.closest('[data-bai-legenda]')
  if (lg && det?.bai?.export) {
    const ok = () => ((lg.textContent = '✅ Legenda copiada! Cole na publicação'), setTimeout(() => renderDetalhe(), 2500))
    return navigator.clipboard?.writeText(det.bai.export.legenda).then(ok).catch(() => window.prompt('Copie a legenda:', det.bai.export.legenda))
  }
  const btCar = ev.target.closest('[data-bai-carrossel]')
  if (btCar && det?.bai?.carrossel) {
    if (det.bai.export?.zonas && det.bai.export.zonas.every((z) => !z.dentro)) return
    const cards = det.bai.carrossel()
    btCar.disabled = true
    return compartilharCarrossel(cards, `${cards[0].nome} · ${cards[0].titulo}`, btCar).finally(() => (btCar.disabled = false))
  }
  if (det?.bai?.export && ev.target.closest('[data-bai-csv]')) return baixarCSV(det.bai.export.csv)
  if (det?.bai) {
    if (ev.target.closest('[data-bai-sc]')) return ((det.bai.mun = null), (det.bai.todos = false), (det.bai.painel = false), renderDetalhe())
    if (ev.target.closest('[data-bai-painel]')) return ((det.bai.painel = !det.bai.painel), (det.bai.busca = ''), renderDetalhe())
    const lugar = ev.target.closest('[data-bai-lugar]')
    if (lugar) {
      Object.assign(det.bai, { mun: lugarBairros(lugar.dataset.baiLugar), todos: false, painel: false, busca: '' })
      renderDetalhe()
      return detalheEl.querySelector('.cartao.bai')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    const modo = ev.target.closest('[data-bai-modo]')
    if (modo) return ((det.bai.modo = modo.dataset.baiModo), renderDetalhe())
    if (ev.target.closest('[data-bai-todos]')) return ((det.bai.todos = true), renderDetalhe())
    const gr = ev.target.closest('[data-bai-grupo]')
    if (gr) return ((det.bai.grupo = gr.dataset.baiGrupo), (det.bai.todos = false), renderDetalhe())
    const zb = ev.target.closest('[data-bai-zona]')
    if (zb) {
      const zs = (det.bai.zonas ??= new Set())
      const k = zb.dataset.baiZona
      if (zs.has(k) || det.bai.zonasTodas) {
        zs.delete(k)
        if (det.bai.zonasTodas) {
          det.bai.zonasTodas = false
          // mantém abertas as outras
          for (const b of detalheEl.querySelectorAll('[data-bai-zona][aria-expanded="true"]')) if (b.dataset.baiZona !== k) zs.add(b.dataset.baiZona)
        }
      } else zs.add(k)
      return renderDetalhe()
    }
    if (ev.target.closest('[data-bai-zonas-todas]')) return ((det.bai.zonasTodas = !det.bai.zonasTodas), det.bai.zonas?.clear(), renderDetalhe())
    const ir = ev.target.closest('[data-bai-ir]')
    if (ir) return irParaBairro(det, ir.dataset.baiIr, ir.dataset.baiBairro, ir.dataset.baiTipo, ir.dataset.baiChave)
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
detalheEl.addEventListener('change', (ev) => {
  const sel = ev.target.closest('[data-bai-mun]')
  const det = estado.detalhe
  if (!sel || !det?.bai) return
  det.bai.mun = lugarBairros(sel.value)
  det.bai.todos = false
  renderDetalhe()
})
// abre a aba "Bairros" no bairro escolhido, com o candidato em destaque
function irParaBairro(det, cd, bairro, tipo, chave) {
  const aba = ABAS.find((a) => a.id === det.aba)
  const d = dadosDetalhe()
  const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
  if (!aba?.cargo || !c) return
  const local = { cd, nm: NOME_MUN.get(cd) || cd }
  let grupo = 'local'
  if (tipo === 'zona') Object.assign(local, { zona: chave }), (grupo = 'bairro')
  else if (tipo === 'local') Object.assign(local, { localVot: chave, zona: chave.split('-')[0] }), (grupo = 'secao')
  else if (tipo === 'secao') Object.assign(local, { secao: chave, zona: chave.split('-')[0] }), (grupo = 'secao')
  else local.bairro = bairro
  Object.assign(B26, { sel: eleicaoDoCargo(aba.cargo), local, grupo, foco: Number(c.numero), buscaMun: '', verTodos: false, verGrupos: false })
  const ir = () => {
    trocarAba('bairros')
    window.scrollTo({ top: 0 })
  }
  // fechar a ficha volta uma entrada do histórico; troca de aba só depois disso
  const voltar = history.state?.detalhe
  fecharDetalhe()
  if (voltar) window.addEventListener('popstate', () => setTimeout(ir), { once: true })
  else ir()
}
detalheEl.addEventListener('input', (ev) => {
  if (ev.target.id === 'det-busca-bairro-mun' && estado.detalhe?.comp?.dif && !estado.detalhe.escolhendo) {
    estado.detalhe.comp.dif.busca = ev.target.value
    return renderDetalhe()
  }
  if (ev.target.id === 'det-busca-bairro-mun' && estado.detalhe?.bai) {
    estado.detalhe.bai.busca = ev.target.value
    return renderDetalhe()
  }
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
      <figure class="criador-capa">
        <img src="img/maicon-combat-capa.jpg?v=${VERSAO}" alt="Maicon Combat, com a Ponte Hercílio Luz ao fundo" loading="lazy">
        <figcaption><span class="criador-rot">Criado e desenvolvido por</span><strong>Maicon Combat</strong></figcaption>
      </figure>
      <p>Este aplicativo de acompanhamento da apuração das Eleições 2026, com foco em Santa Catarina, foi idealizado por <strong>Maicon Combat</strong>.</p>
      <div class="criador-links">
        <a class="botao criador-link" href="https://maiconcombat.com.br" target="_blank" rel="noopener">🌐 maiconcombat.com.br ↗</a>
        <a class="botao criador-link insta" href="https://www.instagram.com/maiconcombat/" target="_blank" rel="noopener">📷 Instagram @maiconcombat ↗</a>
      </div>
    </section>
    <section class="cartao"><h3>📲 Instalar como aplicativo</h3>
      ${matchMedia('(display-mode: standalone)').matches
        ? '<p>✅ O app já está instalado neste aparelho.</p>'
        : pedidoInstalar
          ? '<p>Coloque o app na tela inicial: abre mais rápido, em tela cheia, e funciona sem internet com os últimos dados vistos.</p><button type="button" class="botao" data-instalar>📲 Instalar o app</button>'
          : `<p>Coloque o app na tela inicial: abre mais rápido e em tela cheia.</p><ul class="det-lista">
              <li><strong>iPhone (Safari):</strong> toque em <strong>Compartilhar</strong> (□↑) e depois em <strong>Adicionar à Tela de Início</strong>.</li>
              <li><strong>Android (Chrome):</strong> menu <strong>⋮</strong> → <strong>Instalar app</strong> (ou "Adicionar à tela inicial").</li></ul>`}
    </section>
    <section class="cartao"><h3>⚙️ Preferências</h3>
      ${interruptor('2022', PREF.mostrar2022, 'Mostrar dados de 2022', 'Aba "📅 2022", comparação 2022 × 2026 na ficha de cada candidato e % de 2022 nas tabelas por município.')}
      <p class="nota">As preferências ficam salvas neste aparelho.</p>
    </section>
    <section class="cartao metodo"><h3>🧮 Como os números são calculados</h3>
      <details><summary>Votos, % e apuração ao vivo</summary>
        <p>Os votos de 2026 vêm dos arquivos oficiais de divulgação do TSE, lidos direto do seu aparelho a cada atualização. O % de cada candidato é sobre os <strong>votos válidos</strong> (sem brancos e nulos). Num município ou região, o app usa os arquivos daquele lugar; numa região ou associação, soma os municípios dela.</p></details>
      <details><summary>Quociente eleitoral, partidário e projeção de eleitos</summary>
        <p>Para Deputado, a projeção segue o Código Eleitoral (arts. 106 a 111): <strong>quociente eleitoral</strong> = votos válidos (nominais + legenda) ÷ vagas; <strong>quociente partidário</strong> = votos do partido ou federação ÷ QE, desprezada a fração, e essas vagas vão aos mais votados da legenda com ao menos 10% do QE; as <strong>sobras</strong> vão pelas maiores médias entre os partidos com ao menos 80% do QE, com candidato que tenha ao menos 20% do QE; se nenhum partido atingir o QE, elegem-se os mais votados. Enquanto a apuração não termina, é uma projeção com os votos já apurados.</p></details>
      <details><summary>Chances de reverter</summary>
        <p>Estima os votos que faltam (votos válidos apurados × seções que faltam ÷ seções apuradas). Nos cargos majoritários a conta é exata: se a diferença é maior que tudo o que falta, a situação está definida. Nos proporcionais, usa o cálculo de vagas para achar quantos votos a mais elegeriam o candidato (ou o tirariam). Nos casos em aberto, compara o desempenho que ele precisaria ter nas urnas restantes com o atual: até 1,1× "pode reverter", até 1,5× "reversão difícil", acima disso "improvável".</p></details>
      <details><summary>Bairros, zonas, locais e seções</summary>
        <p>Vêm dos <strong>boletins de urna</strong> de cada uma das ~17,5 mil seções de SC (1º turno), decodificados com a especificação oficial do TSE. Cada seção é somada pelo bairro do seu local de votação (cadastro de locais do TSE; em Florianópolis, a lista do TRE-SC). O bairro é o do local de votação, não o endereço do eleitor.</p></details>
      <details><summary>Comparação com 2022 e entre candidatos</summary>
        <p>O candidato é ligado a 2022 pelo nome completo (vale o mesmo cargo de 2022, quando houver). A variação é a diferença de votos em cada lugar: verde/azul para alta, laranja/vermelho para queda (forte a partir de 20%). Na comparação entre dois candidatos — inclusive de cargos diferentes, já que cada eleitor vota em todos os cargos — o app mostra a diferença de votos lugar a lugar; "mais parecidos" ordena pela menor diferença proporcional.</p></details>
      <details><summary>🔒 Análises (mapa, perfil, abstenção, transferência)</summary>
        <p>O perfil do eleitor cruza os votos de cada seção com o perfil do eleitorado da seção (TSE). A transferência entre turnos é uma <strong>estimativa estatística</strong> (mínimos quadrados com restrições sobre os resultados por seção), não um dado oficial: mostra para onde os votos tendem a ter ido.</p></details>
    </section>
    <section class="cartao"><h3>📚 De onde vêm os dados</h3>
      <ul class="det-lista">
        <li><strong>2026, ao vivo:</strong> arquivos oficiais de divulgação do <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noopener">TSE</a>, consultados direto do seu aparelho a cada 30 segundos.</li>
        <li><strong>2022:</strong> arquivos oficiais do Portal de Dados Abertos do <a href="https://dadosabertos.tse.jus.br/dataset/resultados-2022" target="_blank" rel="noopener">TSE</a>: votação por candidato, município e zona, e votação por seção eleitoral (SC).</li>
        <li><strong>2026 por seção e bairro:</strong> boletins de urna de cada seção do 1º turno, publicados pelo TSE em "Dados de urna", somados pelo bairro do local de votação.</li>
        <li><strong>Bairros dos locais de votação:</strong> cadastro de locais de votação do TSE (2022 e 2026); em Florianópolis, a lista do TRE-SC.</li>
        <li><strong>Regiões e população:</strong> IBGE. <strong>Associações de municípios (FECAM):</strong> Secretaria de Estado da Assistência Social de SC (sas.sc.gov.br).</li>
        <li><strong>🔒 Análises:</strong> perfil do eleitorado por seção (TSE, 2026), coordenadas dos locais de votação (TSE), mapa base © OpenStreetMap e estimativa de transferência de votos entre turnos, seção a seção. Os dados desta área são criptografados e só abrem com usuário e senha.</li>
      </ul>
      <p class="nota">Projeto independente, sem vínculo com a Justiça Eleitoral. Projeções e chances de reverter são estimativas do app; vale sempre o resultado oficial do TSE.</p>
    </section>
    <section class="cartao"><h3>🔐 Privacidade</h3>
      <ul class="det-lista">
        <li><strong>Sem cadastro e sem rastreamento:</strong> o app não usa cookies de publicidade nem ferramentas de análise de visitas.</li>
        <li><strong>Tudo fica no seu aparelho:</strong> candidatos acompanhados (❤️), preferências e a última aba aberta são salvos só no navegador deste aparelho.</li>
        <li><strong>Dados públicos:</strong> os resultados e as fotos dos candidatos são baixados direto dos servidores do TSE e deste site (no mapa da área 🔒, também do OpenStreetMap/Esri); nenhum dado pessoal é enviado.</li>
        <li><strong>Área 🔒:</strong> os dados exclusivos ficam criptografados (AES-256); a senha é verificada no próprio aparelho e não é enviada a lugar nenhum.</li>
      </ul>
    </section>
    <section class="cartao"><h3>ℹ️ Sobre esta versão</h3>
      <p>Versão <strong>${esc(versaoLegivel())}</strong> · Eleições 2026, ${TURNO}º turno.</p>
      <p class="nota">Encontrou algo estranho nos números? Fale com <a href="https://www.instagram.com/maiconcombat/" target="_blank" rel="noopener">@maiconcombat</a>.</p>
    </section>`
}
// "202610071300" → "07/10/2026 12:00"
const versaoLegivel = () => (/^\d{12}$/.test(VERSAO) ? `${VERSAO.slice(6, 8)}/${VERSAO.slice(4, 6)}/${VERSAO.slice(0, 4)} ${VERSAO.slice(8, 10)}:${VERSAO.slice(10, 12)}` : VERSAO || 'local')

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
        el.ano = 2022
        el.anul = new Set(j.anulados.filter((x) => x.startsWith(el.id + '-')).map((x) => Number(x.split('-')[2])))
        el.partidos = j.partidos
        el.situ = (c) => situ2022(c.sit)
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

// arquivos por município com os votos de cada seção (dados<ano>/secoes/<código TSE>.json):
// 2022 vem do Portal de Dados Abertos; 2026, dos boletins de urna publicados pelo TSE.
// Também os índices de bairros por candidato (dados<ano>/bairros-<eleição>.json).
const ARQ_ANO = new Map()
function arquivoAno(caminho, aoCarregar = () => renderizar()) {
  if (!ARQ_ANO.has(caminho)) {
    const p = fetch(`${caminho}?v=${VERSAO}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP'))))
    p.then((j) => {
      p.valor = j
      aoCarregar()
    }).catch(() => {
      p.erro = true
      setTimeout(() => ARQ_ANO.get(caminho) === p && ARQ_ANO.delete(caminho), 30_000)
      aoCarregar()
    })
    ARQ_ANO.set(caminho, p)
  }
  return ARQ_ANO.get(caminho)
}
function secoesAno(ano, cd, aoCarregar) {
  const p = arquivoAno(`dados${ano}/secoes/${cd}.json`, aoCarregar)
  if (p.valor) p.valor.cd = cd
  return p.valor || null
}
const erroSecoes = (ano, cd) => !!ARQ_ANO.get(`dados${ano}/secoes/${cd}.json`)?.erro

const BAIRRO_LOCAL_FLORIPA = new Map(FLORIPA.locais.map((l) => [`${l.z}-${l.cod}`, l.bairro]))
// bairro do local de votação, gravado no arquivo de cada ano (cadastro de locais do TSE; em Florianópolis,
// a lista do TRE-SC); a lista de floripa.js só entra se o arquivo não trouxer o bairro
function bairroDoLocal(arq, loc) {
  return arq.locais[loc]?.[2] || (arq.cd === FLORIPA_CD && BAIRRO_LOCAL_FLORIPA.get(loc)) || 'Bairro não informado'
}
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
function agregarSecoes(arq, el, filtro, grupo, foco) {
  const votos = arq.votos[el.id] || {}
  const anul = el.anul
  const prop = el.cargo === 6 || el.cargo === 7
  const total = new Map()
  const grupos = new Map()
  let validos = 0, brancos = 0, nulos = 0, secoes = 0
  for (const [zs, arr] of Object.entries(votos)) {
    const [z] = zs.split('-')
    const loc = arq.secoes[zs]
    const bairro = bairroDoLocal(arq, loc)
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
    const sg = el.partidos?.[String(nr)] || String(nr)
    return { nome: `Legenda ${sg}`, partido: sg, legenda: true }
  }
  const c = el.porNumero?.get(String(nr))
  return c ? { nome: c.nome, partido: c.partido, sit: c.sit, c } : { nome: `Nº ${nr}`, partido: '' }
}

function rotuloGrupo(arq, grupo, chave) {
  if (grupo === 'zona') return `${Number(chave)}ª zona${arq.cd === FLORIPA_CD && ROTULO_ZONA[z4(chave)] ? ` · ${ROTULO_ZONA[z4(chave)]}` : ''}`
  if (grupo === 'local') {
    const l = arq.locais[chave] || ['Local ' + chave, '']
    const b = bairroDoLocal(arq, chave)
    return `${tituloLocal(l[0])}<div class="cand-meta">${b ? esc(b) + ' · ' : ''}${esc(tituloLocal(l[1]))} · ${Number(chave.split('-')[0])}ª zona</div>`
  }
  if (grupo === 'bairro') return esc(chave)
  const [z, sec] = chave.split('-')
  const l = arq.locais[arq.secoes[chave]] || ['']
  return `Seção ${sec}<div class="cand-meta">${esc(tituloLocal(l[0]))} · ${Number(z)}ª zona</div>`
}

// posição de um candidato num grupo (zona, bairro, local, seção): 1 + quantos tiveram mais votos que ele
function posicaoNoGrupo(g, nr) {
  if (nr == null || !g.top.has(nr)) return null
  const v = g.top.get(nr)
  let p = 1
  for (const x of g.top.values()) if (x > v) p++
  return { p, n: g.top.size, v }
}
const textoPosicao = (pos) => (pos ? `<span class="pos-foco ${pos.p === 1 ? 'pos-1' : pos.p <= 3 ? 'pos-top' : ''}">${pos.p}º de ${pos.n}</span>` : '<span class="mudo">sem votos</span>')

// Explorador de um município: zonas › locais › bairros › seções. X é o estado (H22 para 2022, B26 para 2026).
function renderLocal(X, el) {
  const L = X.local
  const arq = secoesAno(el.ano, L.cd)
  if (!arq) return `<section class="cartao vazio">${erroSecoes(el.ano, L.cd) ? (el.ano === 2026 ? 'Os boletins deste município ainda não estão no app.' : 'Não consegui carregar as seções deste município.') : `Carregando as seções de ${esc(L.nm)}…`}</section>`
  if (!el.porNumero) el.porNumero = new Map(el.candidatos.map((c) => [String(c.numero), c]))
  const floripa = L.cd === FLORIPA_CD
  const grupos = ['zona', 'bairro', 'local', 'secao']
  const grupo = grupos.includes(X.grupo) ? X.grupo : 'zona'
  const filtro = { zona: L.zona, local: L.localVot, bairro: L.bairro, secao: L.secao }
  const ag = agregarSecoes(arq, el, filtro, grupo, X.foco)
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
  const focoInfo = X.foco != null ? nomeVotavel(el, X.foco) : null
  const linhasRank = ranking.slice(0, X.verTodos ? 400 : 25).map(([nr, v], i) => {
    const n = nomeVotavel(el, nr)
    const cor = corPartido(n.partido)
    return `<li class="h22-cand ${X.foco === nr ? 'foco' : ''}" style="${estiloCor(cor)}" data-h22-foco="${nr}">
      <div class="cand-linha"><span class="pos">${i + 1}º</span><span class="cand-nome">${esc(n.nome)}</span> ${n.partido ? pill(n.partido) : ''} ${n.c && el.situ ? el.situ(n.c) : ''}</div>
      <div class="cand-meta">${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, ag.validos))}% dos válidos${n.c ? ` · em SC: ${fmt.format(n.c.votos)}` : ''}</div></li>`
  }).join('')
  const linhasGrupo = ag.grupos
    .map((g) => {
      const [nrTop, vTop] = [...g.top.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0]
      return { g, nrTop, vTop }
    })
    .sort((a, b) => (X.foco != null ? b.g.foco - a.g.foco : b.g.validos - a.g.validos))
  const maxLinhas = X.verGrupos ? linhasGrupo.length : grupo === 'secao' ? 100 : 300
  // planilha da tabela atual (todas as linhas)
  const rotuloSimples = (k) => {
    if (grupo === 'zona') return `${Number(k)}ª zona`
    if (grupo === 'bairro') return k
    if (grupo === 'local') return tituloLocal((arq.locais[k] || [k])[0])
    return `Seção ${k.split('-')[1]} (${Number(k.split('-')[0])}ª zona)`
  }
  X.csv = {
    nome: `${nomeArquivo(L.nm)}-${el.ano}-${nomeArquivo(ROTULO_ELEICAO[el.id] || ROTULO_26[el.id] || el.id)}-${grupo}${focoInfo ? '-' + nomeArquivo(focoInfo.nome) : ''}.csv`,
    cab: [{ zona: 'Zona', local: 'Local de votação', bairro: 'Bairro', secao: 'Seção' }[grupo], ...(grupo === 'local' || grupo === 'secao' ? ['Bairro', 'Zona'] : []), 'Votos válidos', '1º colocado', 'Partido do 1º', 'Votos do 1º', ...(focoInfo ? [`Votos de ${focoInfo.nome}`, `% de ${focoInfo.nome}`, 'Posição'] : [])],
    linhas: linhasGrupo.map(({ g, nrTop, vTop }) => {
      const top = nrTop != null ? nomeVotavel(el, nrTop) : null
      const loc = grupo === 'secao' ? arq.secoes[g.chave] : g.chave
      const pos = focoInfo && !focoInfo.legenda ? posicaoNoGrupo(g, X.foco) : null
      return [rotuloSimples(g.chave), ...(grupo === 'local' || grupo === 'secao' ? [bairroDoLocal(arq, loc), `${Number(String(g.chave).split('-')[0])}ª`] : []), g.validos, top?.nome || '', top?.partido || '', vTop, ...(focoInfo ? [g.foco, pctDe(g.foco, g.validos), pos ? `${pos.p}º de ${pos.n}` : ''] : [])]
    }),
  }
  return `<section class="cartao">
      <h3>📍 ${esc(L.nm)} · ${el.ano}</h3>
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
      <p class="nota">Toque num candidato para ver quantos votos teve em cada ${grupo === 'secao' ? 'seção' : grupo}.</p>
      <ul class="h22-lista">${linhasRank}</ul>
      ${ranking.length > 25 && !X.verTodos ? `<button type="button" class="botao secundario" data-h22-todos>Mostrar todos (${ranking.length})</button>` : ''}
    </section>
    <section class="cartao"><h3>Por ${grupo === 'secao' ? 'seção' : grupo === 'local' ? 'local de votação' : grupo}${focoInfo ? ` · ${esc(focoInfo.nome)}` : ''}</h3>
      <div class="segmentado" role="group">${grupos
        .map((k) => `<button type="button" data-h22-grupo="${k}" aria-pressed="${grupo === k}">${{ zona: 'Zonas', local: 'Locais', bairro: 'Bairros', secao: 'Seções' }[k]}</button>`)
        .join('')}</div>
      <p class="nota"><strong>${fmt.format(linhasGrupo.length)}</strong> ${{ zona: 'zonas', local: 'locais de votação', bairro: 'bairros', secao: 'seções' }[grupo]}${linhasGrupo.length > maxLinhas ? ` · mostrando ${fmt.format(maxLinhas)}` : ''}${ag.secoes ? ` · ${fmt.format(ag.secoes)} seções com boletim` : ''}${el.ano === 2026 ? ' (seções agregadas votam junto com a seção principal)' : ''}.</p>
      ${focoInfo ? `<p class="nota">Votos de <strong>${esc(focoInfo.nome)}</strong> em cada linha. <button type="button" class="link-zonas leve" data-h22-foco="">✕ Limpar</button></p>` : ''}
      <table class="tabela h22-grupos"><thead><tr><th>${{ zona: 'Zona', local: 'Local', bairro: 'Bairro', secao: 'Seção' }[grupo]}</th><th class="dir">${focoInfo ? 'Votos' : 'Válidos'}</th></tr></thead><tbody>${linhasGrupo
        .slice(0, maxLinhas)
        .map(({ g, nrTop, vTop }) => {
          const top = nrTop != null ? nomeVotavel(el, nrTop) : null
          const alvo = grupo === 'zona' ? `data-h22-zona="${g.chave}"` : grupo === 'local' ? `data-h22-local="${esc(g.chave)}"` : grupo === 'bairro' ? `data-h22-bairro="${esc(g.chave)}"` : `data-h22-secao="${esc(g.chave)}"`
          const pos = focoInfo && !focoInfo.legenda ? posicaoNoGrupo(g, X.foco) : null
          const foiTop = pos?.p === 1 && nrTop === X.foco
          return `<tr class="clicavel" ${alvo}><td>${rotuloGrupo(arq, grupo, g.chave)}
              ${top ? `<div class="cand-meta">🏆 ${esc(top.nome)} ${pill(top.partido)} ${fmtPct.format(pctDe(vTop, g.validos))}%</div>` : ''}
              ${focoInfo && !focoInfo.legenda && !foiTop ? `<div class="cand-meta">📍 ${esc(focoInfo.nome)}: ${pos && top ? `${fmt.format(vTop - pos.v)} votos atrás do 1º` : 'sem votos aqui'}</div>` : ''}</td>
            <td class="dir">${focoInfo ? `<strong>${fmt.format(g.foco)}</strong><div class="cand-meta">${fmtPct.format(pctDe(g.foco, g.validos))}%</div>${!focoInfo.legenda ? `<div class="cand-meta">${textoPosicao(pos)}</div>` : ''}` : fmt.format(g.validos)}</td></tr>`
        })
        .join('')}</tbody></table>
      ${linhasGrupo.length > maxLinhas ? `<button type="button" class="botao secundario" data-h22-vergrupos>Mostrar todas as ${fmt.format(linhasGrupo.length)} ${grupo === 'secao' ? 'seções' : 'linhas'}</button>` : ''}
      <div class="exportar">${botaoCard(`local-${el.ano}`, cardLocal(X, el, L, arq, grupo, linhasGrupo, ranking, ag, focoInfo, rotuloSimples))}<button type="button" class="botao secundario" data-csv-local>⬇️ Baixar planilha (CSV)</button></div>
      <p class="nota">Toque numa linha para entrar nela. Fonte: TSE, ${el.ano === 2026 ? 'boletins de urna de cada seção (2026)' : 'votação por seção eleitoral (2022)'}. Bairros pelo cadastro de locais de votação ${floripa ? 'do TRE-SC' : `do TSE (${el.ano})`}.</p>
    </section>`
}

// card do explorador: com candidato em foco, os grupos (zonas, bairros…) onde ele foi melhor; sem foco, os mais votados
function cardLocal(X, el, L, arq, grupo, linhasGrupo, ranking, ag, focoInfo, rotuloSimples) {
  const onde = [L.nm, L.zona ? `${Number(L.zona)}ª zona` : '', L.bairro || '', L.localVot ? tituloLocal((arq.locais[L.localVot] || [''])[0]) : ''].filter(Boolean).join(' › ')
  const base = { chapeu: `ELEIÇÕES ${el.ano} · ${L.nm.toUpperCase()}`, turno: el.ano === 2026 ? turnoDe(el.id) : null, fonte: el.ano === 2022 ? 'Fonte: TSE · votação por seção 2022' : null }
  const nomeGrupo = { zona: 'zonas', local: 'locais de votação', bairro: 'bairros', secao: 'seções' }[grupo]
  if (focoInfo && !focoInfo.legenda) {
    const ls = [...linhasGrupo].sort((a, b) => b.g.foco - a.g.foco).filter((x) => x.g.foco > 0).slice(0, 8)
    const max = Math.max(1, ...ls.map((x) => x.g.foco))
    const somaFoco = linhasGrupo.reduce((a, x) => a + x.g.foco, 0)
    return { ...base, total: { ...totalCard(onde, somaFoco), sub: `${fmtPct.format(pctDe(somaFoco, ag.validos))}% dos válidos · em ${linhasGrupo.filter((x) => x.g.foco > 0).length} ${{ zona: 'zonas', local: 'locais', bairro: 'bairros', secao: 'seções' }[grupo]}` }, foto: focoInfo.c?.foto, nome: focoInfo.nome, cor: corPartido(focoInfo.partido), sub: `${focoInfo.partido} · ${ROTULO_ELEICAO[el.id] || ROTULO_26[el.id] || el.nome}`, titulo: `Mais votos · ${nomeGrupo}`, subtitulo: onde,
      linhas: ls.map(({ g, nrTop }) => { const pos = posicaoNoGrupo(g, X.foco); return { nome: rotuloSimples(g.chave), extra: pos ? `${pos.p}º de ${pos.n}${pos.p > 1 && nrTop != null ? ` · 1º: ${nomeVotavel(el, nrTop).nome}` : ' · 🏆 1º lugar'}` : '', valor: fmt.format(g.foco), dir2: `${fmtPct.format(pctDe(g.foco, g.validos))}%`, frac: g.foco / max } }) }
  }
  const top = ranking.slice(0, 8)
  const max = Math.max(1, ...top.map(([, v]) => v))
  const n0 = top[0] ? nomeVotavel(el, top[0][0]) : null
  return { ...base, total: { ...totalCard(`Votos válidos · ${onde}`, ag.validos), sub: `brancos ${fmt.format(ag.brancos)} · nulos ${fmt.format(ag.nulos)}` }, nome: onde, cor: corPartido(n0?.partido), sub: `${ROTULO_ELEICAO[el.id] || ROTULO_26[el.id] || el.nome} · ${fmt.format(ag.validos)} votos válidos`, titulo: 'Mais votados aqui', subtitulo: `${fmt.format(ag.secoes)} seções`,
    linhas: top.map(([nr, v]) => { const n = nomeVotavel(el, nr); return { foto: n.c?.foto, nome: n.nome, extra: n.partido, valor: fmt.format(v), dir2: `${fmtPct.format(pctDe(v, ag.validos))}%`, frac: v / max, corBarra: corPartido(n.partido) } }) }
}

function seletorLocal(X) {
  const L = X.local
  const termo = semAcento((X.buscaMun || '').trim())
  const achados = termo ? MUNICIPIOS_SC.filter((m) => semAcento(m[2]).includes(termo)).slice(0, 10) : []
  const gf = GRANDE_FLORIPA.map((nm) => MUNICIPIOS_SC.find((m) => chaveNome(m[2]) === chaveNome(nm))).filter(Boolean).slice(0, 5)
  const atalhos = [...gf, ...MUNICIPIOS_SC.filter((m) => !gf.includes(m)).slice(0, 6)]
  return `<div class="h22-onde">
    <div class="atalhos-chips">
      <button type="button" class="atalho regiao ${!L ? 'ativo' : ''}" data-h22-mun="">🗺️ SC inteira</button>
      ${atalhos.map((m) => `<button type="button" class="atalho ${L?.cd === m[0] ? 'ativo' : ''}" data-h22-mun="${m[0]}" data-h22-nm="${esc(m[2])}">${esc(m[2])}</button>`).join('')}
    </div>
    <input id="h22-mun" type="search" autocomplete="off" placeholder="📍 Outro município (por zona, bairro, local e seção)…" value="${esc(X.buscaMun || '')}">
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
      ${seletorLocal(H22)}
      <p class="nota">${fmt.format(el.validos)} votos nominais válidos · ${el.candidatos.length} candidatos${prop ? ` · ${el.vagas} vagas` : ''}.${prop && el.qe ? ` <strong>📐 Quociente eleitoral de 2022: ${fmt.format(el.qe)}</strong> (${fmt.format(el.validosTotais)} válidos com legenda ÷ ${el.vagas}).` : ''} Toque num candidato que concorre em 2026 para abrir a ficha atual.</p>
    </section>
    ${H22.local ? renderLocal(H22, el) : `<section class="cartao"><h3>${prop ? `Eleitos em 2022 (${eleitos.length}) e onde estão em 2026` : 'Principais candidatos de 2022 e onde estão em 2026'}</h3>
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

/* ---------------- 2026 por bairro, local e seção (boletins de urna) ---------------- */

// Votos de cada seção do 1º turno de 2026, lidos dos boletins de urna (BU) publicados pelo TSE,
// com o bairro de cada local de votação (cadastro de locais do TSE; em Florianópolis, a lista do TRE-SC).
const B26 = { sel: 't1-c7', local: null, grupo: 'zona', foco: null, els: new Map() }
const estadoLocal = () => (estado.aba.tipo === 'bai' ? B26 : H22)
const ROTULO_26 = { 't1-c1': 'Presidente', 't1-c3': 'Governador', 't1-c5': 'Senado', 't1-c6': 'Dep. Federal', 't1-c7': 'Dep. Estadual', 't2-c1': 'Presidente · 2º turno', 't2-c3': 'Governador · 2º turno' }
// eleições com dados por seção já publicados (dados2026/indice.json); o 2º turno entra sozinho quando for gerado
const INDICE26 = new Set(['t1-c1', 't1-c3', 't1-c5', 't1-c6', 't1-c7'])
const indice26Pronto = fetch(`dados2026/indice.json?v=${VERSAO}`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => j?.eleicoes?.forEach((id) => INDICE26.add(id)))
  .catch(() => {})
const eleicoes26 = () => Object.keys(ROTULO_26).filter((id) => INDICE26.has(id))
const turnoDe = (id) => Number(String(id)[1]) || 1
// eleição por seção para um cargo: a do turno atual, se já publicada; senão a do 1º turno
const eleicaoDoCargo = (cargo) => (INDICE26.has(`t${TURNO}-c${cargo}`) ? `t${TURNO}-c${cargo}` : `t1-c${cargo}`)
const NOME_MUN = new Map(MUNICIPIOS_SC.map((m) => [m[0], m[2]]))

// "eleição" de 2026 no formato do explorador, a partir dos candidatos do estado
function eleicao26(d, cargo, turno = 1) {
  const el = { id: `t${turno}-c${cargo}`, ano: 2026, cargo, turno, nome: ROTULO_26[`t${turno}-c${cargo}`], candidatos: d.candidatos, partidos: {}, anul: new Set(), situ: (c) => selo(c) }
  for (const c of d.candidatos) {
    if (!c.valido) el.anul.add(Number(c.numero))
    el.partidos[String(c.numero).slice(0, 2)] ??= c.partido
  }
  return el
}

async function carregarBairros(ctrl) {
  await indice26Pronto
  const cargo = Number(B26.sel.split('-c')[1])
  const aba = ABAS.find((a) => a.cargo === cargo)
  B26.erro = false
  if (!B26.els.has(B26.sel) || Date.now() - (B26.t || 0) > 120_000) {
    try {
      const d = await buscar(aba, UF, turnoDe(B26.sel), ctrl.signal)
      if (ctrl.signal.aborted) return
      B26.els.set(B26.sel, eleicao26(d, cargo, turnoDe(B26.sel)))
      B26.t = Date.now()
    } catch {
      if (ctrl.signal.aborted) return
      B26.erro = !B26.els.has(B26.sel)
    }
  }
  estado.dados = { bai: true }
  renderizar()
  statusEl.textContent = 'Boletins de urna · TSE'
  statusEl.className = 'status ok'
}

function renderBairros26() {
  if (DEMO) return '<div class="cartao vazio">Os bairros usam os boletins de urna reais do TSE e não aparecem no modo demonstração.</div>'
  const el = B26.els.get(B26.sel)
  const pills = `<div class="segmentado h22-pills" role="group">${eleicoes26()
    .map((id) => `<button type="button" data-h22="${id}" aria-pressed="${id === B26.sel}">${ROTULO_26[id]}</button>`)
    .join('')}</div>`
  return `<section class="cartao resumo">
      <div class="resumo-titulo"><h2>Bairros, locais e seções · 2026</h2><span class="selo final">Boletins de urna</span></div>
      ${pills}
      ${el ? seletorCandidatoB26(el) : ''}
      ${seletorLocal(B26)}
      <p class="nota">Votos de cada seção eleitoral do ${turnoDe(B26.sel)}º turno, lidos dos boletins de urna publicados pelo TSE e somados pelo bairro do local de votação. Escolha um município para ver por zona, bairro, local e seção.${TURNO === 2 && !INDICE26.has('t2-c1') && !INDICE26.has('t2-c3') ? ' <strong>Os boletins do 2º turno entram aqui assim que forem processados.</strong>' : ''}</p>
    </section>
    ${!el ? `<div class="cartao vazio">${B26.erro ? 'Não consegui carregar os candidatos agora.' : 'Carregando…'}</div>` : B26.local ? renderLocal(B26, el) : B26.foco != null ? bairrosDoCandidatoSC(el) : fortesPorBairro(el)}`
}

// candidato em foco na aba Bairros: os ❤️ acompanhados (de qualquer cargo) e uma busca
function seletorCandidatoB26(el) {
  // só os acompanhados do cargo escolhido; o primeiro entra em destaque sozinho (até a pessoa limpar)
  const favs = favoritos.filter((f) => ABAS.find((a) => a.id === f.aba)?.cargo === el.cargo)
  B26.semAuto ??= new Set()
  if (B26.foco == null && !B26.focoSq && favs.length && !B26.semAuto.has(el.id)) B26.focoSq = favs[0].sqcand
  if (B26.focoSq) {
    const c = el.candidatos.find((x) => x.sqcand === B26.focoSq)
    if (c) B26.foco = Number(c.numero)
    B26.focoSq = null
  }
  const atual = el.porNumero?.get(String(B26.foco)) || el.candidatos.find((c) => Number(c.numero) === B26.foco)
  const termo = semAcento((B26.buscaCand || '').trim())
  const achados = termo ? el.candidatos.filter((x) => x.valido && semAcento(`${x.nome} ${x.nomeCompleto} ${x.partido} ${x.numero}`).includes(termo)).slice(0, 10) : []
  return `<div class="b26-cand">
    ${favs.length
      ? `<div class="atalhos-grupo"><span class="atalhos-rot">❤️ Acompanhados · ${esc(ROTULO_26[B26.sel] || '')}</span><div class="atalhos-chips">${favs
          .map((f) => {
            const ativo = atual && atual.sqcand === f.sqcand
            return `<button type="button" class="atalho ${ativo ? 'ativo' : ''}" data-b26-fav="${esc(f.aba)}|${esc(f.sqcand)}" style="${estiloCor(corPartido(f.partido))}">❤️ ${esc(f.nome)} <small>${esc(f.partido || '')}</small></button>`
          })
          .join('')}</div></div>`
      : `<p class="nota">Você não acompanha nenhum candidato a ${esc(ROTULO_26[B26.sel] || 'este cargo')}. Toque no ♡ de um candidato (na aba do cargo ou na ficha) para ele aparecer aqui já em destaque.</p>`}
    <input id="b26-busca" type="search" autocomplete="off" placeholder="🔎 Buscar ${esc(ROTULO_26[B26.sel] || 'candidato')} por nome, partido ou número…" value="${esc(B26.buscaCand || '')}">
    ${termo ? `<div class="atalhos-chips">${achados.map((x) => `<button type="button" class="atalho" data-b26-cand="${esc(x.numero)}" style="${estiloCor(corPartido(x.partido))}">${esc(x.nome)} <small>${esc(x.partido)} · ${esc(x.numero)}</small></button>`).join('') || '<span class="nota">Nenhum candidato encontrado neste cargo.</span>'}</div>` : ''}
    ${atual ? `<div class="pro-cand" style="${estiloCor(corPartido(atual.partido))}">Em destaque: <span class="cand-nome">${esc(atual.nome)}</span> ${pill(atual.partido)} <span class="mudo">nº ${esc(atual.numero)} · ${fmt.format(atual.votos)} votos em SC</span> <button type="button" class="link-zonas leve" data-b26-limpar>✕ Limpar</button> <button type="button" class="link-zonas" ${attrCand(atual, ABAS.find((a) => a.cargo === el.cargo)?.id, UF)}>📋 Abrir ficha ›</button></div>` : ''}
  </div>`
}

// candidato em foco, SC inteira: os bairros onde foi mais votado no estado
function bairrosDoCandidatoSC(el) {
  const idx = arquivoAno(`dados2026/bairros-${el.id}.json`)
  if (!idx.valor) return `<div class="cartao vazio">${idx.erro ? 'Os bairros ainda não estão no app.' : 'Carregando os bairros…'}</div>`
  const c = el.candidatos.find((x) => Number(x.numero) === B26.foco)
  const x = idx.valor.c[B26.foco]
  if (!c || !x) return '<div class="cartao vazio">Sem votos nos boletins de urna para este candidato.</div>'
  const tem22 = PREF.mostrar2022 && !!x.e22
  const cor = corPartido(c.partido)
  const lista = x.v
  return `<section class="cartao bai"><h3>🏘️ Onde ${esc(c.nome)} foi mais votado em SC</h3>
    ${tem22 ? `<p class="var-resumo">Desde 2022 (${esc(ROTULO_ELEICAO[x.e22] || '')}): <span class="var var-alta-forte">▲ cresceu em ${fmt.format(x.s[0])} bairros</span> <span class="var var-queda-forte">▼ caiu em ${fmt.format(x.s[1])}</span></p>` : ''}
    ${tem22
      ? listaComparada(lista.map(([bi, v, v22]) => { const [cd, nome, val] = idx.valor.b[bi]; return { nome, sub: NOME_MUN.get(cd) || cd, v, v22: v22 || 0, meta: `${fmtPct.format(pctDe(v, val))}% dos votos do bairro em 2026`, ir: `data-b26-ir="${esc(cd)}" data-b26-bairro="${esc(nome)}"` } }), cor)
      : `<table class="tabela bai-tabela"><thead><tr><th>Bairro</th><th class="dir">Votos</th><th class="dir">% bairro</th></tr></thead><tbody>${lista
      .map(([bi, v]) => {
        const [cd, nome, val] = idx.valor.b[bi]
        return `<tr class="clicavel" data-b26-ir="${esc(cd)}" data-b26-bairro="${esc(nome)}"><td><strong>${esc(nome)}</strong><div class="cand-meta">${esc(NOME_MUN.get(cd) || cd)}</div></td>
          <td class="dir">${fmt.format(v)}</td><td class="dir">${fmtPct.format(pctDe(v, val))}%</td></tr>`
      })
      .join('')}</tbody></table>`}
    <p class="nota">Teve votos em ${fmt.format(x.n)} bairros de SC. Toque num bairro para ver os locais e seções, ou escolha um município acima para ver todos os bairros dele com a posição de ${esc(c.nome)}.</p>
  </section>`
}

// sem município escolhido: o bairro mais forte de cada candidato
function fortesPorBairro(el) {
  const idx = arquivoAno(`dados2026/bairros-${el.id}.json`)
  if (!idx.valor) return `<div class="cartao vazio">${idx.erro ? 'Os bairros de 2026 ainda não estão no app.' : 'Carregando os bairros…'}</div>`
  const aba = ABAS.find((a) => a.cargo === el.cargo)
  const lista = el.candidatos.filter((c) => c.valido && idx.valor.c[Number(c.numero)]).slice(0, B26.verTodos ? 1000 : 30)
  return `<section class="cartao"><h3>🏆 Bairro mais forte de cada candidato</h3>
    <p class="nota">Bairro onde cada um teve mais votos em SC. Toque no candidato para abrir a ficha com a lista completa.</p>
    <ul class="h22-lista">${lista
      .map((c) => {
        const [bi, v] = idx.valor.c[Number(c.numero)].v[0]
        const [cd, nome, val] = idx.valor.b[bi]
        return `<li class="h22-cand" style="${estiloCor(corPartido(c.partido))}" ${attrCand(c, aba.id, UF)}>
          <div class="cand-linha"><span class="cand-nome">${esc(c.nome)}</span> ${pill(c.partido)}</div>
          <div class="cand-meta">📍 <strong>${esc(nome)}</strong> · ${esc(NOME_MUN.get(cd) || cd)} · ${fmt.format(v)} votos (${fmtPct.format(pctDe(v, val))}% do bairro)</div>
          <div class="cand-meta">${fmt.format(c.votos)} votos em SC</div></li>`
      })
      .join('')}</ul>
    ${!B26.verTodos && el.candidatos.length > 30 ? '<button type="button" class="botao secundario" data-h22-todos-est>Mostrar todos</button>' : ''}
  </section>`
}

// votos de um candidato por bairro de um município (arquivo de seções)
function porBairro(arq, elId, cargo, nr) {
  const ag = agregarSecoes(arq, { id: elId, cargo, anul: new Set() }, {}, 'bairro', nr)
  return new Map(ag.grupos.map((g) => [g.chave, g]))
}

/* ---------------- planilha (CSV) e card para compartilhar ---------------- */

function baixarArquivo(nome, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nome
  document.body.append(a)
  a.click()
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1500)
}
// CSV no padrão do Excel em português: separador ";", vírgula decimal e BOM UTF-8
function baixarCSV({ nome, cab, linhas }) {
  const q = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`)
  const txt = '﻿' + [cab, ...linhas].map((l) => l.map(q).join(';')).join('\r\n')
  baixarArquivo(nome, new Blob([txt], { type: 'text/csv;charset=utf-8' }))
}
const nomeArquivo = (s) => semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// Imagem para compartilhar (1080×1350, formato retrato do Instagram). Um card tem:
//   chapeu, nome, sub, cor            → faixa do topo
//   titulo, subtitulo                 → título do conteúdo
//   tiles:  [{ rot, valor, sub, cor }]                       → blocos de números (2 por linha)
//   linhas: [{ nome, extra, valor, dir2, corDir2, frac, ponto, barras: [{ frac, cor }] }] → lista
//   pilhas: [{ nome, extra, segs: [{ frac, cor, txt }] }] + legenda: [{ cor, txt }]     → barras empilhadas
//   rodape, fonte, exclusivo          → rodapé (com a foto e o @ do criador)
const CARDS = new Map()
// registra o card e devolve o botão que o compartilha (a chave identifica o lugar da tela)
function botaoCard(chave, card, rotulo = '📸 Compartilhar imagem', classe = 'botao') {
  CARDS.set(chave, card)
  return `<button type="button" class="${classe} botao-card" data-card="${esc(chave)}">${rotulo}</button>`
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-card]')
  if (!b || !CARDS.has(b.dataset.card)) return
  ev.stopPropagation()
  compartilharCard(CARDS.get(b.dataset.card))
}, true)

// baixa uma imagem com CORS (a foto do TSE libera o domínio do app) para poder desenhar no canvas
function carregarImagem(url) {
  if (!url) return Promise.resolve(null)
  return fetch(url, { mode: 'cors' })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => b && new Promise((ok) => {
      const im = new Image()
      im.onload = () => ok(im)
      im.onerror = () => ok(null)
      im.src = URL.createObjectURL(b)
    }))
    .catch(() => null)
}
// desenha uma imagem recortada em círculo, com aro
function fotoCirculo(g, im, cx, cy, r, aro = '#ffffff', larg = 6) {
  g.save()
  g.beginPath()
  g.arc(cx, cy, r + larg, 0, 2 * Math.PI)
  g.fillStyle = aro
  g.fill()
  g.beginPath()
  g.arc(cx, cy, r, 0, 2 * Math.PI)
  g.clip()
  const lado = Math.min(im.naturalWidth, im.naturalHeight)
  // fotos de candidato são retratos: corta mais perto do topo
  const y0 = im.naturalHeight > im.naturalWidth ? (im.naturalHeight - lado) * 0.2 : (im.naturalHeight - lado) / 2
  g.drawImage(im, (im.naturalWidth - lado) / 2, y0, lado, lado, cx - r, cy - r, 2 * r, 2 * r)
  g.restore()
}

// legenda que acompanha as imagens (e que o botão "copiar legenda" copia)
const INSTAGRAM = 'https://www.instagram.com/maiconcombat/'
const legendaShare = (titulo) => `${titulo}\n\n📲 Siga @maiconcombat 👉 ${INSTAGRAM}\nApuração 2026 · dados oficiais do TSE`

async function compartilharCard(card) {
  const { blob, nome } = await desenharCard(card)
  const arq = new File([blob], nome, { type: 'image/png' })
  if (navigator.canShare?.({ files: [arq] })) {
    try {
      await navigator.share({ files: [arq], title: `${card.nome} · ${card.titulo}`, text: legendaShare(`${card.nome} · ${card.titulo}`) })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  baixarArquivo(nome, blob)
}

// Carrossel: várias imagens compartilhadas de uma vez (Instagram aceita até 20); sem suporte, baixa uma a uma
async function compartilharCarrossel(cards, titulo, botao) {
  const total = cards.length
  const rotulo = botao?.innerHTML
  const arqs = []
  for (const [i, card] of cards.entries()) {
    if (botao) botao.innerHTML = `⏳ Gerando ${i + 1} de ${total}…`
    const { blob, nome } = await desenharCard({ ...card, pagina: `${i + 1}/${total}` })
    arqs.push(new File([blob], `${String(i + 1).padStart(2, '0')}-${nome}`, { type: 'image/png' }))
  }
  if (botao) botao.innerHTML = rotulo
  if (navigator.canShare?.({ files: arqs })) {
    try {
      await navigator.share({ files: arqs, title: titulo, text: legendaShare(titulo) })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  for (const a of arqs) {
    baixarArquivo(a.name, a)
    await new Promise((ok) => setTimeout(ok, 350))
  }
}

async function desenharCard(card) {
  const W = 1080, H = 1350
  const fotosTopo = (await Promise.all((card.fotos || (card.foto ? [card.foto] : [])).slice(0, 2).map(carregarImagem))).filter(Boolean)
  const fotosLinha = await Promise.all((card.linhas || []).slice(0, 8).map((l) => carregarImagem(l.foto)))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  const fonte = (peso, tam) => `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const corta = (txt, max) => {
    let t = String(txt ?? '')
    if (g.measureText(t).width <= max) return t
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1)
    return t + '…'
  }
  const caixa = (x, y, w, h, r = 18, cor = '#ffffff') => {
    g.fillStyle = cor
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }
  const cor = card.cor || '#0b7a45'
  // topo
  g.fillStyle = '#f4f7f5'
  g.fillRect(0, 0, W, H)
  const grad = g.createLinearGradient(0, 0, W, 300)
  grad.addColorStop(0, '#006b2d')
  grad.addColorStop(0.5, '#009c3b')
  grad.addColorStop(1, '#0a5ea8')
  g.fillStyle = grad
  g.fillRect(0, 0, W, 300)
  g.fillStyle = '#ffdf00'
  g.fillRect(0, 300, W, 10)
  g.fillStyle = 'rgba(255,255,255,.85)'
  g.font = fonte(600, 30)
  g.fillText(corta(card.chapeu || 'APURAÇÃO 2026 · SANTA CATARINA', card.exclusivo ? W - 420 : W - 128 - ((card.fotos || card.foto) ? 220 : 0)), 64, 76)
  if (card.exclusivo) {
    g.font = fonte(800, 24)
    const t = 'ANÁLISE EXCLUSIVA'
    const w = g.measureText(t).width + 36
    caixa(W - 64 - w, 26, w, 40, 20, '#ffdf00')
    g.fillStyle = '#0b3d1f'
    g.fillText(t, W - 64 - w + 18, 54)
  }
  const reservaFoto = fotosTopo.length ? (fotosTopo.length > 1 ? 330 : 210) : 0
  g.fillStyle = '#fff'
  g.font = fonte(800, fotosTopo.length > 1 ? 40 : card.nome && card.nome.length > 22 ? 54 : 66)
  g.fillText(corta(card.nome, W - 128 - reservaFoto), 64, 160)
  g.font = fonte(500, 34)
  g.fillText(corta(card.sub, W - 128 - reservaFoto), 64, 222)
  fotosTopo.forEach((im, i) => fotoCirculo(g, im, W - 64 - 88 - i * 150, 176, 88, i ? '#ffdf00' : '#ffffff', 6))
  g.fillStyle = cor
  g.fillRect(64, 256, 120, 12)
  // título
  g.fillStyle = '#17201b'
  g.font = fonte(800, 44)
  g.fillText(corta(card.titulo, W - 128 - (card.pagina ? 150 : 0)), 64, 384)
  if (card.pagina) {
    g.font = fonte(800, 26)
    const t = card.pagina
    const w = g.measureText(t).width + 32
    caixa(W - 64 - w, 350, w, 44, 22, '#17201b')
    g.fillStyle = '#ffffff'
    g.fillText(t, W - 64 - w + 16, 381)
  }
  g.fillStyle = '#5f6b65'
  g.font = fonte(500, 30)
  g.fillText(corta(card.subtitulo, W - 128), 64, 430)
  let y = 456
  const FAIXA = 190
  const LIM = H - FAIXA - (card.rodape ? 76 : 44) - (card.total ? 92 : 0)
  // blocos de números
  const tiles = (card.tiles || []).slice(0, 6)
  if (tiles.length) {
    const tw = (W - 96 - 16) / 2, th = 122
    tiles.forEach((t, i) => {
      const x = 48 + (i % 2) * (tw + 16), yy = y + Math.floor(i / 2) * (th + 12)
      caixa(x, yy, tw, th)
      g.fillStyle = t.cor || cor
      g.fillRect(x, yy + 22, 8, th - 44)
      g.fillStyle = '#5f6b65'
      g.font = fonte(600, 26)
      g.fillText(corta(t.rot, tw - 60), x + 32, yy + 40)
      g.fillStyle = '#17201b'
      g.font = fonte(800, 46)
      g.fillText(corta(t.valor, tw - 60), x + 32, yy + 88)
      if (t.sub) {
        g.fillStyle = t.corSub || '#5f6b65'
        g.font = fonte(600, 21)
        g.fillText(corta(t.sub, tw - 60), x + 32, yy + 112)
      }
    })
    y += Math.ceil(tiles.length / 2) * (th + 12) + 2
  }
  // lista
  for (const [i, l] of (card.linhas || []).entries()) {
    if (l.par) {
      // bairro com 2022 e 2026 alinhados: nome + variação, e duas barras rotuladas
      const h = 92
      if (y + h > LIM) break
      caixa(48, y, W - 96, h)
      const x0 = 72
      g.textAlign = 'right'
      g.font = fonte(800, 24)
      g.fillStyle = l.corDir2 || '#5f6b65'
      const wv = l.dir2 ? g.measureText(l.dir2).width : 0
      if (l.dir2) g.fillText(l.dir2, W - 72, y + 30)
      g.textAlign = 'left'
      g.fillStyle = '#17201b'
      g.font = fonte(800, 28)
      const nm = corta(l.nome, W - x0 - 72 - wv - 24)
      g.fillText(nm, x0, y + 30)
      if (l.extra) {
        const wn = g.measureText(nm).width
        g.fillStyle = '#5f6b65'
        g.font = fonte(500, 20)
        const resto = W - x0 - 72 - wv - 40 - wn
        if (resto > 80) g.fillText(corta(l.extra, resto), x0 + wn + 14, y + 30)
      }
      const mx = l.par.max || 1
      // duas barras: 2022 × 2026 do mesmo candidato, ou dois candidatos (rotA/rotB) na comparação
      const duo = !!l.par.rotA
      const barrasPar = duo
        ? [[l.par.rotA, l.par.a, l.par.corA, 56, true], [l.par.rotB, l.par.b, l.par.corB, 80, true]]
        : [['2022', l.par.v22, '#a5aca8', 56, false], ['2026', l.par.v26, l.corBarra || cor, 80, true]]
      barrasPar.forEach(([rot, v, c, dy, forte]) => {
        g.fillStyle = forte ? '#17201b' : '#5f6b65'
        g.font = fonte(forte ? 800 : 600, duo ? 18 : 20)
        g.fillText(duo ? corta(rot, 176) : rot, x0, y + dy)
        const bx = x0 + (duo ? 186 : 70), bw = W - 72 - 120 - bx
        caixa(bx, y + dy - 14, bw, 14, 7, '#eef2f0')
        if (v > 0) caixa(bx, y + dy - 14, Math.max(8, (bw * v) / mx), 14, 7, c)
        g.textAlign = 'right'
        g.fillStyle = '#17201b'
        g.font = fonte(forte ? 800 : 500, forte ? 26 : 22)
        g.fillText(fmt.format(v), W - 72, y + dy + 2)
        g.textAlign = 'left'
      })
      y += h + 8
      continue
    }
    const temBarras = l.barras?.length
    const h = temBarras ? 92 : 74
    if (y + h > LIM) break
    caixa(48, y, W - 96, h)
    let xn = 72
    const fl = fotosLinha[i]
    if (l.ponto) {
      g.fillStyle = l.ponto
      g.beginPath()
      g.arc(86, y + 28, 13, 0, 2 * Math.PI)
      g.fill()
      xn = 116
    } else if (card.numerar !== false) {
      g.fillStyle = '#5f6b65'
      g.font = fonte(800, 30)
      g.fillText(`${i + 1}º`, 72, y + 36)
      xn = 132
    }
    if (fl) {
      fotoCirculo(g, fl, xn + 25, y + h / 2 - 2, 25, l.corBarra || cor, 3)
      xn += 64
    }
    g.fillStyle = '#17201b'
    g.font = fonte(700, 32)
    g.fillText(corta(l.nome, W - xn - 72 - 370), xn, y + 33)
    g.fillStyle = '#5f6b65'
    g.font = fonte(500, 24)
    g.fillText(corta(l.extra || '', W - xn - 72 - 370), xn, y + 60)
    g.textAlign = 'right'
    g.fillStyle = '#17201b'
    g.font = fonte(800, 36)
    g.fillText(corta(l.valor ?? '', 360), W - 72, y + 36)
    if (l.dir2) {
      g.font = fonte(600, 24)
      g.fillStyle = l.corDir2 || '#5f6b65'
      g.fillText(corta(l.dir2, 360), W - 72, y + 60)
    }
    g.textAlign = 'left'
    if (temBarras) {
      l.barras.forEach((b, k) => {
        g.fillStyle = '#e7ece9'
        g.fillRect(xn, y + 70 + k * 10, W - xn - 72, 6)
        g.fillStyle = b.cor
        g.fillRect(xn, y + 70 + k * 10, (W - xn - 72) * Math.max(0, Math.min(1, b.frac)), 6)
      })
    } else if (l.frac != null) {
      g.fillStyle = l.corBarra || cor
      g.globalAlpha = 0.9
      g.fillRect(xn, y + 66, (W - xn - 72) * Math.max(0, Math.min(1, l.frac)), 4)
      g.globalAlpha = 1
    }
    y += h + 8
  }
  // barras empilhadas
  if (card.legenda?.length) {
    g.font = fonte(600, 24)
    let x = 64
    for (const lg of card.legenda) {
      const w = g.measureText(lg.txt).width + 36
      if (x + w > W - 64) break
      g.fillStyle = lg.cor
      g.beginPath()
      g.arc(x + 10, y + 16, 10, 0, 2 * Math.PI)
      g.fill()
      g.fillStyle = '#17201b'
      g.fillText(lg.txt, x + 26, y + 25)
      x += w + 10
    }
    y += 46
  }
  for (const p of card.pilhas || []) {
    if (y + 64 > LIM) break
    caixa(48, y, W - 96, 64)
    g.fillStyle = '#17201b'
    g.font = fonte(700, 28)
    g.fillText(corta(p.nome, 600), 72, y + 28)
    g.fillStyle = '#5f6b65'
    g.font = fonte(500, 22)
    g.textAlign = 'right'
    g.fillText(corta(p.extra || '', 340), W - 72, y + 28)
    g.textAlign = 'left'
    let x = 72
    const larg = W - 144
    for (const s of p.segs) {
      const w = larg * s.frac
      if (w < 1) continue
      g.fillStyle = s.cor
      g.fillRect(x, y + 37, Math.max(1, w - 2), 20)
      if (w > 70 && s.txt) {
        g.fillStyle = '#fff'
        g.font = fonte(800, 20)
        g.textAlign = 'center'
        g.fillText(s.txt, x + w / 2, y + 53)
        g.textAlign = 'left'
      }
      x += w
    }
    y += 70
  }
  // total do que a imagem representa, logo depois da lista
  if (card.total) {
    const t = card.total
    const ty = Math.min(y + 4, LIM + 8)
    caixa(48, ty, W - 96, 80, 18, '#17201b')
    g.fillStyle = '#ffdf00'
    g.font = fonte(800, 22)
    // o rótulo da esquerda cede espaço ao número da direita
    g.font = fonte(800, 40)
    const livre = Math.min(540, W - 144 - g.measureText(t.valor).width - 36)
    g.font = fonte(800, 22)
    g.fillText(corta(t.quem ? `TOTAL DE ${t.quem.toUpperCase()}` : 'TOTAL', livre), 72, ty + 32)
    g.fillStyle = '#ffffff'
    g.font = fonte(600, 24)
    g.fillText(corta(t.rot, Math.min(450, livre)), 72, ty + 62)
    g.textAlign = 'right'
    g.font = fonte(800, 40)
    g.fillText(corta(t.valor, 440), W - 72, ty + 42)
    if (t.sub) {
      g.font = fonte(700, 20)
      g.fillStyle = t.corSub || '#cfd8d3'
      g.fillText(corta(t.sub, 470), W - 72, ty + 68)
    }
    g.textAlign = 'left'
  }
  // fonte e resumo, acima da faixa do criador
  g.textAlign = 'right'
  g.fillStyle = '#5f6b65'
  g.font = fonte(500, 22)
  g.fillText(corta(card.fonte || `Fonte: TSE · ${card.turno ? `boletins de urna · ${card.turno}º turno` : 'divulgação de resultados'}`, W - 128), W - 64, H - FAIXA - 18)
  g.textAlign = 'left'
  if (card.rodape) {
    g.fillStyle = '#17201b'
    g.font = fonte(600, 26)
    g.fillText(corta(card.rodape, W - 128), 64, H - FAIXA - 52)
  }
  // faixa do criador: foto grande, @ e Instagram
  const gf = g.createLinearGradient(0, H - FAIXA, W, H)
  gf.addColorStop(0, '#0b3d1f')
  gf.addColorStop(1, '#0a4a8a')
  g.fillStyle = gf
  g.fillRect(0, H - FAIXA, W, FAIXA)
  g.fillStyle = '#ffdf00'
  g.fillRect(0, H - FAIXA, W, 6)
  const foto = await new Promise((ok) => {
    const im = new Image()
    im.onload = () => ok(im)
    im.onerror = () => ok(null)
    im.src = `img/maicon-combat.jpg?v=${VERSAO}`
  })
  const cyF = H - FAIXA / 2 + 3
  let xT = 64
  if (foto) {
    fotoCirculo(g, foto, 64 + 62, cyF, 62, '#ffdf00', 7)
    xT = 64 + 124 + 30
  }
  g.fillStyle = '#ffffff'
  g.font = fonte(800, 52)
  g.fillText('@maiconcombat', xT, cyF - 6)
  // ícone do Instagram (contorno) + endereço
  const ix = xT, iy = cyF + 18, il = 34
  g.strokeStyle = '#ffdf00'
  g.lineWidth = 4
  g.beginPath()
  g.roundRect(ix, iy, il, il, 10)
  g.stroke()
  g.beginPath()
  g.arc(ix + il / 2, iy + il / 2, 8, 0, 2 * Math.PI)
  g.stroke()
  g.fillStyle = '#ffdf00'
  g.beginPath()
  g.arc(ix + il - 8, iy + 8, 2.6, 0, 2 * Math.PI)
  g.fill()
  g.font = fonte(700, 30)
  g.fillText('instagram.com/maiconcombat', ix + il + 14, iy + 28)
  g.textAlign = 'right'
  g.fillStyle = 'rgba(255,255,255,.75)'
  g.font = fonte(600, 22)
  g.fillText('maiconcombat.com.br', W - 64, cyF - 12)
  g.textAlign = 'left'
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'))
  return { blob, nome: `${nomeArquivo(card.nome || 'apuracao')}-${nomeArquivo(card.titulo || 'card')}.png` }
}

// faixa de total do card: votos do lugar e, se houver, 2022 com a variação
function totalCard(rot, v, v22 = null, sufixo = 'votos') {
  const va = v22 != null ? variacao(v, v22) : null
  const variacaoClara = { 'var-alta-forte': '#7fe0ab', 'var-alta': '#8cbcff', 'var-novo': '#8cbcff', 'var-queda': '#ffbe6b', 'var-queda-forte': '#ff9b91' }
  return { rot, valor: `${fmt.format(v)} ${sufixo}`, sub: v22 != null ? `2022: ${fmt.format(v22)}${va ? ` · ${va.txt}` : ''}` : '', corSub: va ? variacaoClara[va.cls] || null : null }
}

// linhas de bairros no formato da lista do card
const linhasBairroCard = (itens) => {
  const max = Math.max(1, ...itens.map((i) => Math.max(i.v, i.v22 ?? 0)))
  return itens.map((i) =>
    i.v22 != null && i.va !== null
      ? { nome: i.nome, extra: i.extra, par: { v22: i.v22, v26: i.v, max }, dir2: i.va?.txt || '', corDir2: i.va ? COR_VAR[i.va.cls] : null }
      : { nome: i.nome, extra: i.extra, valor: fmt.format(i.v), dir2: i.va ? i.va.txt : `${fmtPct.format(i.pct)}% do bairro`, corDir2: i.va ? COR_VAR[i.va.cls] : null, frac: i.v / max },
  )
}

// variação 2022 → 2026 num bairro: verde (alta forte), azul (alta), laranja (queda), vermelho (queda forte)
function variacao(v26, v22) {
  if (v22 == null) return null
  const dif = v26 - v22
  if (!v22) return v26 ? { cls: 'var-novo', txt: '▲ novo', dif } : null
  const r = dif / v22
  const pctTxt = `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtPct.format(Math.abs(100 * r))}%`
  const cls = !v26 || r <= -0.2 ? 'var-queda-forte' : r < 0 ? 'var-queda' : r >= 0.2 ? 'var-alta-forte' : r > 0 ? 'var-alta' : 'var-igual'
  // com poucos votos em 2022 o % engana (2 → 242 = +12.000%): mostra só a diferença
  return { cls, txt: `${dif > 0 ? '▲' : dif < 0 ? '▼' : '＝'} ${dif > 0 ? '+' : dif < 0 ? '−' : ''}${fmt.format(Math.abs(dif))}${v22 >= 20 ? ` (${pctTxt})` : ' votos'}`, dif }
}
// lista 2022 × 2026: cada bairro com duas linhas alinhadas (ano · barra · votos) e a variação no canto
// itens: { nome, sub, v, v22, meta, ir: 'data-…="…"' }
function listaComparada(itens, cor) {
  const max = Math.max(1, ...itens.map((i) => Math.max(i.v, i.v22 || 0)))
  const barra = (v) => `${Math.max(v ? 1.5 : 0, (100 * v) / max)}%`
  return `<div class="cmp-lista" role="list">${itens
    .map((i) => {
      const va = variacao(i.v, i.v22 || 0)
      return `<div class="cmp-linha ${i.ir ? 'clicavel' : ''}" role="listitem" ${i.ir || ''}>
        <div class="cmp-topo"><div class="cmp-nome"><strong>${esc(i.nome)}</strong>${i.sub ? ` <span class="mudo">· ${esc(i.sub)}</span>` : ''}</div>${va ? `<span class="var ${va.cls}">${va.txt}</span>` : ''}</div>
        <div class="cmp-ano"><span class="cmp-rot">2022</span><span class="cmp-trilho"><span class="vb22" style="width:${barra(i.v22 || 0)}"></span></span><span class="cmp-num">${fmt.format(i.v22 || 0)}</span></div>
        <div class="cmp-ano agora"><span class="cmp-rot">2026</span><span class="cmp-trilho"><span class="vb26" style="width:${barra(i.v)};background:${cor}"></span></span><span class="cmp-num"><strong>${fmt.format(i.v)}</strong></span></div>
        ${i.meta ? `<div class="cand-meta">${i.meta}</div>` : ''}
        ${i.extra || ''}
      </div>`
    })
    .join('')}</div>`
}

const legendaVar = (cor) => `<div class="var-legenda"><span class="var var-alta-forte">▲ +20% ou mais</span><span class="var var-alta">▲ subiu</span><span class="var var-queda">▼ caiu</span><span class="var var-queda-forte">▼ −20% ou mais</span></div>`

// lugar do cartão de bairros: um município (código TSE) ou uma região ('meso:…' / 'micro:…')
function lugarBairros(id) {
  if (!id) return null
  if (String(id).includes(':')) {
    const r = regiao(id)
    return r ? { id, nm: id === 'micro:42016' ? 'Grande Florianópolis' : id.startsWith('assoc:') ? id.slice(6) : r.nm.replace(/^Microrregião de /, 'Região de '), cds: r.membros.map((m) => m.cd) } : null
  }
  return { id, nm: NOME_MUN.get(id) || id, cds: [id] }
}
// escolha de município ou região, com os mesmos atalhos das outras telas
function escolhaLugarBairros(B) {
  const atual = B.mun?.id
  const chipM = (cd, nm) => `<button type="button" class="atalho ${atual === cd ? 'ativo' : ''}" data-bai-lugar="${esc(cd)}">${esc(nm)}</button>`
  const chipR = (id, nm) => `<button type="button" class="atalho regiao ${atual === id ? 'ativo' : ''}" data-bai-lugar="${esc(id)}">${esc(nm)}</button>`
  const topo = `<div class="bai-escolha">
      <button type="button" class="atalho regiao ${!B.mun ? 'ativo' : ''}" data-bai-sc>🗺️ SC inteira</button>
      ${B.mun ? `<span class="atalho ativo">📍 ${esc(B.mun.nm)}</span>` : ''}
      <button type="button" class="atalhos-toggle ${B.painel ? 'aberto' : ''}" data-bai-painel aria-expanded="${!!B.painel}">⚡ ${B.painel ? 'Fechar' : 'Escolher cidade ou região'} <span aria-hidden="true">${B.painel ? '▴' : '▾'}</span></button>
    </div>`
  if (!B.painel) return topo
  const termo = semAcento((B.busca || '').trim())
  const achados = termo ? MUNICIPIOS_SC.filter((m) => semAcento(m[2]).includes(termo)).slice(0, 12) : []
  const gf = GRANDE_FLORIPA.map((nm) => MUNICIPIOS_SC.find((m) => chaveNome(m[2]) === chaveNome(nm))).filter(Boolean)
  const gfSet = new Set(gf.map((m) => m[0]))
  const maiores = MUNICIPIOS_SC.filter((m) => !gfSet.has(m[0])).slice(0, 12)
  const microsDe = (meso) => Object.keys(MICRORREGIOES).filter((mi) => MUNICIPIOS_SC.some((m) => m[4] === meso && m[5] === mi))
  return `${topo}
    <div class="atalhos bai-atalhos">
      <input id="det-busca-bairro-mun" type="search" autocomplete="off" placeholder="🔎 Buscar município…" value="${esc(B.busca || '')}">
      ${termo ? `<div class="atalhos-chips">${achados.map((m) => chipM(m[0], m[2])).join('') || '<span class="nota">Nenhum município encontrado.</span>'}</div>` : ''}
      <div class="atalhos-grupo"><span class="atalhos-rot">🏝️ Grande Florianópolis</span>
        <div class="atalhos-chips">${gf.map((m) => chipM(m[0], m[2])).join('')}${chipR('micro:42016', 'Σ Região toda')}</div></div>
      <div class="atalhos-grupo"><span class="atalhos-rot">🏙️ Maiores cidades</span>
        <div class="atalhos-chips">${maiores.map((m) => chipM(m[0], m[2])).join('')}</div></div>
      <div class="atalhos-grupo"><span class="atalhos-rot">🤝 Associações de municípios <small>(FECAM)</small></span>
        <div class="atalhos-chips">${Object.keys(ASSOCIACOES).map((sg) => chipR('assoc:' + sg, sg)).join('')}</div></div>
      <div class="atalhos-grupo"><span class="atalhos-rot">🗺️ Regiões <small>(soma dos bairros · IBGE)</small></span>
        <div class="atalhos-chips">${Object.entries(MESORREGIOES).map(([cod, nome]) => chipR('meso:' + cod, nome)).join('')}</div>
        <details class="micros"><summary>Microrregiões (20) ▾</summary>
          ${Object.entries(MESORREGIOES).map(([cod, nome]) => `<div class="micro-grupo"><span>${esc(nome)}</span>${microsDe(cod).map((mi) => chipR('micro:' + mi, MICRORREGIOES[mi])).join('')}</div>`).join('')}
        </details></div>
    </div>`
}

// cartão da ficha: bairros onde o candidato foi mais votado (2026) e, se ligado, a variação desde 2022
function secaoBairros(det, c, aba) {
  if (DEMO || !aba?.cargo) return ''
  const elId = eleicaoDoCargo(aba.cargo)
  const B = (det.bai ??= { mun: det.mun ? lugarBairros(det.mun.regiao || det.mun.cd) : null, modo: 'v', todos: false, painel: false, busca: '', grupo: 'bairro' })
  const re = () => estado.detalhe === det && renderDetalhe()
  const nr = Number(c.numero)
  const cor = corPartido(c.partido)
  const parts22 = PREF.mostrar2022 && H22.resumo ? achar2022(c).filter((p) => p.el.turno === 1) : []
  const p22 = parts22.find((p) => p.el.cargo === aba.cargo) || parts22[0] || null
  // níveis: em SC, municípios ou bairros; num município ou região, zonas, bairros, locais ou seções
  const niveis = B.mun ? [['zona', 'Zonas'], ['bairro', 'Bairros'], ['local', 'Locais'], ['secao', 'Seções']] : [['mun', 'Municípios'], ['assoc', 'Associações'], ['bairro', 'Bairros']]
  if (!niveis.some(([k]) => k === B.grupo)) B.grupo = 'bairro'
  const nomeNivel = Object.fromEntries(niveis)[B.grupo]
  const naNivel = { mun: 'no município', assoc: 'na associação', zona: 'na zona', bairro: 'no bairro', local: 'no local', secao: 'na seção' }[B.grupo]
  const r = dadosBairrosFicha(B, elId, aba, nr, p22, re)
  const tem22 = !!r.com22
  if (!tem22 && (B.modo === 'up' || B.modo === 'dn')) B.modo = 'v'
  const modos = [['v', 'Mais votos'], ['p', 'Maior %'], ...(tem22 ? [['up', '▲ Mais cresceu'], ['dn', '▼ Mais caiu']] : [])]
  const lugar = B.mun ? B.mun.nm : 'Santa Catarina'
  const controles = `${escolhaLugarBairros(B)}
    <div class="segmentado" role="group" aria-label="Ver por">${niveis.map(([k, rot]) => `<button type="button" data-bai-grupo="${k}" aria-pressed="${B.grupo === k}">${rot}</button>`).join('')}</div>
    <div class="segmentado" role="group" aria-label="Ordem">${modos.map(([k, rot]) => `<button type="button" data-bai-modo="${k}" aria-pressed="${B.modo === k}">${rot}</button>`).join('')}</div>`
  let corpo = ''
  B.export = null
  if (r.msg) corpo = `<p class="nota">${r.msg}</p>`
  else {
    const ls = r.linhas
    const ord = { v: (a, b) => b.v - a.v, p: (a, b) => pctDe(b.v, b.val) - pctDe(a.v, a.val), up: (a, b) => b.v - b.v22 - (a.v - a.v22), dn: (a, b) => a.v - a.v22 - (b.v - b.v22) }
    ls.sort(ord[B.modo] || ord.v)
    const minVal = B.modo === 'p' && B.grupo !== 'secao' ? (B.grupo === 'mun' || B.grupo === 'assoc' ? 1000 : 300) : 0
    const vis = B.modo === 'up' ? ls.filter((l) => l.v > l.v22) : B.modo === 'dn' ? ls.filter((l) => l.v < l.v22) : ls.filter((l) => l.v > 0 && l.val >= minVal)
    const lim = B.todos ? vis.length : 15
    // bairros de uma zona (sublista)
    const blocoZona = (l) => {
      if (!l.zonaKey) return ''
      const aberta = !!l.filhos
      const bt = `<button type="button" class="link-zonas zona-bairros-bt" data-bai-zona="${esc(l.zonaKey)}" aria-expanded="${aberta}">🏘️ ${aberta ? 'Esconder os bairros desta zona' : 'Ver os bairros desta zona'} <span class="seta" aria-hidden="true">${aberta ? '▴' : '▾'}</span></button>`
      if (!aberta) return bt
      const fs = l.filhos.filter((f) => f.v > 0 || (tem22 && f.v22 > 0))
      const metaF = (f) => [f.pos ? `${f.pos.p === 1 ? '🏆 ' : ''}${f.pos.p}º de ${f.pos.n} no bairro` : '', `${fmtPct.format(pctDe(f.v, f.val))}% dos votos do bairro`].filter(Boolean).join(' · ')
      return `${bt}<div class="zona-bairros">${fs.length
        ? tem22
          ? listaComparada(fs.map((f) => ({ nome: f.nome, v: f.v, v22: f.v22, meta: metaF(f), ir: f.ir })), cor)
          : `<div class="cmp-lista">${fs.map((f) => `<div class="cmp-linha clicavel" ${f.ir}><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(f.nome)}</strong></div><strong class="cmp-total">${fmt.format(f.v)}</strong></div><div class="cand-meta">${metaF(f)}</div></div>`).join('')}</div>`
        : '<p class="nota">Sem votos nos bairros desta zona.</p>'}</div>`
    }
    const metaDe = (l) => [l.pos ? `${l.pos.p === 1 ? '🏆 ' : ''}${l.pos.p}º de ${l.pos.n} ${naNivel}` : '', `${fmtPct.format(pctDe(l.v, l.val))}% dos votos ${B.grupo === 'mun' ? 'do município' : B.grupo === 'assoc' ? 'da associação' : B.grupo === 'secao' ? 'da seção' : B.grupo === 'local' ? 'do local' : B.grupo === 'zona' ? 'da zona' : 'do bairro'}`].filter(Boolean).join(' · ')
    // o resumo conta todos os lugares (no índice de SC, vem pronto do estado inteiro)
    const [sobe, cai] = r.sobeCai || [ls.filter((l) => l.v > l.v22).length, ls.filter((l) => l.v < l.v22).length]
    const rotOrdem = { v: 'mais votos', p: 'maior %', up: 'onde mais cresceu desde 2022', dn: 'onde mais caiu desde 2022' }[B.modo]
    const lista = vis.slice(0, lim)
    corpo = (r.aviso ? `<p class="nota">${r.aviso}</p>` : '') +
      (B.grupo === 'zona' && lista.length ? `<button type="button" class="link-zonas" data-bai-zonas-todas aria-expanded="${!!B.zonasTodas}">🏘️ ${B.zonasTodas ? 'Fechar os bairros de todas as zonas' : 'Ver os bairros de todas as zonas'} <span class="seta" aria-hidden="true">${B.zonasTodas ? '▴' : '▾'}</span></button>` : '') +
      (tem22 ? `<p class="var-resumo">Desde 2022 (${esc(ROTULO_ELEICAO[p22?.el.id || r.e22] || '')}): <span class="var var-alta-forte">▲ cresceu em ${fmt.format(sobe)} ${esc(nomeNivel.toLowerCase())}</span> <span class="var var-queda-forte">▼ caiu em ${fmt.format(cai)}</span></p>` + legendaVar(cor) : '') +
      (!lista.length
        ? `<p class="nota">${B.modo === 'up' ? 'Não cresceu em nenhum lugar' : B.modo === 'dn' ? 'Não caiu em nenhum lugar' : 'Sem votos'} em ${esc(lugar)}.</p>`
        : tem22
          ? listaComparada(lista.map((l) => ({ nome: l.nome, sub: l.sub, v: l.v, v22: l.v22, meta: metaDe(l), ir: l.ir, extra: blocoZona(l) })), cor)
          : `<div class="cmp-lista">${lista.map((l) => `<div class="cmp-linha ${l.ir ? 'clicavel' : ''}" ${l.ir || ''}><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(l.nome)}</strong>${l.sub ? ` <span class="mudo">· ${esc(l.sub)}</span>` : ''}</div><strong class="cmp-total">${fmt.format(l.v)}</strong></div><div class="cand-meta">${metaDe(l)}</div>${blocoZona(l)}</div>`).join('')}</div>`) +
      (vis.length > lim ? `<button type="button" class="botao secundario" data-bai-todos>Mostrar todos (${fmt.format(vis.length)})</button>` : '') +
      `<p class="nota">${r.nota || ''}</p>`
    // no modo Zonas, a pessoa escolhe quais zonas entram no compartilhamento
    B.zonasFora ??= new Set()
    const naComp = (l) => !(B.grupo === 'zona' && l.zonaKey && B.zonasFora.has(l.zonaKey))
    const visComp = vis.filter(naComp)
    const tit = `${nomeNivel} · ${lugar}`
    // total que a imagem representa: em SC, o total do candidato; num lugar, a soma das linhas (zonas escolhidas)
    const baseTot = B.grupo === 'zona' ? visComp : ls
    const tv = B.mun ? baseTot.reduce((a, l) => a + l.v, 0) : r.totalSC
    const tv22 = !tem22 ? null : B.mun ? baseTot.reduce((a, l) => a + l.v22, 0) : p22 ? p22.c.votos : null
    const parcialZonas = B.grupo === 'zona' && visComp.length < vis.length
    const somaDe = B.mun ? (parcialZonas ? 'soma das zonas escolhidas' : `soma ${{ zona: 'das zonas', bairro: 'dos bairros', local: 'dos locais', secao: 'das seções' }[B.grupo]} de ${lugar}`) : 'em todo o estado'
    const totalFicha = tv == null ? null : { ...totalCard(B.mun ? somaDe[0].toUpperCase() + somaDe.slice(1) : 'Santa Catarina inteira', tv, tv22), quem: c.nome }
    // carrossel: capa + todas as linhas (na visão por zona, os bairros de cada zona), 6 por imagem
    const POR = 6
    const linhaCar = (x, max) => ({ nome: x.nome, extra: [x.sub, x.pos ? `${x.pos.p}º de ${x.pos.n}` : ''].filter(Boolean).join(' · '), corBarra: cor,
      ...(tem22 ? { par: { v22: x.v22, v26: x.v, max }, dir2: variacao(x.v, x.v22)?.txt || '', corDir2: COR_VAR[variacao(x.v, x.v22)?.cls] } : { valor: fmt.format(x.v), dir2: `${fmtPct.format(pctDe(x.v, x.val))}%`, frac: x.v / max }) })
    const baseCar = { turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ SC$/, '')}` }
    const montarCarrossel = () => {
      let grupos
      if (B.grupo === 'zona') {
        const rz = dadosBairrosFicha({ ...B, zonasTodas: true }, elId, aba, nr, p22, () => {})
        grupos = (rz.linhas || []).filter(naComp).sort((a, b) => b.v - a.v).map((z) => ({ titulo: z.nome, sub: z.sub, z, itens: (z.filhos || []).filter((f) => f.v > 0 || (tem22 && f.v22 > 0)) }))
      } else grupos = [{ titulo: tit, itens: visComp }]
      const total26 = ls.reduce((a, l) => a + l.v, 0), total22 = ls.reduce((a, l) => a + l.v22, 0)
      const vaT = tem22 ? variacao(total26, total22) : null
      const capa = { ...baseCar, total: totalFicha, titulo: `${B.grupo === 'zona' ? 'Zonas e bairros' : nomeNivel} · ${lugar}`, subtitulo: tem22 ? `2022 × 2026 · ${grupos.reduce((a, g) => a + g.itens.length, 0)} ${B.grupo === 'zona' ? 'bairros' : nomeNivel.toLowerCase()}` : rotOrdem,
        tiles: [{ rot: `Votos em ${lugar}`, valor: fmt.format(total26), sub: tem22 ? `2022: ${fmt.format(total22)} · ${vaT?.txt || ''}` : '', corSub: vaT ? COR_VAR[vaT.cls] : null },
          ...(B.grupo === 'zona' ? grupos.slice(0, 5).map((g) => { const va = tem22 ? variacao(g.z.v, g.z.v22) : null; return { rot: g.titulo, valor: fmt.format(g.z.v), sub: [g.z.pos ? `${g.z.pos.p}º na zona` : '', va?.txt].filter(Boolean).join(' · '), corSub: va ? COR_VAR[va.cls] : null } }) : [])],
        linhas: B.grupo === 'zona' ? [] : vis.slice(0, 3).map((x) => linhaCar(x, Math.max(1, ...vis.slice(0, 3).map((y) => Math.max(y.v, y.v22 || 0))))),
        rodape: tem22 ? `Desde 2022: cresceu em ${fmt.format(sobe)} e caiu em ${fmt.format(cai)} ${nomeNivel.toLowerCase()}` : '' }
      const paginas = [capa]
      for (const g of grupos) {
        const max = Math.max(1, ...g.itens.map((x) => Math.max(x.v, tem22 ? x.v22 : 0)))
        const nPag = Math.max(1, Math.ceil(g.itens.length / POR))
        for (let k = 0; k < nPag && paginas.length < 20; k++) {
          paginas.push({ ...baseCar, total: g.z ? totalCard(`Total na ${g.titulo.replace(/ · .*/, '')}`, g.z.v, tem22 ? g.z.v22 : null) : totalFicha, titulo: g.titulo, subtitulo: `${B.grupo === 'zona' ? 'Bairros da zona' : rotOrdem}${nPag > 1 ? ` · parte ${k + 1} de ${nPag}` : ''}${tem22 ? ' · 2022 × 2026' : ''}`, numerar: false,
            linhas: g.itens.slice(k * POR, (k + 1) * POR).map((x) => linhaCar(x, max)) })
        }
      }
      return paginas
    }
    B.carrossel = montarCarrossel
    B.export = {
      csv: { nome: `${nomeArquivo(c.nome)}-${nomeArquivo(nomeNivel)}-${nomeArquivo(lugar)}.csv`, cab: [nomeNivel.replace(/s$/, '').replace('Municípi', 'Município').replace('Seçõe', 'Seção').replace('Locai', 'Local'), 'Onde', 'Votos 2026', '% do lugar', 'Posição', ...(tem22 ? ['Votos 2022', 'Diferença'] : [])],
        linhas: visComp.flatMap((l) => [[l.nome, l.sub || '', l.v, pctDe(l.v, l.val), l.pos ? `${l.pos.p}º de ${l.pos.n}` : '', ...(tem22 ? [l.v22, l.v - l.v22] : [])],
          ...(l.filhos || []).map((f) => [`${l.nome} › ${f.nome}`, l.sub || '', f.v, pctDe(f.v, f.val), f.pos ? `${f.pos.p}º de ${f.pos.n}` : '', ...(tem22 ? [f.v22, f.v - f.v22] : [])])]) },
      card: { turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ SC$/, '')}`, titulo: tit, subtitulo: rotOrdem, total: totalFicha,
        linhas: linhasBairroCard(visComp.map((l) => ({ nome: l.nome, v: l.v, pct: pctDe(l.v, l.val), v22: tem22 ? l.v22 : null, va: tem22 ? variacao(l.v, l.v22) : null, extra: [l.sub, l.pos ? `${l.pos.p}º de ${l.pos.n}` : ''].filter(Boolean).join(' · ') }))),
        rodape: tem22 ? `Desde 2022: cresceu em ${fmt.format(sobe)} e caiu em ${fmt.format(cai)} ${nomeNivel.toLowerCase()}` : '' },
      paginas: Math.min(20, 1 + Math.ceil(visComp.length / POR)),
      legenda: legendaShare(`${c.nome} · ${tit}`),
      zonas: B.grupo === 'zona' ? vis.filter((l) => l.zonaKey).map((l) => ({ k: l.zonaKey, nome: l.nome.replace(/ · .*/, ''), dentro: !B.zonasFora.has(l.zonaKey) })) : null,
    }
  }
  return `<section class="cartao bai"><h3>🏘️ Onde foi mais votado</h3>${controles}${corpo}
    ${B.export?.zonas?.length > 1 ? `<div class="zonas-comp"><span class="atalhos-rot">📤 Zonas no compartilhamento</span><div class="atalhos-chips">${B.export.zonas
      .map((z) => `<button type="button" class="atalho ${z.dentro ? 'ativo' : ''}" data-bai-zona-comp="${esc(z.k)}" aria-pressed="${z.dentro}">${z.dentro ? '✓ ' : ''}${esc(z.nome)}</button>`)
      .join('')}</div>${B.export.zonas.every((z) => !z.dentro) ? '<p class="nota">Marque ao menos uma zona.</p>' : ''}</div>` : ''}
    ${B.export ? `<div class="exportar">${botaoCard('ficha-bairros', B.export.card)}<button type="button" class="botao" data-bai-carrossel>🎞️ ${B.grupo === 'zona' ? 'Carrossel: zonas e todos os bairros' : `Carrossel com todos (${B.export.paginas} imagens)`}</button><button type="button" class="botao secundario" data-bai-csv>⬇️ Planilha (CSV)</button><button type="button" class="botao secundario" data-bai-legenda>📋 Copiar legenda com o link do Instagram</button></div>` : ''}
    <button type="button" class="botao secundario pro-atalho" data-pro-abrir>🔒 Mapa, perfil do eleitor e abstenção</button>
    <p class="nota">Fonte: boletins de urna do ${turnoDe(elId)}º turno (TSE) e cadastro de locais de votação. 2022 ligado pelo nome completo do candidato. Toque numa linha para abrir na aba Bairros.</p></section>`
}

// linhas do cartão "Onde foi mais votado" para o nível escolhido: { linhas: [{ nome, sub, v, val, v22, pos, ir }], com22, nota, aviso } ou { msg }
function dadosBairrosFicha(B, elId, aba, nr, p22, re) {
  const cargo = aba.cargo
  const nr22 = p22 ? Number(p22.c.numero) : null
  // SC inteira, por bairro: índice pronto (só os destaques de cada ordem)
  if (!B.mun && B.grupo === 'bairro') {
    const idx = arquivoAno(`dados2026/bairros-${elId}.json`, re)
    if (!idx.valor) return { msg: idx.erro ? 'Os bairros de 2026 ainda não estão no app.' : 'Carregando os bairros…' }
    const x = idx.valor.c[nr]
    if (!x) return { msg: 'Sem votos nos boletins de urna de SC.' }
    const com22 = PREF.mostrar2022 && !!x.e22
    const lista = x[B.modo] || x.v
    // total do candidato em SC: soma do arquivo por município (a lista de bairros é só um recorte)
    const Mt = arquivoAno(`dados2026/municipios-${elId}.json`, re)
    return {
      totalSC: Mt.valor ? Object.values(Mt.valor.c[nr] || {}).reduce((a, v) => a + v, 0) : null,
      com22,
      e22: x.e22,
      sobeCai: x.s,
      linhas: lista.map(([bi, v, v22]) => { const [cd, nome, val] = idx.valor.b[bi]; return { nome, sub: NOME_MUN.get(cd) || cd, v, val, v22: v22 || 0, ir: `data-bai-ir="${esc(cd)}" data-bai-bairro="${esc(nome)}"` } }),
      nota: `Teve votos em ${fmt.format(x.n)} bairros de SC; a lista mostra os ${lista.length} principais desta ordem. Escolha uma cidade para ver todos os bairros dela.`,
    }
  }
  // SC inteira, por município
  if (!B.mun) {
    const M = arquivoAno(`dados2026/municipios-${elId}.json`, re)
    if (!M.valor) return { msg: M.erro ? 'Os votos por município ainda não estão no app.' : 'Carregando os municípios…' }
    const meus = M.valor.c[nr] || {}
    let v22de = null
    if (p22) {
      const m22 = mun2022(p22.el.id)
      if (!m22.valor) m22.then(re).catch(() => {})
      else v22de = m22.valor.cand[p22.c.sq] || {}
    }
    if (B.grupo === 'assoc') {
      // soma dos municípios de cada associação (FECAM); posição contra a soma de cada candidato
      if (!M.valor._assoc) {
        const val = {}, cand = {}
        for (const [cd, v] of Object.entries(M.valor.validos)) { const sg = ASSOCIACAO_MUN[cd]; if (sg) val[sg] = (val[sg] || 0) + v }
        for (const [n, por] of Object.entries(M.valor.c)) {
          const t = cand[n] = {}
          for (const [cd, v] of Object.entries(por)) { const sg = ASSOCIACAO_MUN[cd]; if (sg) t[sg] = (t[sg] || 0) + v }
        }
        M.valor._assoc = { val, cand }
      }
      const A = M.valor._assoc
      const meusA = A.cand[nr] || {}
      const a22 = {}
      if (v22de) for (const [cd, v] of Object.entries(v22de)) { const sg = ASSOCIACAO_MUN[cd]; if (sg) a22[sg] = (a22[sg] || 0) + v }
      const linhas = Object.keys(ASSOCIACOES).map((sg) => {
        const v = meusA[sg] || 0
        let p = 1, n = 0
        for (const outro of Object.values(A.cand)) {
          const x = outro[sg] || 0
          if (x > 0) n++
          if (x > v) p++
        }
        return { nome: sg, sub: ASSOCIACOES[sg], v, val: A.val[sg] || 0, v22: a22[sg] || 0, pos: v ? { p, n } : null, ir: `data-bai-lugar="assoc:${esc(sg)}"` }
      }).filter((l) => l.v || l.v22)
      return { totalSC: Object.values(meusA).reduce((a, v) => a + v, 0), com22: !!v22de, linhas, aviso: p22 && !v22de && PREF.mostrar2022 ? 'Carregando 2022…' : '', nota: `Associações de municípios da FECAM (soma dos municípios de cada uma). Votou em ${fmt.format(linhas.filter((l) => l.v).length)} de ${Object.keys(ASSOCIACOES).length}. Toque numa associação para ver as zonas e bairros dela.` }
    }
    const cds = new Set([...Object.keys(meus), ...(v22de ? Object.keys(v22de) : [])])
    const linhas = [...cds].map((cd) => {
      const v = meus[cd] || 0
      let p = 1, n = 0
      for (const outro of Object.values(M.valor.c)) {
        const x = outro[cd] || 0
        if (x > 0) n++
        if (x > v) p++
      }
      return { nome: NOME_MUN.get(cd) || cd, sub: '', v, val: M.valor.validos[cd] || 0, v22: v22de ? v22de[cd] || 0 : 0, pos: v ? { p, n } : null, ir: `data-bai-lugar="${esc(cd)}"` }
    })
    return { totalSC: Object.values(meus).reduce((a, v) => a + v, 0), com22: !!v22de, linhas, aviso: p22 && !v22de && PREF.mostrar2022 ? 'Carregando 2022…' : '', nota: `Votou em ${fmt.format(linhas.filter((l) => l.v).length)} de ${MUNICIPIOS_SC.length} municípios. Toque num município para ver os bairros dele.` }
  }
  // município ou região: zonas, bairros, locais ou seções (arquivos de seções de cada cidade)
  const cds = B.mun.cds
  const regiao = cds.length > 1
  const arqs = cds.map((cd) => [cd, secoesAno(2026, cd, re)])
  const prontos = arqs.filter(([, a]) => a)
  const faltam = arqs.filter(([cd, a]) => !a && !erroSecoes(2026, cd)).length
  if (!prontos.length) return { msg: faltam ? `Carregando as seções de ${esc(B.mun.nm)}…` : 'Os boletins deste lugar ainda não estão no app.' }
  // 2022 só por zona e bairro (os códigos de locais e seções mudam entre eleições) e só com todos os arquivos
  const usa22 = !!p22 && (B.grupo === 'zona' || B.grupo === 'bairro')
  const faltam22 = usa22 ? cds.filter((cd) => !secoesAno(2022, cd, re) && !erroSecoes(2022, cd)).length : 0
  const com22 = usa22 && !faltam22
  const linhas = []
  for (const [cd, arq] of prontos) {
    const ag = agregarSecoes(arq, { id: elId, cargo, anul: new Set() }, {}, B.grupo, nr)
    let m22 = null
    if (com22) {
      const a22 = secoesAno(2022, cd, re)
      if (a22) m22 = new Map(agregarSecoes(a22, { id: p22.el.id, cargo: p22.el.cargo, anul: new Set() }, {}, B.grupo, nr22).grupos.map((g) => [g.chave, g.foco]))
    }
    const nmMun = NOME_MUN.get(cd) || cd
    const vistos = new Set()
    const add = (k, g) => {
      vistos.add(k)
      const v = g?.foco || 0
      let nome = k, sub = regiao ? nmMun : '', ir = ''
      if (B.grupo === 'zona') {
        nome = `${Number(k)}ª zona${cd === FLORIPA_CD && ROTULO_ZONA[z4(k)] ? ` · ${ROTULO_ZONA[z4(k)]}` : ''}`
        ir = `data-bai-ir="${esc(cd)}" data-bai-tipo="zona" data-bai-chave="${esc(k)}"`
      } else if (B.grupo === 'bairro') ir = `data-bai-ir="${esc(cd)}" data-bai-bairro="${esc(k)}"`
      else if (B.grupo === 'local') {
        nome = tituloLocal((arq.locais[k] || [k])[0])
        sub = [bairroDoLocal(arq, k), regiao ? nmMun : ''].filter(Boolean).join(' · ')
        ir = `data-bai-ir="${esc(cd)}" data-bai-tipo="local" data-bai-chave="${esc(k)}"`
      } else {
        const [z, sec] = k.split('-')
        nome = `Seção ${sec}`
        sub = [tituloLocal((arq.locais[arq.secoes[k]] || [''])[0]), `${Number(z)}ª zona`, regiao ? nmMun : ''].filter(Boolean).join(' · ')
        ir = `data-bai-ir="${esc(cd)}" data-bai-tipo="secao" data-bai-chave="${esc(k)}"`
      }
      const linha = { nome, sub, v, val: g?.validos || 0, v22: m22?.get(k) || 0, pos: g && v ? posicaoNoGrupo(g, nr) : null, ir }
      if (B.grupo === 'zona') {
        // bairros da zona (abre e fecha), com 2022 da mesma zona
        linha.zonaKey = `${cd}|${k}`
        if (B.zonas?.has(linha.zonaKey) || B.zonasTodas) {
          const gb = agregarSecoes(arq, { id: elId, cargo, anul: new Set() }, { zona: k }, 'bairro', nr)
          let b22 = null
          if (com22) {
            const a22 = secoesAno(2022, cd, re)
            if (a22) b22 = new Map(agregarSecoes(a22, { id: p22.el.id, cargo: p22.el.cargo, anul: new Set() }, { zona: k }, 'bairro', nr22).grupos.map((x) => [x.chave, x.foco]))
          }
          const ks = new Set(gb.grupos.filter((x) => x.foco > 0).map((x) => x.chave))
          if (b22) for (const [kb, v22] of b22) if (v22 > 0) ks.add(kb)
          const porChave = new Map(gb.grupos.map((x) => [x.chave, x]))
          linha.filhos = [...ks].map((kb) => {
            const x = porChave.get(kb)
            return { nome: kb, v: x?.foco || 0, val: x?.validos || 0, v22: b22?.get(kb) || 0, pos: x?.foco ? posicaoNoGrupo(x, nr) : null, ir: `data-bai-ir="${esc(cd)}" data-bai-bairro="${esc(kb)}"` }
          }).sort((a, b) => b.v - a.v || b.v22 - a.v22)
        }
      }
      linhas.push(linha)
    }
    for (const g of ag.grupos) if (g.foco > 0 || m22?.get(g.chave)) add(g.chave, g)
    if (m22) for (const [k, v22] of m22) if (v22 > 0 && !vistos.has(k)) add(k, null)
  }
  const total = linhas.reduce((a, l) => a + l.v, 0)
  return {
    com22, linhas,
    aviso: faltam ? `Carregando ${faltam} de ${cds.length} municípios…` : faltam22 ? `Carregando os dados de 2022 (${cds.length - faltam22} de ${cds.length})…` : '',
    nota: `Total em ${esc(B.mun.nm)}: <strong>${fmt.format(total)}</strong> votos${com22 ? ` (2022: ${fmt.format(linhas.reduce((a, l) => a + l.v22, 0))})` : ''}${regiao ? ` · ${prontos.length} municípios` : ''}.${p22 && !usa22 ? ' A comparação com 2022 aparece por zona e por bairro (locais e seções mudam de número entre as eleições).' : ''}`,
  }
}

/* ---------------- 🔒 Análises (área protegida) ---------------- */

// Os dados desta área ficam em pro/*.bin, criptografados (AES-256-GCM, comprimidos com gzip).
// A chave dos dados só é obtida com usuário e senha: pro/usuarios.json guarda, para cada usuário,
// a chave embrulhada com outra derivada da senha (PBKDF2-SHA256). Nenhuma senha fica no código.
const PRO = { chave: null, aba: 'mapa', sel: 't1-c7', cand: null, mun: null, camada: 'votos', busca: '', ordem: 'abst', cargoAbst: 't1-c3', erro: '', entrando: false, mapa: null }
const ARQ_PRO = new Map()
const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const bytesB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
async function sha256hex(t) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function importarChave(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
}
async function entrarPro(usuario, senha, lembrar) {
  const u = await fetch(`pro/usuarios.json?v=${VERSAO}`).then((r) => r.json())
  const reg = u.u[await sha256hex('usuario:' + usuario.trim().toLowerCase())]
  if (!reg) throw new Error('login')
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey'])
  const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64bytes(reg.s), iterations: u.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const w = b64bytes(reg.w)
  let raw
  try {
    raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.slice(0, 12) }, kek, w.slice(12))
  } catch {
    throw new Error('login')
  }
  PRO.chave = await importarChave(raw)
  const guarda = lembrar ? localStorage : sessionStorage
  try {
    guarda.setItem('pro:chave', bytesB64(raw))
  } catch {}
}
function sairPro() {
  PRO.chave = null
  ARQ_PRO.clear()
  for (const s of [localStorage, sessionStorage]) try { s.removeItem('pro:chave') } catch {}
  renderizar()
}
async function restaurarPro() {
  let s = null
  for (const g of [localStorage, sessionStorage]) try { s ||= g.getItem('pro:chave') } catch {}
  if (s) PRO.chave = await importarChave(b64bytes(s)).catch(() => null)
}
const proPronto = restaurarPro()
// lê e decifra pro/<nome>.bin
function arquivoPro(nome) {
  if (!ARQ_PRO.has(nome)) {
    const p = (async () => {
      const b = new Uint8Array(await fetch(`pro/${nome}.bin?v=${VERSAO}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP')))))
      const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, PRO.chave, b.slice(12))
      const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      return JSON.parse(txt)
    })()
    p.then((j) => ((p.valor = j), estado.aba.tipo === 'pro' && renderizar())).catch(() => ((p.erro = true), estado.aba.tipo === 'pro' && renderizar()))
    ARQ_PRO.set(nome, p)
  }
  return ARQ_PRO.get(nome)
}

// candidatos de uma eleição de 2026 ('t<turno>-c<cargo>') para nomes e cores
async function garantirEleicao26(id, signal) {
  if (B26.els.has(id)) return B26.els.get(id)
  const cargo = Number(id.split('-c')[1])
  const d = await buscar(ABAS.find((a) => a.cargo === cargo), UF, turnoDe(id), signal)
  const el = eleicao26(d, cargo, turnoDe(id))
  B26.els.set(id, el)
  return el
}

async function carregarPro(ctrl) {
  await Promise.all([proPronto, indice26Pronto])
  estado.dados = { pro: true }
  if (PRO.chave) {
    const cargo = Number(PRO.sel.split('-c')[1])
    if (!B26.els.has(PRO.sel)) {
      try {
        const d = await buscar(ABAS.find((a) => a.cargo === cargo), UF, turnoDe(PRO.sel), ctrl.signal)
        if (ctrl.signal.aborted) return
        B26.els.set(PRO.sel, eleicao26(d, cargo, turnoDe(PRO.sel)))
      } catch {
        if (ctrl.signal.aborted) return
      }
    }
    const el = B26.els.get(PRO.sel)
    if (el) {
      el.porNumero ??= new Map(el.candidatos.map((c) => [String(c.numero), c]))
      if (!el.porNumero.has(String(PRO.cand))) PRO.cand = Number(el.candidatos.find((c) => c.valido)?.numero)
    }
    if (H22.resumo == null && PREF.mostrar2022) resumo2022().then(() => renderizar()).catch(() => {})
  }
  renderizar()
  statusEl.textContent = PRO.chave ? 'Análises · área protegida' : 'Área protegida'
  statusEl.className = 'status ok'
}

function renderLoginPro() {
  return `<section class="cartao pro-login">
    <h2>🔒 Análises</h2>
    <p>Mapa de votos, perfil do eleitor e abstenção por bairro. Área restrita: entre com seu usuário e senha.</p>
    <form id="pro-form" autocomplete="on">
      <label>Usuário<input name="usuario" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <label class="pro-lembrar"><input type="checkbox" name="lembrar" checked> Manter conectado neste aparelho</label>
      ${PRO.erro ? `<p class="pro-erro" role="alert">${esc(PRO.erro)}</p>` : ''}
      <button class="botao" type="submit" ${PRO.entrando ? 'disabled' : ''}>${PRO.entrando ? 'Entrando…' : 'Entrar'}</button>
    </form>
    <p class="nota">Os dados desta área são criptografados e só podem ser lidos com usuário e senha válidos.</p>
  </section>`
}

const COR_VAR = { 'var-alta-forte': '#0b7a45', 'var-alta': '#1f6fd1', 'var-novo': '#1f6fd1', 'var-queda': '#e08600', 'var-queda-forte': '#c62828', 'var-igual': '#8a8f8c' }
const COR_ABST = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']
const pctAbst = (l) => (l[4] ? 100 * (1 - l[5] / l[4]) : 0)
// 5 classes de abstenção (quintis dos locais de votação de SC)
function limitesAbst() {
  const a = arquivoPro('locais').valor
  if (!a) return null
  if (!PRO.limAbst) {
    const todos = Object.values(a.l).flatMap((m) => Object.values(m)).filter((l) => l[4] >= 50).map(pctAbst).sort((x, y) => x - y)
    PRO.limAbst = [0.2, 0.4, 0.6, 0.8, 1].map((q) => todos[Math.min(todos.length - 1, Math.floor(q * todos.length))])
  }
  return PRO.limAbst
}

function renderPro() {
  if (DEMO) return '<div class="cartao vazio">As análises usam dados reais e não aparecem no modo demonstração.</div>'
  if (!PRO.chave) return renderLoginPro()
  const el = B26.els.get(PRO.sel)
  const subs = [['mapa', '🗺️ Mapa de votos'], ['perfil', '👥 Perfil do eleitor'], ['abst', '📉 Abstenção'], ['transf', '🔀 1º → 2º turno']]
  const topo = `<section class="cartao resumo">
      <div class="resumo-titulo"><h2>🔒 Análises · 2026</h2><button type="button" class="botao secundario pro-sair" data-pro-sair>Sair</button></div>
      <div class="segmentado" role="group">${subs.map(([k, r]) => `<button type="button" data-pro-aba="${k}" aria-pressed="${PRO.aba === k}">${r}</button>`).join('')}</div>
      ${PRO.aba !== 'abst' && PRO.aba !== 'transf' ? seletorCandidatoPro(el) : ''}
    </section>`
  if (PRO.aba === 'transf') return topo + renderTransfPro()
  if (!el && PRO.aba !== 'abst') return topo + '<div class="cartao vazio">Carregando os candidatos…</div>'
  return topo + (PRO.aba === 'mapa' ? renderMapaPro(el) : PRO.aba === 'perfil' ? renderPerfilPro(el) : renderAbstPro())
}

function seletorCandidatoPro(el) {
  const pills = `<div class="segmentado h22-pills" role="group">${eleicoes26()
    .map((id) => `<button type="button" data-pro-cargo="${id}" aria-pressed="${id === PRO.sel}">${ROTULO_26[id]}</button>`)
    .join('')}</div>`
  const c = el?.porNumero?.get(String(PRO.cand))
  const termo = semAcento(PRO.busca.trim())
  const achados = el && termo ? el.candidatos.filter((x) => x.valido && semAcento(`${x.nome} ${x.nomeCompleto} ${x.partido} ${x.numero}`).includes(termo)).slice(0, 8) : []
  return `${pills}
    ${c ? `<div class="pro-cand" style="${estiloCor(corPartido(c.partido))}"><span class="cand-nome">${esc(c.nome)}</span> ${pill(c.partido)} <span class="mudo">nº ${esc(c.numero)} · ${fmt.format(c.votos)} votos em SC</span></div>` : ''}
    <input id="pro-busca" type="search" autocomplete="off" placeholder="🔎 Trocar candidato (nome, partido ou número)…" value="${esc(PRO.busca)}">
    ${termo ? `<div class="atalhos-chips">${achados.map((x) => `<button type="button" class="atalho" data-pro-cand="${esc(x.numero)}">${esc(x.nome)} · ${esc(x.partido)}</button>`).join('') || '<span class="nota">Nenhum candidato encontrado.</span>'}</div>` : ''}`
}

function seletorMunPro(extra = '') {
  const opcoes = [...MUNICIPIOS_SC].sort((a, b) => a[2].localeCompare(b[2], 'pt-BR'))
    .map((m) => `<option value="${m[0]}" ${PRO.mun === m[0] ? 'selected' : ''}>${esc(m[2])}</option>`).join('')
  return `<div class="bai-escolha">
    <button type="button" class="atalho regiao ${!PRO.mun ? 'ativo' : ''}" data-pro-mun="">🗺️ SC inteira</button>
    <button type="button" class="atalho ${PRO.mun === FLORIPA_CD ? 'ativo' : ''}" data-pro-mun="${FLORIPA_CD}">Florianópolis</button>
    <select data-pro-mun-sel aria-label="Município"><option value="">📍 Outro município…</option>${opcoes}</select>${extra}</div>`
}

// cabeçalho dos cards das análises (candidato selecionado)
function baseCardPro(el, extra = {}) {
  const c = el?.porNumero?.get(String(PRO.cand))
  return { exclusivo: true, turno: turnoDe(PRO.sel), foto: c?.foto, nome: c?.nome || 'Análises', cor: corPartido(c?.partido), sub: c ? `${c.partido} · nº ${c.numero} · ${ROTULO_26[PRO.sel]}` : ROTULO_26[PRO.sel], ...extra }
}

/* ---- mapa ---- */
function renderMapaPro(el) {
  const camadas = `<div class="segmentado" role="group"><button type="button" data-pro-camada="votos" aria-pressed="${PRO.camada === 'votos'}">Votos do candidato</button><button type="button" data-pro-camada="abst" aria-pressed="${PRO.camada === 'abst'}">Abstenção</button></div>`
  const leg = PRO.camada === 'votos'
    ? `<div class="var-legenda"><span class="mudo">Tamanho = votos · cor = variação desde 2022:</span>${[['var-alta-forte', '▲ +20% ou mais'], ['var-alta', '▲ subiu'], ['var-queda', '▼ caiu'], ['var-queda-forte', '▼ −20% ou mais'], ['var-igual', 'sem 2022']].map(([k, r]) => `<span class="leg-ponto"><i style="background:${COR_VAR[k]}"></i>${r}</span>`).join('')}</div>`
    : `<div class="var-legenda"><span class="mudo">Tamanho = eleitores aptos · cor = abstenção:</span>${(limitesAbst() || []).map((v, i, a) => `<span class="leg-ponto"><i style="background:${COR_ABST[i]}"></i>${i === 4 ? `acima de ${fmtPct.format(a[3])}%` : `até ${fmtPct.format(v)}%`}</span>`).join('')}</div>`
  return `<section class="cartao pro-mapa-cartao">
      ${seletorMunPro()}
      ${camadas}
      <div id="pro-mapa" class="pro-mapa" role="region" aria-label="Mapa"></div>
      ${leg}
      <p class="nota" id="pro-mapa-nota">${PRO.mun ? 'Cada círculo é um local de votação. Toque para ver os números.' : 'Cada círculo é um município (centro dos seus locais de votação). Toque para ver os números; escolha um município para ver as escolas.'}</p>
    </section>
    <section class="cartao"><h3>📋 Tabela do mapa</h3><div id="pro-mapa-tabela"><p class="nota">Carregando…</p></div></section>`
}

let leafletPronto = null
function carregarLeaflet() {
  leafletPronto ??= new Promise((ok, erro) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `lib/leaflet/leaflet.css?v=${VERSAO}`
    document.head.append(css)
    const s = document.createElement('script')
    s.src = `lib/leaflet/leaflet.js?v=${VERSAO}`
    s.onload = () => ok(window.L)
    s.onerror = erro
    document.head.append(s)
  })
  return leafletPronto
}

// pontos do mapa (município ou SC) para o candidato ou a abstenção
async function pontosMapa(el) {
  const loc = (await arquivoPro('locais')).l
  const nr = PRO.cand
  if (PRO.camada === 'abst') {
    const grupos = PRO.mun ? Object.entries(loc[PRO.mun] || {}).map(([k, l]) => ({ id: k, nome: titulo22(l[2]), sub: l[3], lat: l[0], lon: l[1], l })) : Object.entries(loc).map(([cd, m]) => agrupaMun(cd, Object.values(m)))
    limitesAbst()
    return grupos.filter((g) => g.lat != null).map((g) => {
      const a = pctAbst(g.l)
      const i = PRO.limAbst.findIndex((v) => a <= v)
      return { ...g, tam: g.l[4], cor: COR_ABST[i < 0 ? 4 : i], valor: a, html: `<strong>${esc(g.nome)}</strong>${g.sub ? `<br>${esc(g.sub)}` : ''}<br>${fmt.format(g.l[4])} aptos · ${fmt.format(g.l[4] - g.l[5])} ausentes<br><strong>Abstenção ${fmtPct.format(a)}%</strong>` }
    })
  }
  const c = el.porNumero.get(String(nr))
  if (!c) return []
  if (!PRO.mun) {
    const m = (await arquivoPro(`mun-${PRO.sel}`))
    const e = m.c[nr] || { v: {} }
    return Object.entries(loc).map(([cd, ls]) => {
      const g = agrupaMun(cd, Object.values(ls))
      const v = e.v[cd] || 0
      const v22 = e.v22 ? e.v22[cd] || 0 : null
      const va = variacao(v, v22)
      return { ...g, tam: v, cor: COR_VAR[va?.cls || 'var-igual'], valor: v, v22, va, val: m.validos[cd] || 0, html: `<strong>${esc(g.nome)}</strong><br>${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, m.validos[cd] || 0))}%${v22 != null ? `<br>2022: ${fmt.format(v22)}${va ? ` · <strong>${va.txt}</strong>` : ''}` : ''}` }
    }).filter((g) => g.lat != null && (g.tam > 0 || g.v22))
  }
  const arq = secoesAno(2026, PRO.mun)
  if (!arq) return null
  const ag = agregarSecoes(arq, { id: PRO.sel, cargo: Number(PRO.sel.split('-c')[1]), anul: new Set() }, {}, 'local', nr)
  let mapa22 = null
  const p22 = H22.resumo ? achar2022(c).filter((p) => p.el.turno === 1).sort((a, b) => (b.el.cargo === Number(PRO.sel.split('-c')[1])) - (a.el.cargo === Number(PRO.sel.split('-c')[1])))[0] : null
  if (p22 && PREF.mostrar2022) {
    const a22 = secoesAno(2022, PRO.mun)
    if (!a22) return null
    const g22 = agregarSecoes(a22, { id: p22.el.id, cargo: p22.el.cargo, anul: new Set() }, {}, 'local', Number(p22.c.numero))
    mapa22 = new Map(g22.grupos.map((g) => [g.chave, g.foco]))
  }
  return ag.grupos.map((g) => {
    const l = loc[PRO.mun]?.[g.chave]
    const v22 = mapa22 ? mapa22.get(g.chave) ?? null : null
    const va = variacao(g.foco, v22)
    const pos = posicaoNoGrupo(g, nr)
    return { id: g.chave, nome: titulo22(l?.[2] || arq.locais[g.chave]?.[0] || g.chave), sub: bairroDoLocal(arq, g.chave), lat: l?.[0], lon: l?.[1], tam: g.foco, cor: COR_VAR[va?.cls || 'var-igual'], valor: g.foco, v22, va, val: g.validos, pos,
      html: `<strong>${esc(titulo22(l?.[2] || g.chave))}</strong><br>${esc(bairroDoLocal(arq, g.chave))}<br>${fmt.format(g.foco)} votos · ${fmtPct.format(pctDe(g.foco, g.validos))}%${pos ? ` · ${pos.p}º de ${pos.n}` : ''}${v22 != null ? `<br>2022: ${fmt.format(v22)}${va ? ` · <strong>${va.txt}</strong>` : ''}` : mapa22 ? '<br>local sem votação em 2022' : ''}` }
  }).filter((g) => g.lat != null && (g.tam > 0 || g.v22))
}
function agrupaMun(cd, ls) {
  const com = ls.filter((l) => l[0] != null)
  const soma = (i) => ls.reduce((a, l) => a + l[i], 0)
  const l = [com.length ? com.reduce((a, x) => a + x[0], 0) / com.length : null, com.length ? com.reduce((a, x) => a + x[1], 0) / com.length : null, NOME_MUN.get(cd) || cd, '', soma(4), soma(5)]
  return { id: cd, nome: NOME_MUN.get(cd) || cd, sub: '', lat: l[0], lon: l[1], l }
}

function cardMapaPro(el, pts) {
  const onde = PRO.mun ? NOME_MUN.get(PRO.mun) || '' : 'Santa Catarina'
  const top = [...pts].sort((a, b) => b.valor - a.valor).slice(0, 8)
  const max = Math.max(1, ...top.map((p) => p.valor))
  const somaV = pts.reduce((a, p) => a + p.valor, 0)
  const tem22m = pts.some((p) => p.v22 != null)
  if (PRO.camada === 'abst') {
    const ap = pts.reduce((a, p) => a + p.l[4], 0), cp = pts.reduce((a, p) => a + p.l[5], 0)
    return { exclusivo: true, turno: 1, total: { rot: `Ausentes · ${onde}`, valor: `${fmt.format(ap - cp)}`, sub: `${fmtPct.format(pctDe(ap - cp, ap))}% de ${fmt.format(ap)} aptos` }, nome: `Abstenção · ${onde}`, cor: '#1c5cab', sub: PRO.mun ? 'Por local de votação' : 'Por município', titulo: 'Onde mais eleitores faltaram', subtitulo: '% de aptos que não votaram',
      linhas: top.map((p) => ({ ponto: p.cor, nome: p.nome, extra: `${p.sub ? p.sub + ' · ' : ''}${fmt.format(p.l[4] - p.l[5])} ausentes de ${fmt.format(p.l[4])}`, valor: `${fmtPct.format(p.valor)}%`, frac: p.valor / max, corBarra: p.cor })) }
  }
  return baseCardPro(el, { total: totalCard(`Total em ${onde}`, somaV, tem22m ? pts.reduce((a, p) => a + (p.v22 || 0), 0) : null), titulo: `Mapa de votos · ${onde}`, subtitulo: PRO.mun ? 'Locais de votação com mais votos' : 'Municípios com mais votos',
    linhas: top.map((p) => {
      const extra = [p.sub, p.pos ? `${p.pos.p}º no local` : ''].filter(Boolean).join(' · ')
      // com 2022: barras alinhadas (2022 cinza × 2026 na cor do candidato), como no app
      if (p.v22 != null) return { nome: p.nome, extra, par: { v22: p.v22, v26: p.valor, max: Math.max(1, ...top.map((q) => Math.max(q.valor, q.v22 || 0))) }, dir2: p.va ? p.va.txt : '', corDir2: p.va ? COR_VAR[p.va.cls] : null }
      return { ponto: p.cor, nome: p.nome, extra, valor: fmt.format(p.valor), dir2: `${fmtPct.format(pctDe(p.valor, p.val))}%`, frac: p.valor / max, corBarra: p.cor }
    }) })
}

async function montarMapaPro() {
  const div = document.getElementById('pro-mapa')
  if (!div) return
  const el = B26.els.get(PRO.sel)
  let L, pts
  try {
    ;[L, pts] = await Promise.all([carregarLeaflet(), pontosMapa(el)])
  } catch {
    div.innerHTML = '<p class="nota">Não consegui carregar o mapa agora.</p>'
    return
  }
  if (!document.body.contains(div)) return
  if (pts == null) return // arquivos do município ainda carregando; renderizar() chama de novo
  PRO.mapa?.remove()
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches
  const mapa = L.map(div, { zoomControl: true, attributionControl: true, preferCanvas: true })
  PRO.mapa = mapa
  mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
  // mapa base sem chave de API: OpenStreetMap; se os blocos falharem, troca para o mapa cinza da Esri
  div.classList.toggle('mapa-escuro', escuro)
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa)
  let falhas = 0
  osm.on('tileerror', () => {
    if (++falhas !== 4 || PRO.mapa !== mapa) return
    mapa.removeLayer(osm)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, attribution: 'Mapa &copy; Esri, HERE, Garmin, &copy; OpenStreetMap',
    }).addTo(mapa)
  })
  const max = Math.max(1, ...pts.map((p) => p.tam))
  const rMax = PRO.mun ? 22 : 26
  const bounds = []
  for (const p of [...pts].sort((a, b) => b.tam - a.tam)) {
    const r = Math.max(3, rMax * Math.sqrt(p.tam / max))
    L.circleMarker([p.lat, p.lon], { radius: r, color: escuro ? '#1b1f1d' : '#ffffff', weight: 1.5, fillColor: p.cor, fillOpacity: 0.78 }).bindPopup(p.html).addTo(mapa)
    bounds.push([p.lat, p.lon])
  }
  if (bounds.length) mapa.fitBounds(bounds, { padding: [16, 16], maxZoom: 15 })
  else mapa.setView([-27.6, -50.5], 7)
  // tabela acessível com os mesmos números
  const tab = document.getElementById('pro-mapa-tabela')
  if (tab) {
    const linhas = [...pts].sort((a, b) => b.valor - a.valor).slice(0, PRO.verTodosMapa ? 2000 : 30)
    tab.innerHTML = `<table class="tabela bai-tabela"><thead><tr><th>${PRO.mun ? 'Local' : 'Município'}</th><th class="dir">${PRO.camada === 'abst' ? 'Abstenção' : 'Votos'}</th></tr></thead><tbody>${linhas
      .map((p) => `<tr><td><span class="leg-ponto"><i style="background:${p.cor}"></i></span><strong>${esc(p.nome)}</strong>${p.sub ? `<div class="cand-meta">${esc(p.sub)}</div>` : ''}${p.va ? `<div class="var-linha"><span class="var ${p.va.cls}">${p.va.txt}</span><span class="mudo">2022: ${fmt.format(p.v22)}</span></div>` : ''}</td>
        <td class="dir">${PRO.camada === 'abst' ? `${fmtPct.format(p.valor)}%<div class="cand-meta">${fmt.format(p.l[4] - p.l[5])} ausentes</div>` : `<strong>${fmt.format(p.valor)}</strong><div class="cand-meta">${fmtPct.format(pctDe(p.valor, p.val))}%${p.pos ? ` · ${p.pos.p}º` : ''}</div>`}</td></tr>`)
      .join('')}</tbody></table>${pts.length > linhas.length ? `<button type="button" class="botao secundario" data-pro-mapa-todos>Mostrar todos (${pts.length})</button>` : ''}
      <div class="exportar">${botaoCard('pro-mapa', cardMapaPro(el, pts))}</div>`
  }
}

/* ---- perfil do eleitor ---- */
const GRUPOS_PERFIL = [['Sexo', [0]], ['Idade', [1, 2, 3, 4, 5]], ['Escolaridade', [6, 7, 8]]]
function renderPerfilPro(el) {
  const arq = arquivoPro(`perfil-${PRO.sel}`)
  if (!arq.valor) return `<div class="cartao vazio">${arq.erro ? 'Não consegui abrir o perfil.' : 'Carregando o perfil…'}</div>`
  const P = arq.valor
  const c = el.porNumero.get(String(PRO.cand))
  const e = P.c[PRO.cand]
  if (!c || !e) return '<div class="cartao vazio">Candidato com poucos votos para estimar o perfil (mínimo de 50).</div>'
  // destaques: maiores diferenças entre as seções com mais e com menos de cada grupo
  const rel = P.atributos.map((nome, i) => ({ nome, i, alto: e.q[i][4], baixo: e.q[i][0], r: e.q[i][0] ? e.q[i][4] / e.q[i][0] : 1 }))
  const fortes = rel.filter((x) => x.r >= 1.15).sort((a, b) => b.r - a.r).slice(0, 3)
  const fracos = rel.filter((x) => x.r <= 1 / 1.15).sort((a, b) => a.r - b.r).slice(0, 3)
  const frase = (x, mais) => `<li>${mais ? '▲' : '▼'} Vai <strong>${mais ? 'melhor' : 'pior'}</strong> onde há mais <strong>${esc(rotuloAtributo(x.nome))}</strong>: ${fmtPct.format(x.alto)}% dos votos válidos nas seções com mais, contra ${fmtPct.format(x.baixo)}% nas com menos.</li>`
  const cor = corPartido(c.partido)
  const grafico = (i) => {
    const q = e.q[i]
    const max = Math.max(...q, 0.01)
    const fx = P.faixas[i]
    return `<div class="perfil-graf" role="img" aria-label="${esc(P.atributos[i])}: ${q.map((v, k) => `${k + 1}º grupo ${fmtPct.format(v)}%`).join(', ')}">
      <div class="perfil-tit">${esc(P.atributos[i])} <span class="mudo">· nas seções, pesado pelos votos de quem escolheu este candidato: ${fmtPct.format(100 * e.m[i])}% (média de SC: ${fmtPct.format(100 * P.base[i])}%)</span></div>
      <div class="perfil-barras">${q.map((v, k) => `<div class="perfil-col" title="Seções com ${fmtPct.format(100 * fx[k])}% a ${fmtPct.format(100 * fx[k + 1])}% de ${esc(P.atributos[i].toLowerCase())}: ${fmtPct.format(v)}% dos válidos"><span class="perfil-val">${fmtPct.format(v)}%</span><span class="perfil-barra" style="height:${Math.max(2, (100 * v) / max)}%"></span></div>`).join('')}</div>
      <div class="perfil-eixo"><span>menos ${esc(P.atributos[i].toLowerCase())}</span><span>mais →</span></div>
    </div>`
  }
  return `<section class="cartao perfil" style="--cor-perfil:${cor}">
      <h3>👥 Onde ${esc(c.nome)} vai melhor e pior</h3>
      ${fortes.length || fracos.length ? `<ul class="perfil-frases">${fortes.map((x) => frase(x, true)).join('')}${fracos.map((x) => frase(x, false)).join('')}</ul>` : '<p class="nota">Desempenho parecido em todos os perfis de seção.</p>'}
      <div class="exportar">${botaoCard('pro-perfil', baseCardPro(el, { titulo: 'Perfil do eleitor', subtitulo: `${fmtPct.format(e.q[0].reduce((a, v) => a + v, 0) / 5)}% dos válidos em SC · seções com mais × com menos`, numerar: false,
        linhas: [...rel].sort((a, b) => Math.abs(Math.log(b.r || 1)) - Math.abs(Math.log(a.r || 1))).slice(0, 7).map((x) => {
          const mx = Math.max(x.alto, x.baixo, 0.01)
          return { nome: CURTO_ATRIBUTO[x.nome] || x.nome, extra: `Mais: ${fmtPct.format(x.alto)}% · menos: ${fmtPct.format(x.baixo)}%`, valor: `${x.alto >= x.baixo ? '▲' : '▼'} ${fmtPct.format(Math.abs(x.alto - x.baixo))} p.p.`, dir2: x.alto >= x.baixo ? 'vai melhor' : 'vai pior', corDir2: x.alto >= x.baixo ? '#0b7a45' : '#c62828', barras: [{ frac: x.alto / mx, cor }, { frac: x.baixo / mx, cor: '#9aa19d' }] }
        }),
        rodape: 'Barras: seções com mais (cor) × com menos (cinza)' }))}</div>
      <p class="nota">Em SC, ${esc(c.nome)} teve <strong>${fmtPct.format(e.q[0].reduce((a, v) => a + v, 0) / 5)}%</strong> dos votos válidos. As seções de SC foram divididas em 5 grupos com o mesmo número de votos, da que tem menos à que tem mais eleitores de cada perfil. Cada barra é o % dos votos válidos do candidato naquele grupo.</p>
    </section>
    ${GRUPOS_PERFIL.map(([tit, is]) => `<section class="cartao perfil" style="--cor-perfil:${cor}"><h3>${tit}</h3>${is.map(grafico).join('')}</section>`).join('')}
    <p class="nota centro">Estimativa ecológica: compara seções, não pessoas (o voto é secreto). Perfil do eleitorado por seção (TSE, 2026) × boletins de urna; ${fmt.format(P.secoes)} seções.</p>`
}
const CURTO_ATRIBUTO = { Mulheres: 'Mulheres', '16 a 24 anos': 'Jovens (16 a 24)', '25 a 34 anos': '25 a 34 anos', '35 a 44 anos': '35 a 44 anos', '45 a 59 anos': '45 a 59 anos', '60 anos ou mais': '60 anos ou mais', 'Até fundamental incompleto': 'Até fund. incompleto', 'Médio completo ou superior incompleto': 'Médio ou sup. incompleto', 'Superior completo': 'Superior completo' }
const rotuloAtributo = (n) => ({ Mulheres: 'mulheres', '16 a 24 anos': 'jovens de 16 a 24 anos', '60 anos ou mais': 'eleitores de 60 anos ou mais', 'Até fundamental incompleto': 'eleitores com até o fundamental incompleto', 'Médio completo ou superior incompleto': 'eleitores com médio completo ou superior incompleto', 'Superior completo': 'eleitores com superior completo' })[n] || `eleitores de ${n}`

/* ---- abstenção, brancos e nulos ---- */
function renderAbstPro() {
  const tem2 = [...INDICE26].some((id) => id.startsWith('t2-'))
  if (!tem2) PRO.turnoAbst = 1
  const arq = arquivoPro(PRO.turnoAbst === 2 ? 'locais-t2' : 'locais')
  if (!arq.valor) return `<div class="cartao vazio">${arq.erro ? 'Não consegui abrir os dados.' : 'Carregando…'}</div>`
  const { l: loc, cargos } = arq.valor
  const ic = Math.max(0, cargos.indexOf(PRO.cargoAbst))
  const grupos = new Map()
  const add = (k, nome, sub, l) => {
    const g = grupos.get(k) || { nome, sub, aptos: 0, comp: 0, br: 0, nu: 0, n: 0 }
    g.aptos += l[4]; g.comp += l[5]; g.br += l[6 + 2 * ic]; g.nu += l[7 + 2 * ic]; g.n++
    grupos.set(k, g)
  }
  if (PRO.mun) for (const l of Object.values(loc[PRO.mun] || {})) add(l[3], l[3], '', l)
  else for (const [cd, m] of Object.entries(loc)) for (const l of Object.values(m)) add(cd, NOME_MUN.get(cd) || cd, '', l)
  const lista = [...grupos.values()].map((g) => ({ ...g, abst: pctDe(g.aptos - g.comp, g.aptos), pbr: pctDe(g.br, g.comp), pnu: pctDe(g.nu, g.comp), aus: g.aptos - g.comp }))
  const tot = lista.reduce((a, g) => ({ aptos: a.aptos + g.aptos, comp: a.comp + g.comp, br: a.br + g.br, nu: a.nu + g.nu }), { aptos: 0, comp: 0, br: 0, nu: 0 })
  const ord = { abst: (a, b) => b.abst - a.abst, aus: (a, b) => b.aus - a.aus, br: (a, b) => b.pbr - a.pbr, nu: (a, b) => b.pnu - a.pnu, menor: (a, b) => a.abst - b.abst }
  const minAptos = PRO.mun ? 100 : 0
  const vis = lista.filter((g) => g.aptos >= minAptos).sort(ord[PRO.ordem] || ord.abst)
  const lim = PRO.verTodosAbst ? vis.length : 40
  const maxAbs = Math.max(...vis.map((g) => g.abst), 1)
  return `<section class="cartao">
      ${seletorMunPro()}
      ${tem2 ? `<div class="segmentado" role="group" aria-label="Turno">${[1, 2].map((t) => `<button type="button" data-pro-turno-abst="${t}" aria-pressed="${(PRO.turnoAbst || 1) === t}">${t}º turno</button>`).join('')}</div>` : ''}
      <div class="segmentado" role="group" aria-label="Cargo dos brancos e nulos">${cargos.map((id) => `<button type="button" data-pro-cargo-abst="${id}" aria-pressed="${id === PRO.cargoAbst}">${ROTULO_26[id]}</button>`).join('')}</div>
      <div class="calc-num h22-tot">
        <div><span>Eleitores aptos</span><strong>${fmt.format(tot.aptos)}</strong></div>
        <div><span>Abstenção</span><strong>${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}%</strong><small>${fmt.format(tot.aptos - tot.comp)} ausentes</small></div>
        <div><span>Brancos</span><strong>${fmtPct.format(pctDe(tot.br, tot.comp))}%</strong><small>${fmt.format(tot.br)}</small></div>
        <div><span>Nulos</span><strong>${fmtPct.format(pctDe(tot.nu, tot.comp))}%</strong><small>${fmt.format(tot.nu)}</small></div>
      </div>
    </section>
    <section class="cartao"><h3>${PRO.mun ? `Bairros de ${esc(NOME_MUN.get(PRO.mun) || '')}` : 'Municípios de SC'}</h3>
      <div class="segmentado" role="group">${[['abst', 'Maior abstenção'], ['aus', 'Mais ausentes'], ['menor', 'Menor abstenção'], ['br', 'Mais brancos'], ['nu', 'Mais nulos']].map(([k, r]) => `<button type="button" data-pro-ordem="${k}" aria-pressed="${PRO.ordem === k}">${r}</button>`).join('')}</div>
      <table class="tabela bai-tabela"><thead><tr><th>${PRO.mun ? 'Bairro' : 'Município'}</th><th class="dir">Abstenção</th><th class="dir">Br · Nu</th></tr></thead><tbody>${vis
        .slice(0, lim)
        .map((g) => `<tr><td><strong>${esc(g.nome)}</strong><div class="cand-meta">${fmt.format(g.aptos)} aptos · <strong>${fmt.format(g.aus)}</strong> ausentes</div><div class="abst-barra"><span style="width:${(100 * g.abst) / maxAbs}%"></span></div></td>
          <td class="dir"><strong>${fmtPct.format(g.abst)}%</strong></td><td class="dir">${fmtPct.format(g.pbr)}%<div class="cand-meta">${fmtPct.format(g.pnu)}%</div></td></tr>`)
        .join('')}</tbody></table>
      ${vis.length > lim ? `<button type="button" class="botao secundario" data-pro-abst-todos>Mostrar todos (${vis.length})</button>` : ''}
      <div class="exportar">${botaoCard('pro-abst', { exclusivo: true, turno: PRO.turnoAbst || 1, total: { rot: `Ausentes · ${PRO.mun ? NOME_MUN.get(PRO.mun) || '' : 'Santa Catarina'}`, valor: fmt.format(tot.aptos - tot.comp), sub: `${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}% de ${fmt.format(tot.aptos)} aptos · brancos ${fmtPct.format(pctDe(tot.br, tot.comp))}% · nulos ${fmtPct.format(pctDe(tot.nu, tot.comp))}%` }, nome: `Abstenção · ${PRO.mun ? NOME_MUN.get(PRO.mun) || '' : 'Santa Catarina'}`, cor: '#1c5cab',
        sub: `${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}% de abstenção · ${fmt.format(tot.aptos - tot.comp)} ausentes`,
        titulo: { abst: 'Maior abstenção', aus: 'Mais eleitores ausentes', menor: 'Menor abstenção', br: 'Mais votos brancos', nu: 'Mais votos nulos' }[PRO.ordem] || 'Abstenção',
        subtitulo: `${PRO.mun ? 'Bairros' : 'Municípios'} · brancos e nulos: ${ROTULO_26[PRO.cargoAbst] || ''}`,
        linhas: vis.slice(0, 8).map((g) => ({ nome: g.nome, extra: `${fmt.format(g.aptos)} aptos · ${fmt.format(g.aus)} ausentes`, valor: PRO.ordem === 'br' ? `${fmtPct.format(g.pbr)}%` : PRO.ordem === 'nu' ? `${fmtPct.format(g.pnu)}%` : PRO.ordem === 'aus' ? fmt.format(g.aus) : `${fmtPct.format(g.abst)}%`, dir2: PRO.ordem === 'abst' || PRO.ordem === 'menor' ? `br ${fmtPct.format(g.pbr)}% · nulos ${fmtPct.format(g.pnu)}%` : `abstenção ${fmtPct.format(g.abst)}%`, frac: g.abst / maxAbs, corBarra: '#2a78d6' })) })}</div>
      <p class="nota">Abstenção = aptos que não votaram ÷ aptos. Brancos e nulos em % do comparecimento, no cargo escolhido. "Ausentes" é o número de eleitores que não foram votar: o eleitor "disponível" para uma campanha.${PRO.mun ? ' Bairros com menos de 100 aptos ficam de fora.' : ''} Fonte: boletins de urna (TSE).</p>
    </section>`
}


/* ---- transferência de votos entre turnos ---- */
function conjuntosTransf() {
  const l = []
  for (const c of [1, 3]) if (INDICE26.has(`t2-c${c}`)) l.push({ id: `transf-c${c}`, ano: 2026, cargo: c, rot: `${c === 1 ? 'Presidente' : 'Governador'} · 2026` })
  l.push({ id: 'transf22-c3', ano: 2022, cargo: 3, rot: 'Governador · 2022' })
  return l
}
// nome, partido e cor de um número de candidato numa eleição (2022 ou 2026)
function votavelTransf(ano, id, nr) {
  if (nr === 96) return { nome: 'Brancos e nulos', cor: '#9aa19d' }
  if (nr === 'outros') return { nome: 'Outros candidatos', cor: '#7d8580' }
  if (ano === 2022) {
    const el = H22.resumo?.eleicoes.find((e) => e.id === id)
    const c = el?.candidatos.find((x) => Number(x.numero) === nr)
    return c ? { nome: c.nome, partido: c.partido, cor: corPartido(c.partido) } : { nome: `Nº ${nr}`, cor: '#7d8580' }
  }
  const c = B26.els.get(id)?.candidatos.find((x) => Number(x.numero) === nr)
  if (!c) garantirEleicao26(id).then(() => estado.aba.tipo === 'pro' && renderizar()).catch(() => {})
  return c ? { nome: c.nome, partido: c.partido, cor: corPartido(c.partido) } : { nome: `Nº ${nr}`, cor: '#7d8580' }
}
function renderTransfPro() {
  const conj = conjuntosTransf()
  const sel = conj.find((x) => x.id === PRO.transf) || conj[0]
  const pills = `<div class="segmentado" role="group">${conj.map((x) => `<button type="button" data-pro-transf="${x.id}" aria-pressed="${x.id === sel.id}">${x.rot}</button>`).join('')}</div>`
  if (sel.ano === 2022 && !H22.resumo) {
    resumo2022().then(() => renderizar()).catch(() => {})
    return `<section class="cartao">${pills}<p class="nota">Carregando 2022…</p></section>`
  }
  const arq = arquivoPro(sel.id)
  if (!arq.valor) return `<section class="cartao">${pills}<p class="nota">${arq.erro ? 'Não consegui abrir os dados.' : 'Carregando…'}</p></section>`
  const R = arq.valor
  const id1 = `t1-c${sel.cargo}`, id2 = `t2-c${sel.cargo}`
  const dest = R.destinos.map((d) => votavelTransf(sel.ano, id2, d))
  const leg = `<div class="var-legenda">${dest.map((d) => `<span class="leg-ponto"><i style="background:${d.cor}"></i>${esc(d.nome)}${d.partido ? ` (${esc(d.partido)})` : ''}</span>`).join('')}</div>`
  const linhas = R.origens.map((o, i) => {
    const or = votavelTransf(sel.ano, id1, o)
    const seg = R.T[i]
    return `<div class="transf-linha">
      <div class="transf-orig"><strong>${esc(or.nome)}</strong>${or.partido ? ` ${pill(or.partido)}` : ''} <span class="mudo">· ${fmt.format(R.votos1[i])} votos no 1º turno</span></div>
      <div class="transf-barra" role="img" aria-label="${dest.map((d, j) => `${d.nome}: ${fmtPct.format(100 * seg[j])}%`).join(', ')}">${seg.map((v, j) => (v >= 0.005 ? `<span style="width:${100 * v}%;background:${dest[j].cor}" title="${esc(dest[j].nome)}: ${fmtPct.format(100 * v)}%">${v >= 0.14 ? `${Math.round(100 * v)}%` : ''}</span>` : '')).join('')}</div>
      <div class="cand-meta">${seg.map((v, j) => (v >= 0.005 ? `${esc(dest[j].nome)} <strong>${fmtPct.format(100 * v)}%</strong> (≈ ${fmt.format(Math.round(v * R.votos1[i]))})` : '')).filter(Boolean).join(' · ')}</div>
    </div>`
  })
  return `<section class="cartao">${pills}
      <h3>🔀 Para onde foram os eleitores de cada candidato do 1º turno</h3>
      ${leg}
      ${linhas.join('')}
      <div class="exportar">${botaoCard('pro-transf', { exclusivo: true, turno: 2, chapeu: `ELEIÇÕES ${sel.ano} · SANTA CATARINA`, nome: sel.rot.replace(' · ', ' SC · '), cor: dest[0]?.cor, sub: `No 2º turno: ${R.destinos.map((d, j) => `${dest[j].nome.split(' ')[0]} ${fmt.format(R.votos2[j])}`).join(' · ')}`,
        titulo: 'Para onde foram os votos do 1º turno', subtitulo: `Estimativa seção a seção (${fmt.format(R.secoes)} seções)`,
        legenda: dest.map((d) => ({ cor: d.cor, txt: d.nome })),
        pilhas: R.origens.map((o, i) => ({ nome: votavelTransf(sel.ano, id1, o).nome, extra: `${fmt.format(R.votos1[i])} votos`, segs: R.T[i].map((v, j) => ({ frac: v, cor: dest[j].cor, txt: v >= 0.08 ? `${Math.round(100 * v)}%` : '' })) })),
        fonte: `Fonte: TSE · votação por seção ${sel.ano}` })}</div>
      <p class="nota">No 2º turno: ${R.destinos.map((d, j) => `${esc(dest[j].nome)} ${fmt.format(R.votos2[j])}`).join(' · ')}.</p>
      <p class="nota">Estimativa ecológica a partir de ${fmt.format(R.secoes)} seções: procura a divisão (sem valores negativos, somando 100% em cada linha) que melhor reproduz, seção a seção, o resultado do 2º turno a partir do 1º. Não considera quem votou em só um dos turnos; vale como tendência, não como contagem.</p>
    </section>`
}
// eventos da área protegida
conteudo.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'pro-form') return
  ev.preventDefault()
  const f = new FormData(ev.target)
  PRO.entrando = true
  PRO.erro = ''
  renderizar()
  try {
    await entrarPro(String(f.get('usuario') || ''), String(f.get('senha') || ''), !!f.get('lembrar'))
    PRO.entrando = false
    carregar()
  } catch {
    PRO.entrando = false
    PRO.erro = 'Usuário ou senha incorretos.'
    renderizar()
  }
})
conteudo.addEventListener('click', (ev) => {
  if (estado.aba.tipo !== 'pro') return
  const h = (s) => ev.target.closest(s)
  if (h('[data-pro-sair]')) return sairPro()
  if (h('[data-pro-aba]')) return ((PRO.aba = h('[data-pro-aba]').dataset.proAba), renderizar())
  if (h('[data-pro-cargo]')) return ((PRO.sel = h('[data-pro-cargo]').dataset.proCargo), (PRO.cand = null), (PRO.busca = ''), carregar())
  if (h('[data-pro-cand]')) return ((PRO.cand = Number(h('[data-pro-cand]').dataset.proCand)), (PRO.busca = ''), renderizar())
  if (h('[data-pro-mun]')) return ((PRO.mun = h('[data-pro-mun]').dataset.proMun || null), (PRO.verTodosMapa = PRO.verTodosAbst = false), renderizar())
  if (h('[data-pro-camada]')) return ((PRO.camada = h('[data-pro-camada]').dataset.proCamada), renderizar())
  if (h('[data-pro-ordem]')) return ((PRO.ordem = h('[data-pro-ordem]').dataset.proOrdem), renderizar())
  if (h('[data-pro-cargo-abst]')) return ((PRO.cargoAbst = h('[data-pro-cargo-abst]').dataset.proCargoAbst), renderizar())
  if (h('[data-pro-abst-todos]')) return ((PRO.verTodosAbst = true), renderizar())
  if (h('[data-pro-mapa-todos]')) return ((PRO.verTodosMapa = true), montarMapaPro())
  if (h('[data-pro-turno-abst]')) return ((PRO.turnoAbst = Number(h('[data-pro-turno-abst]').dataset.proTurnoAbst)), (PRO.cargoAbst = PRO.turnoAbst === 2 ? 't2-c1' : 't1-c3'), renderizar())
  if (h('[data-pro-transf]')) return ((PRO.transf = h('[data-pro-transf]').dataset.proTransf), renderizar())
})
conteudo.addEventListener('change', (ev) => {
  const s = ev.target.closest('[data-pro-mun-sel]')
  if (!s) return
  PRO.mun = s.value || null
  PRO.verTodosMapa = PRO.verTodosAbst = false
  renderizar()
})
conteudo.addEventListener('input', (ev) => {
  if (ev.target.id !== 'pro-busca') return
  PRO.busca = ev.target.value
  renderizar()
})
// da ficha do candidato direto para as análises dele
function abrirAnalises(det) {
  const aba = ABAS.find((a) => a.id === det.aba)
  const c = dadosDetalhe()?.candidatos.find((x) => x.sqcand === det.sqcand)
  if (!aba?.cargo || !c) return
  Object.assign(PRO, { sel: eleicaoDoCargo(aba.cargo), cand: Number(c.numero), aba: 'mapa', busca: '' })
  const ir = () => {
    trocarAba('analises')
    window.scrollTo({ top: 0 })
  }
  const voltar = history.state?.detalhe
  fecharDetalhe()
  if (voltar) window.addEventListener('popstate', () => setTimeout(ir), { once: true })
  else ir()
}

/* ---------------- início ---------------- */

// instalar como app (PWA): service worker com rede primeiro
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {})

// Versão nova publicada: compara o ?v= do app.js no index.html do servidor com o desta página
// e oferece recarregar (sem precisar fechar e abrir o app).
async function checarVersao() {
  if (!VERSAO || document.getElementById('versao-nova')) return
  try {
    const html = await (await fetch(`./?checar=${Date.now()}`, { cache: 'no-store' })).text()
    const v = html.match(/app\.js\?v=(\d+)/)?.[1]
    if (!v || v === VERSAO) return
    const faixa = document.createElement('div')
    faixa.id = 'versao-nova'
    faixa.className = 'versao-nova'
    faixa.setAttribute('role', 'status')
    faixa.innerHTML = '<span>✨ Nova versão do app disponível</span><button type="button" class="botao">Atualizar</button>'
    faixa.querySelector('button').addEventListener('click', () => location.reload())
    document.body.append(faixa)
  } catch {}
}
setTimeout(checarVersao, 30_000)
setInterval(checarVersao, 5 * 60_000)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checarVersao())
let pedidoInstalar = null
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault()
  pedidoInstalar = ev
  if (estado.aba.tipo === 'sobre') renderizar()
})


if (DEMO) {
  $('#aviso-demo').hidden = false
  $('#link-demo').hidden = true
}
if (TURNO === 2) $('.sub').textContent = 'Eleições Gerais · 2º turno · foco em Santa Catarina'
montarAbas()
carregar()
