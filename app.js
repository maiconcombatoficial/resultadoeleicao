// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

import { icone } from './icones.js'
import { calcularVagas } from './vagas.js'
import { chanceDe, NIVEIS } from './chances.js'
import { MESORREGIOES, MICRORREGIOES, MUNICIPIOS_SC, ASSOCIACOES, ASSOCIACAO_MUN } from './regioes.js'
import { FLORIPA } from './floripa.js'
import { corPartido, corTexto } from './cores.js'
import { configurarCampanha, renderCampanha, tratarCampanha, inputCampanha, submitCampanha, prepararCampanha, aoSalvarTerritorio, CAMPOS_CAMPANHA, paramsCampanha, aplicarParamsCampanha, renderPrecos } from './campanha.js'
import { $, BASE, CICLO, COR_VAR, DEMO, INTERVALO_MS, PREFIXO, ROTULO_ELEICAO, TURNO, UF, VERSAO, conteudo, ehMunicipal, ehProp, esc, esqueleto, fmt, fmtDec, fmtPct, gravarLocal, iniciais, lerJSON, lerLocal, nomeArquivo, num, pct, pctDe, semAcento, statusEl } from './nucleo.js'
import { CARDS, baixarArquivo, baixarCSV, baixarExcel, botaoCard, carregarScript, compartilharCarrossel, gerarPDF, legendaShare, legendaVar, linhasBairroCard, listaComparada, totalCard, variacao } from './exportar.js'
import { TELAO, abrirTelao, fecharTelao } from './telao.js'
import { EXTERIOR, PUBLICACAO_TSE, faseVotacao, instante } from './exterior.js'
import { PRO, abrirAnalises, arquivoPro, carregarLeaflet, carregarPro, definirChavePro, garantirEleicao26, montarMapaPro, renderPro } from './pro.js'
import { lerFotoQR, renderApuracaoQR, tratarQR } from './qr.js'

const ELEICOES = {
  federal: { 1: '6257', 2: '6258' },
  estadual: { 1: '6259', 2: '6260' },
}

// 🧭 Campanha (conta, equipe, IA, planos): só nos builds com a API (modo "campanha" do Vite, dev e testes);
// o site público do GitHub Pages não a mostra
export const CAMPANHA_ATIVA = import.meta.env.DEV || import.meta.env.MODE === 'campanha'
export const ABAS = [
  { id: 'inicio', rotulo: '🏠 Início', tipo: 'painel', abrangencias: ['br'] },
  { id: 'favoritos', rotulo: '❤️ Acompanhados', tipo: 'fav', abrangencias: ['br'] },
  { id: 'municipios', rotulo: '📊 Municípios', tipo: 'mun', abrangencias: ['sc'] },
  { id: 'bairros', rotulo: '🏘️ Bairros', tipo: 'bai', abrangencias: ['sc'] },
  ...(CAMPANHA_ATIVA ? [{ id: 'campanha', rotulo: '🧭 Campanha', tipo: 'camp', abrangencias: ['sc'] }] : []),
  { id: 'analises', rotulo: '🔒 Análises', tipo: 'pro', abrangencias: ['sc'] },
  { id: 'h2022', rotulo: '📅 Histórico', tipo: 'h22', abrangencias: ['sc'] },
  { id: 'presidente', rotulo: 'Presidente', cargo: 1, eleicao: 'federal', tipo: 'maj', abrangencias: ['br', UF] },
  { id: 'senador', rotulo: 'Senado SC', cargo: 5, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF], turno1: true },
  { id: 'depfed', rotulo: 'Dep. Federal SC', cargo: 6, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'depest', rotulo: 'Dep. Estadual SC', cargo: 7, eleicao: 'estadual', tipo: 'prop', abrangencias: [UF], turno1: true },
  { id: 'governador', rotulo: 'Governador SC', cargo: 3, eleicao: 'estadual', tipo: 'maj', abrangencias: [UF] },
  // eleições municipais (2024, 2020, 2016, 2012): sempre dentro de um município
  { id: 'prefeito', rotulo: 'Prefeito', cargo: 11, eleicao: 'municipal', tipo: 'maj', abrangencias: [UF], municipal: true },
  { id: 'vereador', rotulo: 'Vereador', cargo: 13, eleicao: 'municipal', tipo: 'prop', abrangencias: [UF], municipal: true },
  { id: 'sobre', rotulo: 'ℹ️ Sobre', tipo: 'sobre', abrangencias: ['br'] },
]

const NOMES_ABR = { br: 'Brasil', sc: 'Santa Catarina' }

/* ---------------- utilidades ---------------- */

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

export function regiao(id) {
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

export async function buscar(aba, abr, turno, signal, mun = null) {
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

const CHAVE_FAV = `${PREFIXO}favoritos:v1`
const CHAVE_HIST = `${PREFIXO}historico:v1`

export let favoritos = lerJSON(CHAVE_FAV, [])
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
export function registrarHistorico(abaId, abr, dados) {
  verificarAlertas(abaId, abr, dados)
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

/* ---------------- alertas dos acompanhados ---------------- */

// A cada atualização, compara a situação de cada candidato acompanhado com a anterior e avisa
// (notificação do sistema, se permitida, e um aviso na tela) quando ele muda de posição, é eleito,
// entra ou sai das vagas ou entra em risco. Funciona com o app aberto ou em segundo plano.
const CHAVE_ALERTAS = `${PREFIXO}alertas:v1`
const ALERTAS = { on: lerLocal(`${PREFIXO}alertas:on`, '') === '1', ult: lerJSON(CHAVE_ALERTAS, {}) }
const DENTRO = new Set(['garantido', 'segura', 'provavel', 'risco'])
const suportaNotificacao = () => typeof Notification !== 'undefined'

function situacaoAlerta(d, c, aba, pos) {
  const ch = chance(d, c, aba, true)
  const dentro = !!c.eleito || (aba.tipo === 'prop' ? !!c.projecao : ch ? DENTRO.has(ch.nivel) : pos <= (d.vagas || 1))
  return { pos, eleito: !!c.eleito, dentro, risco: ch?.nivel === 'risco', pst: d.secoes?.percentual || 0 }
}
function mensagensAlerta(nome, aba, a, b) {
  const cargo = aba.rotulo.replace(/ SC$/, '')
  if (b.eleito && !a.eleito) return `✔ ${nome} está eleito (${cargo}, conforme o TSE)`
  if (b.dentro !== a.dentro) return b.dentro ? `⬆️ ${nome} entrou nas vagas (${cargo}) · ${b.pos}º lugar` : `⬇️ ${nome} saiu das vagas (${cargo}) · ${b.pos}º lugar`
  if (b.risco && !a.risco) return `⚠️ ${nome}: vaga em risco (${cargo}) · ${b.pos}º lugar`
  if (b.pos !== a.pos) return `${b.pos < a.pos ? '▲' : '▼'} ${nome} ${b.pos < a.pos ? 'subiu' : 'caiu'} para ${b.pos}º (era ${a.pos}º) · ${cargo}`
  return null
}
function verificarAlertas(abaId, abr, d) {
  const aba = ABAS.find((a) => a.id === abaId)
  if (!aba || !d?.candidatos || d.mun) return
  let mudou = false
  for (const f of favoritos) {
    if (f.aba !== abaId || f.abr !== abr) continue
    const c = d.candidatos.find((x) => x.sqcand === f.sqcand)
    if (!c) continue
    const b = situacaoAlerta(d, c, aba, d.candidatos.indexOf(c) + 1)
    const a = ALERTAS.ult[f.id]
    // só compara com uma leitura anterior da mesma apuração (que não voltou atrás)
    const msg = a && b.pst >= a.pst ? mensagensAlerta(c.nome, aba, a, b) : null
    if (!a || a.pos !== b.pos || a.eleito !== b.eleito || a.dentro !== b.dentro || a.risco !== b.risco || a.pst !== b.pst) {
      ALERTAS.ult[f.id] = b
      mudou = true
    }
    if (msg && ALERTAS.on) avisar(msg, { aba: abaId, abr, sq: c.sqcand, pst: b.pst })
  }
  if (mudou) gravarLocal(CHAVE_ALERTAS, JSON.stringify(ALERTAS.ult))
}

function avisar(msg, alvo) {
  const hash = hashDe(alvo.aba, { c: alvo.sq, ca: alvo.aba, cr: alvo.abr !== UF ? alvo.abr : null })
  const corpo = `${fmtPct.format(alvo.pst)}% das seções apuradas · toque para abrir a ficha`
  if (suportaNotificacao() && Notification.permission === 'granted') {
    const opcoes = { body: corpo, tag: `alerta-${alvo.sq}`, renotify: true, icon: 'img/icones/icone-192.png', badge: 'img/icones/favicon-32.png', data: { url: `${location.pathname}${location.search}${hash}` } }
    const sw = navigator.serviceWorker
    ;(sw?.controller ? sw.ready.then((r) => r.showNotification(msg, opcoes)) : Promise.reject())
      .catch(() => {
        try {
          const n = new Notification(msg, opcoes)
          n.onclick = () => (window.focus(), (location.hash = hash))
        } catch {}
      })
  }
  avisoNaTela(msg, hash)
}
// aviso dentro do app (some sozinho); serve também quando a notificação não é permitida
function avisoNaTela(msg, hash) {
  let caixa = document.querySelector('.avisos')
  if (!caixa) {
    caixa = Object.assign(document.createElement('div'), { className: 'avisos' })
    caixa.setAttribute('role', 'status')
    caixa.setAttribute('aria-live', 'polite')
    document.body.append(caixa)
  }
  const a = Object.assign(document.createElement('a'), { className: 'aviso-alerta', href: hash, textContent: msg })
  caixa.append(a)
  while (caixa.children.length > 3) caixa.firstElementChild.remove()
  setTimeout(() => a.remove(), 12_000)
}

async function alternarAlertas() {
  ALERTAS.on = !ALERTAS.on
  gravarLocal(`${PREFIXO}alertas:on`, ALERTAS.on ? '1' : '')
  renderizar()
  // a pergunta do navegador pode ficar aberta: os alertas na tela já valem enquanto isso
  if (ALERTAS.on && suportaNotificacao() && Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {}
    renderizar()
  }
}
function quadroAlertas() {
  const perm = suportaNotificacao() ? Notification.permission : 'indisponivel'
  const estadoTxt = !ALERTAS.on
    ? 'Receba um aviso quando um candidato acompanhado mudar de posição, for eleito, entrar ou sair das vagas ou entrar em risco.'
    : perm === 'granted'
      ? 'Alertas ligados: avisamos por notificação (com o app aberto ou em segundo plano) e aqui na tela.'
      : perm === 'denied'
        ? 'Alertas ligados só aqui na tela: as notificações estão bloqueadas para este site nas configurações do navegador.'
        : perm === 'indisponivel'
          ? 'Alertas ligados aqui na tela (este navegador não tem notificações; no iPhone, instale o app na tela de início).'
          : 'Alertas ligados aqui na tela. Permita as notificações para receber também fora do app.'
  return `<section class="cartao alertas ${ALERTAS.on ? 'ligado' : ''}">
    <div class="alertas-linha"><p>${icone('sino')} ${estadoTxt}</p>
    <button type="button" class="botao ${ALERTAS.on ? 'secundario' : ''}" data-alertas>${ALERTAS.on ? '🔕 Desligar alertas' : '🔔 Ativar alertas'}</button></div>
    ${ALERTAS.on ? '<p class="nota">O app confere a cada 30 s enquanto está aberto (em segundo plano, o navegador pode espaçar as conferências). Com o app fechado não há como avisar, porque não há servidor de envio.</p>' : ''}
  </section>`
}
document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-alertas]')) alternarAlertas()
})

/* ---------------- estado e navegação ---------------- */

export const estado = {
  aba: ABAS.find((a) => a.id === (location.hash.slice(1).split('?')[0] || lerLocal('aba', 'inicio'))) || ABAS[0],
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
  // ano da eleição em consulta (2026 = apuração ao vivo; anteriores = resultado oficial, com as mesmas telas)
  ano: [2026, 2024, 2022, 2020, 2018, 2016, 2014, 2012].includes(Number(lerLocal('ano:v1', '2026'))) ? Number(lerLocal('ano:v1', '2026')) : 2026,
  turnoHist: 1, // 1º ou 2º turno nos anos anteriores (governador, prefeito)
}

/* ---------------- ano da eleição: a mesma consulta em todos os anos (2012 a 2026) ---------------- */

const anoAtual = () => estado.ano || 2026
const ehAoVivo = () => anoAtual() === 2026
const ehAnoMunicipal = (a = anoAtual()) => a % 4 === 0
const turnoAtual = () => (ehAoVivo() ? TURNO : estado.turnoHist || 1)
// eleição (t<turno>-c<cargo>) do cargo no ano escolhido
const elDoAno = (cargo) => `t${turnoAtual() === 2 && (cargo === 1 || cargo === 3 || cargo === 11) ? 2 : 1}-c${cargo}`
// id da "aba" que a ficha e os favoritos usam: a própria aba em 2026, ou a eleição anterior (h<ano>-<eleição>)
const abaIdAtual = (aba = estado.aba) => (aba.cargo && !ehAoVivo() ? idHist(anoAtual(), elDoAno(aba.cargo)) : aba.id)
// abrangência da ficha: nos cargos municipais de anos anteriores, o município escolhido
const abrFicha = () => (!ehAoVivo() && estado.aba.municipal ? estado.mun?.cd || FLORIPA_CD : abrAtual())
// abas disponíveis no ano: 2026 = apuração ao vivo; anos anteriores = resultado oficial (gerais ou municipais)
function abasDoAno(ano = anoAtual()) {
  if (ano === 2026) return ABAS.filter((a) => !a.municipal && (a.tipo !== 'h22' || PREF.mostrar2022))
  const municipal = ehAnoMunicipal(ano)
  return ABAS.filter((a) => {
    if (['painel', 'fav', 'camp', 'sobre', 'h22', 'pro'].includes(a.tipo)) return true
    if (['mun', 'bai'].includes(a.tipo)) return false
    if (a.cargo === 1) return false
    return municipal ? !!a.municipal : !a.municipal
  })
}
const rotuloAba = (a) => (a.tipo === 'h22' && !ehAoVivo() ? '🏘️ Bairros e seções' : a.rotulo)
const subtituloAno = (ano = anoAtual()) => (ano === 2026 ? `Eleições Gerais 2026 · ${TURNO}º turno · apuração ao vivo` : `Eleições ${ehAnoMunicipal(ano) ? 'Municipais' : 'Gerais'} ${ano} · resultado oficial do TSE`)
// troca o ano em consulta: as abas, o Início e o explorador de seções passam a seguir esse ano
function definirAno(ano, recarregar = true) {
  if (!ANOS_INICIO().includes(ano) || ano === estado.ano) return
  estado.ano = ano
  estado.anoInicio = ano
  estado.turnoHist = 1
  if (ano !== 2026) H22.ano = ano
  else if (!ANOS_HIST.includes(H22.ano)) H22.ano = 2022
  gravarLocal('ano:v1', String(ano))
  Object.assign(estado, { busca: '', visao: 'candidatos', partido: null, dados: null, anterior: new Map() })
  if (!abasDoAno().includes(estado.aba)) estado.aba = ABAS[0]
  $('.sub').textContent = subtituloAno(ano)
  if (recarregar) {
    montarAbas()
    carregar()
  }
}

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

export const FLORIPA_CD = '81051'
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

// rótulo sem o emoji do começo ("📊 Municípios" → "Municípios")
const semEmoji = (t) => String(t).replace(/^(?:[^\p{L}\p{N}]|ℹ)+\s*/u, '')
const ICONE_ABA = { inicio: 'inicio', favoritos: 'acompanhados', municipios: 'municipios', bairros: 'bairros', analises: 'analises', h2022: 'h2022', sobre: 'sobre' }
function montarAbas() {
  $('#abas').innerHTML = abasDoAno().map((a) => {
    const ic = a.tipo === 'h22' && !ehAoVivo() ? 'bairros' : ICONE_ABA[a.id]
    return `<button role="tab" type="button" data-aba="${a.id}" aria-selected="${a === estado.aba}">${ic ? `${icone(ic)} ${esc(semEmoji(rotuloAba(a)))}` : esc(rotuloAba(a))}${
      a.tipo === 'fav' && favoritos.length ? ` <span class="contador">${favoritos.length}</span>` : ''
    }</button>`
  }).join('')
  $('#abas [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  // anos: 2026 (ao vivo) e as eleições anteriores, gerais e municipais
  const anos = $('#anos')
  if (anos) anos.innerHTML = ANOS_INICIO().map((a) => `<button type="button" role="tab" data-ano="${a}" aria-selected="${a === anoAtual()}" class="${ehAnoMunicipal(a) ? 'mun' : 'ger'}" title="${a === 2026 ? 'Eleições Gerais 2026 · apuração ao vivo' : `Eleições ${ehAnoMunicipal(a) ? 'Municipais' : 'Gerais'} ${a}`}">${a}</button>`).join('')
}

// mouse: a roda rola as abas para os lados quando elas não cabem numa linha (janela estreita)
$('#abas').addEventListener('wheel', (ev) => {
  const n = ev.currentTarget
  if (n.scrollWidth <= n.clientWidth || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return
  ev.preventDefault()
  n.scrollLeft += ev.deltaY
}, { passive: false })
$('#abas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-aba]')
  if (!b) return
  trocarAba(b.dataset.aba)
})
$('#anos')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ano]')
  if (b) definirAno(Number(b.dataset.ano))
})

// usa o endereço do evento: uma renderização pendente da tela anterior pode já ter reescrito location.hash
window.addEventListener('hashchange', (ev) => aplicarLink(new URL(ev.newURL).hash))

/* ---------------- link direto ---------------- */

// O endereço guarda o que está na tela: #<aba>?<parâmetros>. Aba: r = abrangência, m = município ou região,
// z = zona; explorador de seções (Bairros/Histórico): ano, e = eleição, m/z/b/lv/s = lugar, f = candidato;
// ficha: c = candidato, ca = cargo (aba), cr = abrangência, l = lugar dos bairros; comparação: vs/va, v3/v3a, dl.
const CHAVES_FICHA = ['c', 'ca', 'cr', 'l', 'vs', 'va', 'vr', 'v3', 'v3a', 'v3r', 'dl', 'uz']
function lerHash(h = location.hash) {
  const t = h.replace(/^#/, '')
  const i = t.indexOf('?')
  return { id: i < 0 ? t : t.slice(0, i), p: new URLSearchParams(i < 0 ? '' : t.slice(i + 1)) }
}
const hashDe = (id, p) => {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v != null && v !== '' && v !== false)).toString()
  return `#${id}${q ? `?${q}` : ''}`
}
const munDoLink = (m, z) => (!m ? null : m.includes(':') ? regiao(m) : NOME_MUN.get(m) ? { cd: m, nm: NOME_MUN.get(m), zona: z || undefined } : null)

function paramsAba() {
  const a = estado.aba
  const p = {}
  if (a.tipo === 'maj' || a.tipo === 'prop') {
    if (abrAtual() !== a.abrangencias[0]) p.r = abrAtual()
    const m = munAtual()
    if (m) Object.assign(p, { m: m.regiao || m.cd, z: m.zona })
    if (estado.partido) p.p = estado.partido
  }
  if (!ehAoVivo()) {
    p.ano = anoAtual()
    if (estado.turnoHist === 2 && (a.tipo === 'maj' || a.tipo === 'prop')) p.t = 2
  }
  if (a.tipo === 'camp') Object.assign(p, paramsCampanha())
  if (a.tipo === 'bai' || a.tipo === 'h22') {
    const X = estadoLocal()
    if (X.sel && X.sel !== 't1-c7') p.e = X.sel
    const L = X.local
    if (L) Object.assign(p, { m: L.cd, z: L.zona, b: L.bairro, lv: L.localVot, s: L.secao })
    if (X.foco != null) p.f = X.foco
    if (X.vis === 'abst') p.v = 'abst'
    if (a.tipo === 'h22' && H22.mv && H22.mv !== 'votos') p.mv = H22.mv
    if (a.tipo === 'h22') Object.assign(p, { q: H22.busca.trim() || null, st: H22.buscaSit || null, cg: H22.buscaCargo || null, bsc: H22.buscaSC ? 1 : null })
  }
  return p
}
function paramsFicha(det) {
  const p = { c: det.sqcand, ca: det.aba, cr: det.abr !== abaDe(det.aba)?.abrangencias[0] ? det.abr : null, l: det.hist && det.abr !== 'sc' ? null : det.bai?.mun?.id, uz: det.urnas?.zona ?? null }
  if (det.comp) Object.assign(p, { vs: det.comp.sqcand, va: det.comp.aba, vr: det.comp.abr, v3: det.comp.extra?.sq, v3a: det.comp.extra?.aba, v3r: det.comp.extra?.abr, dl: det.comp.dif?.mun?.id })
  return p
}
export const hashDesejado = () => hashDe(estado.aba.id, { ...paramsAba(), ...(estado.detalhe ? paramsFicha(estado.detalhe) : {}) })
// endereço completo para compartilhar o que está na tela
const linkAtual = () => `${location.origin}${location.pathname}${location.search}${hashDesejado()}`

// mantém o endereço em dia sem criar entradas no histórico
function sincronizarLink() {
  if (TELAO.aberto) return
  const h = hashDesejado()
  if (location.hash !== h) history.replaceState(history.state, '', `${location.search}${h}`)
}

// abre o que o endereço pede (ao iniciar, ao colar um link ou ao voltar/avançar)
function aplicarLink(hash = location.hash) {
  const { id, p } = lerHash(hash)
  if (!id) return
  if (id === 'telao') {
    if (!estado.dados) carregar()
    return abrirTelao()
  }
  if (TELAO.aberto) fecharTelao(false)
  let aba = ABAS.find((a) => a.id === id)
  if (!aba) return
  const antesAba = hashDe(estado.aba.id, paramsAba())
  // ano: o do link; sem ele, um link com parâmetros é de 2026 e um simples troca de aba mantém o ano
  const anoLink = p.has('ano') ? Number(p.get('ano')) : [...p.keys()].length ? 2026 : anoAtual()
  if (ANOS_INICIO().includes(anoLink) && anoLink !== anoAtual()) definirAno(anoLink, false)
  if (!ehAoVivo()) estado.turnoHist = p.get('t') === '2' ? 2 : 1
  if (!abasDoAno().includes(aba)) {
    if (!p.has('ano')) definirAno(aba.municipal ? 2024 : 2026, false)
    if (!abasDoAno().includes(aba)) aba = ABAS[0]
  }
  if (aba !== estado.aba) {
    estado.aba = aba
    Object.assign(estado, { busca: '', visao: 'candidatos', partido: null, dados: null, anterior: new Map() })
    gravarLocal('aba', id)
  }
  montarAbas()
  const temParams = [...p.keys()].length > 0
  if (aba.tipo === 'maj' || aba.tipo === 'prop') {
    const r = p.get('r')
    if (r && aba.abrangencias.includes(r)) estado.abr[aba.id] = r
    else if (temParams) delete estado.abr[aba.id]
    if (temParams) {
      estado.mun = munDoLink(p.get('m'), p.get('z'))
      gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(estado.mun))
      estado.partido = p.get('p') || null
      if (estado.partido) estado.visao = 'candidatos'
    }
  }
  if (aba.tipo === 'camp' && temParams) aplicarParamsCampanha(p)
  if ((aba.tipo === 'bai' || aba.tipo === 'h22') && temParams) {
    const X = aba.tipo === 'bai' ? B26 : H22
    if (aba.tipo === 'h22') H22.ano = ANOS_HIST.includes(Number(p.get('ano'))) ? Number(p.get('ano')) : 2022
    X.sel = p.get('e') || 't1-c7'
    const m = p.get('m')
    X.local = m && NOME_MUN.get(m) ? { cd: m, nm: NOME_MUN.get(m), zona: p.get('z') || null, bairro: p.get('b') || null, localVot: p.get('lv') || null, secao: p.get('s') || null } : null
    X.foco = p.get('f') != null && p.get('f') !== '' ? Number(p.get('f')) : null
    X.vis = p.get('v') === 'abst' ? 'abst' : 'votos'
    if (aba.tipo === 'h22') Object.assign(H22, { mv: p.get('mv') || 'votos', busca: p.get('q') || '', buscaSit: p.get('st') || '', buscaCargo: p.get('cg') || null, buscaSC: p.get('bsc') === '1', buscaTodos: false })
    X.grupo = X.local?.secao ? 'secao' : X.local?.localVot ? 'secao' : X.local?.bairro || X.local?.zona ? 'local' : X.local && X.foco != null ? 'bairro' : 'zona'
  }
  if (hashDe(estado.aba.id, paramsAba()) !== antesAba || !estado.dados) {
    estado.dados = null
    carregar()
  }
  // ficha (e comparação)
  const c = p.get('c')
  const det = estado.detalhe
  if (!c) {
    if (det) fecharDetalhe(false)
    return
  }
  // ca: cargo de 2026 (aba) ou eleição anterior (h<ano>-<eleição>); cr: abrangência (nas anteriores, o município)
  const ca = ABAS.find((a) => a.id === p.get('ca') && a.cargo) || abaHist(p.get('ca')) || (aba.cargo ? aba : null)
  if (!ca) return
  const cr = ca.hist ? (ehMunicipal(ca.cargo) && NOME_MUN.get(p.get('cr')) ? p.get('cr') : 'sc') : ca.abrangencias.includes(p.get('cr')) ? p.get('cr') : ca.abrangencias[0]
  if (!det || det.sqcand !== c || det.aba !== ca.id || det.abr !== cr) {
    if (det) fecharDetalhe(false)
    abrirDetalhe({ aba: ca.id, abr: cr, sqcand: c, substituir: true })
  }
  const d2 = estado.detalhe
  const l = p.get('l')
  if (l) d2.bai = { mun: lugarBairros(l), modo: 'v', todos: false, painel: false, busca: '', grupo: 'bairro' }
  const uz = p.get('uz')
  if (uz) d2.urnas = { ord: 'v', busca: '', todos: false, vis: 'urnas', zona: Number(uz), ordZ: 'v' }
  const vs = p.get('vs')
  if (vs) {
    // o outro candidato pode ser de um cargo de 2026 ou de uma eleição anterior (vr/v3r: município)
    const abaLink = (id) => (ABAS.find((a) => a.id === id && a.cargo) || abaHist(id))?.id || null
    const va = abaLink(p.get('va'))
    const vr = va && ehAbaHist(va) ? p.get('vr') || 'sc' : null
    if (d2.comp?.sqcand !== vs || (d2.comp?.aba || null) !== va)
      d2.comp = { sqcand: vs, aba: va, abr: vr, porMun: null, dif: null }
    const v3 = p.get('v3')
    const v3a = abaLink(p.get('v3a'))
    d2.comp.extra = v3 ? { sq: v3, aba: v3a, abr: v3a && ehAbaHist(v3a) ? p.get('v3r') || 'sc' : null } : null
    const dl = p.get('dl')
    if (dl) {
      const L = lugarBairros(dl)
      d2.comp.dif = { grupo: L?.cds.length > 1 ? 'mun' : 'zona', modo: 'w0', mun: L, painel: false, busca: '', todos: false }
    }
    for (const x of [va, v3a]) if (x) carregarListaComp(d2, x)
  } else d2.comp = null
  d2.escolhendo = false
  renderDetalhe()
}

// copia (ou compartilha, no celular) o link do que está na tela
async function copiarLink(botao) {
  const url = linkAtual()
  const ok = () => {
    if (!botao) return
    const antes = botao.innerHTML
    botao.innerHTML = `${icone('link')} Link copiado!`
    setTimeout(() => (botao.innerHTML = antes), 2500)
  }
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      return await navigator.share({ url, title: document.title })
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    ok()
  } catch {
    window.prompt('Copie o link:', url)
  }
}
const botaoLink = (classe = 'botao secundario') => `<button type="button" class="${classe}" data-copiar-link>${icone('link')} Copiar link</button>`
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-copiar-link]')
  if (b) copiarLink(b)
})

/* ---------------- busca única ---------------- */

// Um campo para achar qualquer coisa: candidatos de 2026 (todos os cargos) e das eleições anteriores,
// municípios, associações de municípios e bairros. O resultado abre pelo link direto.
const BUSCA = { aberta: false, termo: '', listas: new Map(), bairros: null, ativo: 0 }
const buscaEl = document.createElement('div')
buscaEl.className = 'busca-global'
buscaEl.hidden = true
buscaEl.setAttribute('role', 'dialog')
buscaEl.setAttribute('aria-modal', 'true')
buscaEl.setAttribute('aria-label', 'Buscar no app')
document.body.appendChild(buscaEl)

const ABAS_BUSCA = () => ABAS.filter((a) => a.cargo && a.abrangencias.includes(UF))
function abrirBusca() {
  BUSCA.aberta = true
  BUSCA.ativo = 0
  buscaEl.hidden = false
  document.documentElement.classList.add('com-busca')
  buscaEl.innerHTML = `<div class="bg-caixa">
    <div class="bg-topo">${icone('busca')}<input id="bg-input" type="search" autocomplete="off" enterkeyhint="go" placeholder="Candidato, número, partido, município, associação ou bairro…" value="${esc(BUSCA.termo)}" aria-controls="bg-res"><button type="button" class="bg-fechar" data-bg-fechar aria-label="Fechar">✕</button></div>
    <div id="bg-res" class="bg-res" role="listbox"></div></div>`
  const inp = $('#bg-input')
  inp.focus()
  inp.select()
  // candidatos de 2026 de todos os cargos de SC (os que já estão carregados vêm na hora)
  for (const aba of ABAS_BUSCA()) {
    if (BUSCA.listas.has(aba.id)) continue
    const d = dadosCarregados(aba.id, UF)
    if (d) BUSCA.listas.set(aba.id, d)
    else {
      BUSCA.listas.set(aba.id, null)
      buscar(aba, UF, TURNO)
        .then((x) => (BUSCA.listas.set(aba.id, x), BUSCA.aberta && desenharBusca()))
        .catch(() => BUSCA.listas.delete(aba.id))
    }
  }
  desenharBusca()
}
function fecharBusca() {
  BUSCA.aberta = false
  buscaEl.hidden = true
  buscaEl.innerHTML = ''
  document.documentElement.classList.remove('com-busca')
}

// carrega o que só faz sentido buscar com um termo (eleições anteriores e bairros)
function carregarExtrasBusca() {
  for (const ano of ANOS_HIST) {
    const X = histDe(ano)
    if (!X.resumo && !X.carregando) resumoAno(ano).then(() => BUSCA.aberta && desenharBusca()).catch(() => {})
  }
  if (!BUSCA.bairros) {
    BUSCA.bairros = []
    fetch(`dados2026/bairros-t1-c7.json?v=${VERSAO}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return
        const vistos = new Set()
        BUSCA.bairros = j.b.filter(([cd, nome]) => nome && nome !== 'Bairro não informado' && !vistos.has(cd + nome) && vistos.add(cd + nome)).map(([cd, nome, val]) => ({ cd, nome, val, chave: semAcento(`${nome} ${NOME_MUN.get(cd) || ''}`) }))
        if (BUSCA.aberta) desenharBusca()
      })
      .catch(() => {})
  }
}

// todas as palavras do termo aparecem no texto; quem começa com o termo vem antes
const casa = (texto, palavras) => palavras.every((p) => texto.includes(p))
function resultadosBusca(termo) {
  const t = semAcento(termo.trim())
  const palavras = t.split(/\s+/).filter(Boolean)
  if (!palavras.length) return []
  const num = /^\d+$/.test(t)
  const grupos = []
  const peso = (nome) => (semAcento(nome).startsWith(t) ? 0 : 1)
  // 2026
  const c26 = []
  for (const aba of ABAS_BUSCA()) {
    const d = BUSCA.listas.get(aba.id)
    if (!d?.candidatos) continue
    for (const c of d.candidatos) {
      const txt = semAcento(`${c.nome} ${c.nomeCompleto || ''} ${c.partido} ${c.numero}`)
      if (num ? String(c.numero) === t : casa(txt, palavras)) c26.push({ c, aba, p: peso(c.nome) })
    }
  }
  c26.sort((a, b) => a.p - b.p || b.c.votos - a.c.votos)
  const ehAba = estado.aba.tipo === 'maj' || estado.aba.tipo === 'prop'
  if (c26.length)
    grupos.push({
      rot: 'Candidatos 2026',
      itens: c26.slice(0, 8).map(({ c, aba }) => ({
        hash: hashDe(estado.aba.id, { ...paramsAba(), c: c.sqcand, ca: aba.id }),
        cor: corPartido(c.partido),
        tit: c.nome,
        sub: `${aba.rotulo.replace(/ SC$/, '')} · ${c.partido} · nº ${c.numero} · ${fmt.format(c.votos)} votos`,
      })),
    })
  // eleições anteriores
  if (t.length >= 3) {
    const ant = []
    for (const ano of ANOS_HIST) {
      const R = histDe(ano).resumo
      if (!R) continue
      for (const el of R.eleicoes)
        for (const c of el.candidatos) {
          if (num ? String(c.numero) !== t : !casa(semAcento(`${c.nome} ${c.nomeCompleto} ${c.partido}`), palavras)) continue
          if (num && ehMunicipal(el.cargo)) continue // número de vereador/prefeito se repete em cada cidade
          ant.push({ ano, el, c, p: peso(c.nome) })
        }
    }
    ant.sort((a, b) => a.p - b.p || b.ano - a.ano || b.c.votos - a.c.votos)
    if (ant.length)
      grupos.push({
        rot: 'Eleições anteriores',
        itens: ant.slice(0, 8).map(({ ano, el, c }) => ({
          // abre a ficha do candidato naquela eleição (por cima do explorador do 📅 Histórico)
          hash: hashDe('h2022', { ano, e: el.id, m: c.cd, f: c.numero, c: c.sq, ca: idHist(ano, el.id), cr: c.cd }),
          cor: corPartido(c.partido),
          tit: c.nome,
          sub: `${ano} · ${el.nome}${el.turno === 2 ? ' (2º turno)' : ''}${c.cd ? ` · ${NOME_MUN.get(c.cd) || ''}` : ''} · ${c.partido} · ${fmt.format(c.votos)} votos${c.sit ? ` · ${situ2022(c.sit).replace(/<[^>]+>/g, '').trim()}` : ''}`,
        })),
      })
  }
  if (!num) {
    const abaMun = ehAba ? estado.aba.id : 'depest'
    const mun = MUNICIPIOS_SC.filter((m) => casa(semAcento(m[2]), palavras)).sort((a, b) => peso(a[2]) - peso(b[2]))
    if (mun.length)
      grupos.push({
        rot: 'Municípios',
        itens: mun.slice(0, 8).map((m) => ({
          hash: hashDe(abaMun, { m: m[0] }),
          tit: m[2],
          sub: `${ASSOCIACAO_MUN[m[0]] ? `${ASSOCIACAO_MUN[m[0]]} · ` : ''}resultado de ${ABAS.find((a) => a.id === abaMun).rotulo.replace(/ SC$/, '')}`,
          extra: { hash: hashDe('bairros', { m: m[0] }), rot: '🏘️ Bairros e seções' },
        })),
      })
    const assoc = Object.entries(ASSOCIACOES).filter(([sg, nm]) => casa(semAcento(`${sg} ${nm}`), palavras))
    if (assoc.length)
      grupos.push({
        rot: 'Associações de municípios',
        itens: assoc.slice(0, 8).map(([sg, nm]) => ({ hash: hashDe(abaMun, { m: `assoc:${sg}` }), tit: `${sg} · ${nm}`, sub: `${regiao(`assoc:${sg}`)?.membros.length || 0} municípios` })),
      })
    if (t.length >= 3 && BUSCA.bairros?.length) {
      const bs = BUSCA.bairros.filter((b) => casa(b.chave, palavras)).sort((a, b) => peso(a.nome) - peso(b.nome) || b.val - a.val)
      if (bs.length)
        grupos.push({
          rot: 'Bairros',
          itens: bs.slice(0, 8).map((b) => ({ hash: hashDe('bairros', { m: b.cd, b: b.nome }), tit: b.nome, sub: `${NOME_MUN.get(b.cd) || b.cd} · ${fmt.format(b.val)} votos válidos (Dep. Estadual)` })),
        })
    }
  }
  return grupos
}

function desenharBusca() {
  const res = $('#bg-res')
  if (!res) return
  const termo = BUSCA.termo.trim()
  if (termo.length >= 3) carregarExtrasBusca()
  if (!termo) {
    res.innerHTML = `<p class="nota bg-dica">Busque por nome, número ou partido de candidatos (2026 e eleições de ${ANOS_HIST[ANOS_HIST.length - 1]} a ${ANOS_HIST[0]}), por município, associação de municípios (ex.: AMFRI) ou bairro. Atalho: tecla <kbd>/</kbd>.</p>`
    return
  }
  const grupos = resultadosBusca(termo)
  const carregando = [...BUSCA.listas.values()].some((x) => x === null) || (termo.length >= 3 && ANOS_HIST.some((a) => !histDe(a).resumo))
  let i = 0
  res.innerHTML =
    grupos
      .map(
        (g) => `<div class="bg-grupo" data-bg-grupo="${esc(g.rot)}"><h3>${esc(g.rot)}</h3>${g.itens
          .map(
            (x) => `<div class="bg-item${i === BUSCA.ativo ? ' ativo' : ''}"${x.cor ? ` style="${estiloCor(x.cor)}"` : ''}><a href="${esc(x.hash)}" role="option" data-bg-i="${i++}" aria-selected="${i - 1 === BUSCA.ativo}"><strong>${esc(x.tit)}</strong><small>${esc(x.sub)}</small></a>${
              x.extra ? `<a class="bg-extra" href="${esc(x.extra.hash)}">${esc(x.extra.rot)}</a>` : ''
            }</div>`,
          )
          .join('')}</div>`,
      )
      .join('') + (carregando ? '<p class="nota bg-dica">Carregando mais resultados…</p>' : grupos.length ? '' : '<p class="nota bg-dica">Nada encontrado.</p>')
  BUSCA.total = i
}

buscaEl.addEventListener('input', (ev) => {
  if (ev.target.id !== 'bg-input') return
  BUSCA.termo = ev.target.value
  BUSCA.ativo = 0
  desenharBusca()
})
buscaEl.addEventListener('click', (ev) => {
  if (ev.target === buscaEl || ev.target.closest('[data-bg-fechar]')) return fecharBusca()
  // links: o hashchange abre o destino (aplicarLink)
  const a = ev.target.closest('a[href^="#"]')
  if (a) {
    ev.preventDefault()
    fecharBusca()
    location.hash = a.getAttribute('href')
  }
})
buscaEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') return fecharBusca()
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault()
    BUSCA.ativo = Math.max(0, Math.min((BUSCA.total || 1) - 1, BUSCA.ativo + (ev.key === 'ArrowDown' ? 1 : -1)))
    desenharBusca()
    buscaEl.querySelector('.bg-item.ativo')?.scrollIntoView({ block: 'nearest' })
  }
  if (ev.key === 'Enter') {
    const a = buscaEl.querySelector(`[data-bg-i="${BUSCA.ativo}"]`)
    if (a) {
      ev.preventDefault()
      fecharBusca()
      location.hash = a.getAttribute('href')
    }
  }
})
document.addEventListener('keydown', (ev) => {
  if (ev.key !== '/' || BUSCA.aberta || ev.ctrlKey || ev.metaKey) return
  if (ev.target.closest?.('input, textarea, select, [contenteditable]')) return
  ev.preventDefault()
  abrirBusca()
})
$('#buscar-tudo').innerHTML = icone('busca')
$('#buscar-tudo').addEventListener('click', () => abrirBusca())
document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-abrir-busca]')) return abrirBusca()
  if (ev.target.closest('[data-ext-toggle]')) {
    gravarLocal('inicio:ext', lerLocal('inicio:ext', '1') === '1' ? '0' : '1')
    return renderizar()
  }
  const t = ev.target.closest('[data-turno-hist]')
  if (t) {
    estado.turnoHist = Number(t.dataset.turnoHist) === 2 ? 2 : 1
    estado.dados = null
    return carregar()
  }
  const b = ev.target.closest('[data-inicio-ano]')
  if (!b) return
  definirAno(Number(b.dataset.inicioAno))
})

export function trocarAba(id) {
  const aba = ABAS.find((a) => a.id === id)
  if (!aba) return
  if (!abasDoAno().includes(aba)) {
    definirAno(aba.municipal ? 2024 : 2026, false)
    if (!abasDoAno().includes(aba)) return
  }
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

$('#atualizar').innerHTML = icone('atualizar')
$('#atualizar').setAttribute('aria-label', 'Atualizar agora')
$('#atualizar').addEventListener('click', () => carregar())

/* ---------------- ciclo de atualização ---------------- */

export async function carregar() {
  clearTimeout(estado.timer)
  estado.controlador?.abort()
  const ctrl = new AbortController()
  estado.controlador = ctrl
  const aba = estado.aba
  const abr = abrAtual()
  statusEl.textContent = 'Atualizando…'
  statusEl.className = 'status carregando'
  if (!estado.dados) conteudo.innerHTML = (['fav', 'mun', 'h22', 'bai', 'camp', 'pro', 'sobre', 'painel'].includes(aba.tipo) ? '' : cabecalhoAbrangencia()) + esqueleto(`Carregando ${semEmoji(aba.rotulo)}${munAtual() ? ` em ${munAtual().nm}` : ''}…`, munAtual()?.regiao ? '<small id="progresso-regiao" class="mudo"></small>' : '')
  if (aba.tipo === 'fav') return carregarFavoritos(ctrl)
  if (aba.tipo === 'painel') return carregarPainel(ctrl)
  if (aba.tipo === 'mun') return carregarPainelMunicipios(ctrl)
  if (aba.tipo === 'h22') {
    if (!PREF.mostrar2022) return trocarAba('presidente')
    return carregar2022(ctrl)
  }
  if (aba.tipo === 'bai') return carregarBairros(ctrl)
  if (aba.tipo === 'camp') return carregarCampanha(ctrl)
  if (aba.tipo === 'pro') return carregarPro(ctrl)
  if (aba.tipo === 'sobre') {
    estado.dados = { sobre: true }
    renderizar()
    statusEl.textContent = 'Sobre o app'
    statusEl.className = 'status ok'
    return
  }
  if (!ehAoVivo()) return carregarHist(ctrl)
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

// acompanhados de eleições anteriores: o resultado oficial daquela eleição (não há apuração)
async function juntarFavHist(mapa) {
  const ks = new Set(favoritos.filter((f) => ehAbaHist(f.aba)).map((f) => `${f.aba}|${f.abr}`))
  await Promise.allSettled(
    [...ks].map(async (k) => {
      const [id, abr] = k.split('|')
      await resumoAno(abaHist(id).ano)
      const d = dadosHist(id, abr)
      if (d) mapa.set(k, d)
    }),
  )
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
  await juntarFavHist(estado.favDados)
  if (ctrl.signal.aborted) return
  estado.dados = { fav: true, final: false }
  renderizar()
  statusEl.textContent = erros ? 'Erro ao atualizar' : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`
  statusEl.className = erros ? 'status erro' : 'status ok'
  if (estado.controlador === ctrl) agendar()
}

/* ---------------- Início: visão geral de SC e dos acompanhados ---------------- */

const CARGOS_PAINEL = ['governador', 'senador', 'depfed', 'depest']

async function carregarPainel(ctrl) {
  const grupos = new Map()
  for (const f of favoritos) {
    const aba = ABAS.find((a) => a.id === f.aba)
    if (aba?.cargo) grupos.set(`${f.aba}|${f.abr}`, { aba, abr: f.abr })
  }
  const res = await Promise.allSettled([...grupos.entries()].map(async ([k, g]) => [k, await buscar(g.aba, g.abr, TURNO, ctrl.signal)]))
  // 2º turno para Presidente (Brasil e SC), em qualquer visão do Início de 2026
  const abaPres = ABAS.find((a) => a.id === 'presidente')
  const pres2 = {}
  await Promise.all(['br', 'zz', ...ESTADOS.map(([uf]) => uf)].map(async (abr) => {
    try {
      pres2[abr] = await buscar(abaPres, abr, 2, ctrl.signal)
    } catch (e) {
      pres2[abr] = e instanceof NaoDivulgado ? null : false // null = ainda não divulgado · false = erro
    }
  }))
  if (ctrl.signal.aborted) return
  estado.pres2 = pres2
  await Promise.all([carregarExterior(ctrl.signal).catch(() => {}), carregarBoletins().catch(() => {})])
  if (ctrl.signal.aborted) return
  estado.favDados = new Map()
  let erros = 0
  for (const r of res) {
    if (r.status === 'fulfilled') {
      const [k, d] = r.value
      const [abaId, abr] = k.split('|')
      registrarHistorico(abaId, abr, d)
      registrarSessao(abaId, abr, null, d)
      estado.favDados.set(k, d)
    } else if (!(r.reason instanceof NaoDivulgado) && r.reason?.name !== 'AbortError') erros++
  }
  await juntarFavHist(estado.favDados)
  if (ctrl.signal.aborted) return
  estado.dados = { painel: true, final: !!pres2.br?.final }
  renderizar()
  statusEl.textContent = !ehAoVivo() ? `Resultado oficial · TSE ${anoAtual()}` : erros ? 'Erro ao atualizar' : estado.dados.final ? 'Apuração encerrada' : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`
  statusEl.className = erros && ehAoVivo() ? 'status erro' : 'status ok'
  if (estado.controlador === ctrl && !estado.dados.final && ehAoVivo()) agendar()
}

// os 27 estados (sigla do TSE, nome, região), para acompanhar a apuração de Presidente em cada um
const ESTADOS = [
  ['ac', 'Acre', 'Norte'], ['am', 'Amazonas', 'Norte'], ['ap', 'Amapá', 'Norte'], ['pa', 'Pará', 'Norte'], ['ro', 'Rondônia', 'Norte'], ['rr', 'Roraima', 'Norte'], ['to', 'Tocantins', 'Norte'],
  ['al', 'Alagoas', 'Nordeste'], ['ba', 'Bahia', 'Nordeste'], ['ce', 'Ceará', 'Nordeste'], ['ma', 'Maranhão', 'Nordeste'], ['pb', 'Paraíba', 'Nordeste'], ['pe', 'Pernambuco', 'Nordeste'], ['pi', 'Piauí', 'Nordeste'], ['rn', 'Rio Grande do Norte', 'Nordeste'], ['se', 'Sergipe', 'Nordeste'],
  ['df', 'Distrito Federal', 'Centro-Oeste'], ['go', 'Goiás', 'Centro-Oeste'], ['ms', 'Mato Grosso do Sul', 'Centro-Oeste'], ['mt', 'Mato Grosso', 'Centro-Oeste'],
  ['es', 'Espírito Santo', 'Sudeste'], ['mg', 'Minas Gerais', 'Sudeste'], ['rj', 'Rio de Janeiro', 'Sudeste'], ['sp', 'São Paulo', 'Sudeste'],
  ['pr', 'Paraná', 'Sul'], ['rs', 'Rio Grande do Sul', 'Sul'], ['sc', 'Santa Catarina', 'Sul'],
]

// 2º turno no exterior: resultado de cada cidade (zona do exterior) no TSE, só depois que ele começa a divulgar
const EXT = { cidades: new Map() } // código da cidade → dados normalizados | null
async function carregarExterior(signal) {
  if (Date.now() < PUBLICACAO_TSE) return
  const aba = ABAS.find((a) => a.id === 'presidente')
  const pend = EXTERIOR.flatMap(([, , cs]) => cs).filter((cd) => !EXT.cidades.get(cd)?.final)
  let i = 0
  const trabalhador = async () => {
    while (i < pend.length && !signal?.aborted) {
      const cd = pend[i++]
      try {
        EXT.cidades.set(cd, await buscar(aba, 'zz', 2, signal, { cd: String(cd), nm: '' }))
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        if (!EXT.cidades.has(cd)) EXT.cidades.set(cd, null)
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, trabalhador))
}

// boletins de urna do Brasil e do exterior já lidos pelo workflow (public/dados2026/pres2.json), se existir
async function carregarBoletins() {
  try {
    const r = await fetch(`dados2026/pres2.json?t=${Math.floor(Date.now() / 60_000)}`)
    estado.boletins = r.ok ? await r.json() : null
  } catch {
    estado.boletins = null
  }
}

// eleitos (TSE) ou, enquanto não definido, os eleitos pela projeção, agrupados por partido
export function cadeirasPorPartido(d) {
  const eleitos = d.candidatos.filter((c) => c.eleito || (!d.tseDefinido && c.projecao))
  const g = new Map()
  for (const c of eleitos) g.set(c.partido, [...(g.get(c.partido) || []), c])
  return { eleitos, partidos: [...g.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])) }
}

// Início: escolha do ano (2026 ao vivo; anos anteriores com o resumo de cada eleição)
const ANOS_INICIO = () => [2026, ...ANOS_HIST]
const tipoAno = (a) => (a % 4 === 0 ? 'Municipais' : 'Gerais')
function heroInicio(ano) {
  return `<section class="cartao hero">
    <p class="hero-chapeu">Santa Catarina · resultados oficiais do TSE</p>
    <h2>Eleições em SC · ${ANOS_HIST[ANOS_HIST.length - 1]} a 2026</h2>
    <p class="hero-sub">Escolha a eleição: as gerais (presidente, governador, senado e deputados) e as municipais (prefeito e vereador).</p>
    <div class="hero-anos" role="tablist" aria-label="Ano da eleição">${ANOS_INICIO()
      .map((a) => `<button type="button" role="tab" data-inicio-ano="${a}" aria-selected="${a === ano}" class="${tipoAno(a) === 'Municipais' ? 'mun' : 'ger'}"><strong>${a}</strong><small>${a === 2026 ? 'Gerais · ao vivo' : tipoAno(a)}</small></button>`)
      .join('')}</div>
    <button type="button" class="hero-busca" data-abrir-busca>${icone('busca')} Buscar candidato, cidade, bairro…</button>
  </section>`
}
function renderPainel() {
  const ano = anoAtual()
  if (ano !== 2026) return heroInicio(ano) + renderPainelAno(ano)
  return heroInicio(ano) + renderPainel2026()
}

// resumo de um ano anterior (geral ou municipal), com atalhos para o Histórico
function renderPainelAno(ano) {
  const R = histDe(ano).resumo
  if (!R) {
    resumoAno(ano).then(() => estado.aba.tipo === 'painel' && renderizar()).catch(() => {})
    return esqueleto(`Carregando as eleições de ${ano}…`)
  }
  return R.municipal ? painelMunicipal(ano, R) : painelGeral(ano, R)
}
const linkH = (ano, q = {}) => hashDe('h2022', { ano, ...q })
function painelGeral(ano, R) {
  const el = (t, c) => R.eleicoes.find((e) => e.turno === t && e.cargo === c)
  const blocoMaj = (e, titulo, n) => {
    if (!e) return ''
    const lista = e.candidatos.slice(0, n)
    const max = Math.max(1, ...lista.map((c) => c.votos))
    return `<section class="cartao painel-maj"><h3><a href="${linkH(ano, { e: e.id })}" class="link-aba">${esc(titulo)}</a></h3>
      <ol class="painel-lista">${lista
        .map((c, i) => `<li style="${estiloCor(corPartido(c.partido))}"><span class="pos">${i + 1}º</span><div class="painel-info"><div><strong>${esc(c.nome)}</strong> ${pill(c.partido)} ${/^ELEITO/.test(c.sit) ? '<span class="pp-sit">✔ eleito</span>' : c.sit === '2º TURNO' ? '<span class="pp-sit">2º turno</span>' : ''}</div>
          <div class="barra fina"><span style="width:${(100 * c.votos) / max}%"></span></div></div><div class="painel-num"><strong>${fmtPct.format(pctDe(c.votos, e.validos))}%</strong><small>${fmt.format(c.votos)}</small></div></li>`)
        .join('')}</ol></section>`
  }
  const blocoProp = (e, titulo) => {
    if (!e) return ''
    const eleitos = e.candidatos.filter((c) => /^ELEITO/.test(c.sit))
    const porP = new Map()
    for (const c of eleitos) porP.set(c.partido, (porP.get(c.partido) || 0) + 1)
    const partidos = [...porP.entries()].sort((a, b) => b[1] - a[1])
    const vagas = eleitos.length || 1
    return `<section class="cartao painel-cadeiras"><h3><a href="${linkH(ano, { e: e.id })}" class="link-aba">${esc(titulo)}</a> <span class="mudo">· ${eleitos.length} vagas</span></h3>
      <div class="cadeiras">${partidos.map(([p, n]) => `<span style="width:${(100 * n) / vagas}%;background:${corPartido(p)}" title="${esc(p)}: ${n}"></span>`).join('')}</div>
      <div class="cadeiras-leg">${partidos.map(([p, n]) => `<span class="tag" style="${estiloCor(corPartido(p))}">${pill(p)} <strong>${n}</strong></span>`).join('')}</div>
      <details class="painel-eleitos"><summary>Ver os ${eleitos.length} eleitos</summary><ul>${eleitos.map((c) => `<li><strong>${esc(c.nome)}</strong> ${pill(c.partido)} <span class="mudo">${fmt.format(c.votos)}</span></li>`).join('')}</ul></details>
    </section>`
  }
  const gov = el(2, 3) || el(1, 3)
  const govEleito = gov?.candidatos.find((c) => /^ELEITO/.test(c.sit))
  const senEleitos = el(1, 5)?.candidatos.filter((c) => /^ELEITO/.test(c.sit)) || []
  const topo = `<section class="cartao painel-topo"><div class="resumo-titulo"><h2>Eleições gerais ${ano} · SC</h2><span class="selo final">Resultado oficial</span></div>
      <div class="calc-num">
        ${govEleito ? `<div><span>Governador eleito</span><strong>${esc(govEleito.nome)}</strong><small>${esc(govEleito.partido)}${el(2, 3) ? ' · 2º turno' : ''}</small></div>` : ''}
        ${senEleitos.length ? `<div><span>Senado</span><strong>${senEleitos.map((c) => esc(c.nome)).join(', ')}</strong><small>${senEleitos.map((c) => esc(c.partido)).join(', ')}</small></div>` : ''}
      </div></section>`
  return topo + (el(2, 3) ? blocoMaj(el(2, 3), 'Governador · 2º turno', 2) : '') + blocoMaj(el(1, 3), 'Governador · 1º turno', 4) + blocoMaj(el(1, 5), 'Senado', 4) +
    blocoProp(el(1, 6), 'Dep. Federal') + blocoProp(el(1, 7), 'Dep. Estadual') +
    `<section class="cartao"><h3>Explorar ${ano}</h3><div class="painel-atalhos">
      <a href="${linkH(ano)}">${icone('h2022')}<strong>Votos por cidade</strong><small>zona, bairro, local e seção</small></a>
      <a href="${linkH(ano, { e: 't1-c7' })}">${icone('bairros')}<strong>Dep. Estadual</strong><small>todos os candidatos</small></a>
      <a href="${linkH(ano, { e: 't1-c6' })}">${icone('bairros')}<strong>Dep. Federal</strong><small>todos os candidatos</small></a>
      <a href="${linkH(ano, { e: 't1-c3' })}">${icone('municipios')}<strong>Abstenção</strong><small>brancos e nulos por município</small></a>
    </div></section>`
}
function painelMunicipal(ano, R) {
  const M = dadosPrefeitos(ano)
  if (!M.valor) return M.erro ? '<section class="cartao vazio">O resultado por município ainda não está no app.</section>' : esqueleto(`Carregando as eleições de ${ano}…`)
  const pfs = M.valor._pf
  const porP = new Map()
  for (const x of pfs) porP.set(x.p, (porP.get(x.p) || 0) + 1)
  const partidos = [...porP.entries()].sort((a, b) => b[1] - a[1])
  const cad = new Map()
  let nVer = 0
  for (const [cd, o] of Object.entries(M.valor)) if (cd !== '_pf' && o.cam) for (const e of o.cam.el) ((nVer += 1), cad.set(e[2], (cad.get(e[2]) || 0) + 1))
  const cadP = [...cad.entries()].sort((a, b) => b[1] - a[1])
  const reeleitos = pfs.filter((x) => x.ree).length
  // perfil (mulheres eleitas)
  const P = arquivoAno(`dados${ano}/perfil.json`)
  let mulheres = ''
  if (P.valor) {
    const fem = P.valor.dic.g.indexOf('FEMININO')
    const ver = R.eleicoes.find((e) => e.cargo === 13)?.candidatos.filter((c) => /^ELEITO/.test(c.sit)) || []
    const fv = ver.filter((c) => P.valor.c[c.sq]?.[1] === fem).length
    const fp = pfs.filter((x) => P.valor.c[x.sq]?.[1] === fem).length
    mulheres = `<div><span>Mulheres eleitas</span><strong>${fmtPct.format(pctDe(fv + fp, ver.length + pfs.length))}%</strong><small>${fp} prefeitas · ${fv} vereadoras</small></div>`
  }
  const barraP = (lista, total) => `<div class="cadeiras">${lista.map(([p, n]) => `<span style="width:${(100 * n) / total}%;background:${corPartido(p)}" title="${esc(p)}: ${n}"></span>`).join('')}</div>
      <div class="cadeiras-leg">${lista.slice(0, 12).map(([p, n]) => `<span class="tag" style="${estiloCor(corPartido(p))}">${pill(p)} <strong>${fmt.format(n)}</strong></span>`).join('')}</div>`
  const maiores = [...pfs].sort((a, b) => (M.valor[b.cd]?.ap?.[0] || 0) - (M.valor[a.cd]?.ap?.[0] || 0)).slice(0, 12)
  const top = partidos.slice(0, 8)
  const card = {
    chapeu: `ELEIÇÕES ${ano} · SANTA CATARINA`, nome: `Eleições municipais ${ano}`, cor: corPartido(top[0]?.[0]), sub: `${pfs.length} prefeitos · ${fmt.format(nVer)} vereadores · ${reeleitos} prefeitos reeleitos`,
    titulo: 'Prefeituras por partido', subtitulo: 'Santa Catarina', fonte: `Fonte: TSE · resultado ${ano}`,
    total: { rot: 'Municípios de SC', valor: `${pfs.length} prefeituras`, sub: `${reeleitos} reeleitos` },
    linhas: top.map(([p, n]) => ({ ponto: corPartido(p), nome: p, extra: `${fmtPct.format(pctDe(n, pfs.length))}% das prefeituras · ${fmt.format(cad.get(p) || 0)} vereadores`, valor: `${n}`, frac: n / top[0][1], corBarra: corPartido(p) })),
  }
  return `<section class="cartao painel-topo"><div class="resumo-titulo"><h2>Eleições municipais ${ano} · SC</h2><span class="selo final">Resultado oficial</span></div>
      <div class="calc-num">
        <div><span>Prefeitos eleitos</span><strong>${pfs.length}</strong><small>${reeleitos} reeleitos</small></div>
        <div><span>Vereadores eleitos</span><strong>${fmt.format(nVer)}</strong><small>${cad.size} partidos</small></div>
        <div><span>Partido com mais prefeituras</span><strong>${esc(partidos[0]?.[0] || '—')}</strong><small>${partidos[0]?.[1] || 0} prefeituras</small></div>
        ${mulheres}
      </div>
      <div class="exportar">${botaoCard(`inicio-${ano}`, card, `${icone('compartilhar')} Compartilhar resumo de ${ano}`, 'botao secundario')}</div></section>
    <section class="cartao painel-cadeiras"><h3><a href="${linkH(ano, { mv: 'prefeitos' })}" class="link-aba">🏛️ Prefeituras por partido</a> <span class="mudo">· ${pfs.length}</span></h3>${barraP(partidos, pfs.length)}
      <a class="botao secundario" href="${linkH(ano, { mv: 'prefeitos' })}">Ver o mapa e todos os prefeitos ›</a></section>
    <section class="cartao painel-maj"><h3>Prefeitos das maiores cidades</h3>
      <ol class="painel-lista">${maiores
        .map((x) => `<li style="${estiloCor(corPartido(x.p))}"><a class="painel-cidade" href="${linkH(ano, { m: x.cd })}"><div class="painel-info"><div><strong>${esc(x.nm)}</strong> · ${esc(x.n)} ${pill(x.p)}${x.ree ? ' <span class="pp-sit">reeleito</span>' : ''}</div>
          <div class="barra fina"><span style="width:${x.pct}%"></span></div></div><div class="painel-num"><strong>${fmtPct.format(x.pct)}%</strong><small>${fmt.format(x.v)}</small></div></a></li>`)
        .join('')}</ol></section>
    <section class="cartao painel-cadeiras"><h3><a href="${linkH(ano, { mv: 'camaras' })}" class="link-aba">🪑 Vereadores por partido</a> <span class="mudo">· ${fmt.format(nVer)} cadeiras</span></h3>${barraP(cadP, nVer)}
      <a class="botao secundario" href="${linkH(ano, { mv: 'camaras' })}">Ver as câmaras e os mais votados ›</a></section>
    <section class="cartao"><h3>Explorar ${ano}</h3><div class="painel-atalhos">
      <a href="${linkH(ano, { mv: 'prefeitos' })}">${icone('municipios')}<strong>Prefeitos</strong><small>mapa e os 295 municípios</small></a>
      <a href="${linkH(ano, { mv: 'camaras' })}">${icone('analises')}<strong>Câmaras</strong><small>vereadores eleitos e quociente</small></a>
      <a href="${linkH(ano, { mv: 'perfil' })}">${icone('perfil')}<strong>Perfil</strong><small>mulheres, idade, escolaridade, bens</small></a>
      <a href="${linkH(ano)}">${icone('bairros')}<strong>Votos por cidade</strong><small>zona, bairro, local e seção</small></a>
    </div></section>`
}

function renderPainel2026() {
  const D = (id) => estado.favDados?.get(`${id}|${UF}`)
  const ref = D('governador') || D('depfed') || D('depest')
  const topo = `<section class="cartao painel-topo">
      <div class="resumo-titulo"><h2>Eleições 2026 · Santa Catarina</h2>${ref ? `<span class="selo ${ref.final ? 'final' : ''}">${ref.final ? 'Totalização final · TSE' : 'Em apuração'}</span>` : ''}</div>
      ${ref
        ? `<div class="progresso"><div class="progresso-barra" style="width:${Math.min(100, ref.secoes.percentual)}%"></div></div>
           <p><strong>${fmtPct.format(ref.secoes.percentual)}%</strong> das seções totalizadas <span class="mudo">(${fmt.format(ref.secoes.totalizadas)} de ${fmt.format(ref.secoes.total)})</span>${ref.atualizadoEm ? ` <span class="mudo">· dados do TSE de ${esc(ref.atualizadoEm)}</span>` : ''}</p>`
        : '<p class="nota">Os resultados aparecem aqui assim que o TSE começar a divulgar (a partir das 17h de Brasília, no dia da eleição).</p>'}
    </section>`
  const meus = favoritos.length
    ? `<section class="cartao"><h3>${icone('acompanhados')} Seus candidatos</h3><div class="favs">${favoritos
        .map((f) => cardFavorito(f, estado.favDados?.get(`${f.aba}|${f.abr}`), { mostrarCargo: true }))
        .join('')}</div></section>`
    : `<section class="cartao painel-convite"><h3>${icone('acompanhados')} Acompanhe seus candidatos</h3>
        <p>Toque no coração <span class="estrela-exemplo">♡</span> ao lado de qualquer candidato para ver aqui, logo ao abrir o app, os votos, a posição e se está eleito.</p>
        <p><a class="botao secundario" href="#depfed">Ver Dep. Federal</a> <a class="botao secundario" href="#depest">Ver Dep. Estadual</a></p></section>`
  const blocoMaj = (id, titulo, n) => {
    const d = D(id)
    if (!d) return ''
    const lista = d.candidatos.filter((c) => c.valido).slice(0, n)
    const max = Math.max(1, ...lista.map((c) => c.percentual))
    return `<section class="cartao painel-maj"><h3><a href="#${id}" class="link-aba">${esc(titulo)}</a></h3>
      <ol class="painel-lista">${lista
        .map((c, i) => {
          const cor = corPartido(c.partido)
          return `<li ${attrCand(c, id, UF)} style="${estiloCor(cor)}"><span class="pos">${i + 1}º</span>${foto(c, cor)}<div class="painel-info"><div><strong>${esc(c.nome)}</strong> ${pill(c.partido, cor)} ${c.eleito ? selo(c) : ''}</div>
            <div class="barra fina"><span style="width:${(100 * c.percentual) / max}%"></span></div></div><div class="painel-num"><strong>${fmtPct.format(c.percentual)}%</strong><small>${fmt.format(c.votos)}</small></div></li>`
        })
        .join('')}</ol></section>`
  }
  // 2º turno de Presidente: Brasil e SC lado a lado (o TSE publica a partir das 17h de Brasília do dia 25/10)
  const blocoPresidente2 = () => {
    const P = estado.pres2 || {}
    const br = P.br || null, sc = P[UF] || null, zz = P.zz || null // antes das 17h o TSE publica os arquivos zerados: o painel já aparece, com 0%
    if (!br && !sc && !zz) {
      return `<section class="cartao painel-pres2"><div class="resumo-titulo"><h2><a href="?turno=2#presidente" class="link-aba">🗳️ Presidente · 2º turno</a></h2><span class="selo">${P.br === false ? 'Sem conexão' : 'Aguardando o TSE'}</span></div>
        <p class="nota">${P.br === false ? 'Não consegui consultar o TSE agora. Tentando de novo em instantes.' : 'O 2º turno é no domingo, 25 de outubro de 2026. A apuração aparece aqui assim que o TSE começar a divulgar (a partir das 17h de Brasília) e se atualiza sozinha.'}</p></section>`
    }
    const ref = br || sc || zz
    // bandeiras do Brasil e de Santa Catarina e um globo para o exterior (SVG simples, sem arquivos externos)
    const BANDEIRAS = {
      Brasil: '<svg class="bandeira" viewBox="0 0 28 20" role="img" aria-label="Bandeira do Brasil"><rect width="28" height="20" rx="2" fill="#009c3b"/><path d="M14 2.2 25.2 10 14 17.8 2.8 10z" fill="#ffdf00"/><circle cx="14" cy="10" r="4.6" fill="#002776"/><path d="M9.6 9.1c3.1-.9 6.2-.5 8.9 1.5" stroke="#fff" stroke-width=".9" fill="none"/></svg>',
      'Santa Catarina': '<img class="bandeira" src="img/bandeira-sc.png" width="34" height="25" alt="Bandeira de Santa Catarina">',
      Exterior: '<svg class="bandeira bandeira-globo" viewBox="0 0 28 20" role="img" aria-label="Exterior"><rect width="28" height="20" rx="2" fill="#0a5ea8"/><circle cx="14" cy="10" r="7" fill="none" stroke="#fff" stroke-width="1.2"/><ellipse cx="14" cy="10" rx="3" ry="7" fill="none" stroke="#fff" stroke-width="1"/><path d="M7 10h14M8.2 6.6h11.6M8.2 13.4h11.6" stroke="#fff" stroke-width="1" fill="none"/></svg>',
    }
    const lista = (d, rot) => {
      if (!d) return ''
      const cs = d.candidatos.filter((c) => c.valido).slice(0, 2)
      const max = Math.max(1, ...cs.map((c) => c.percentual))
      return `<div class="pres2-col pres2-${rot === 'Brasil' ? 'br' : rot === 'Exterior' ? 'ext' : 'sc'}"><h4>${BANDEIRAS[rot] || ''} ${rot} <span class="mudo">· ${fmtPct.format(d.secoes.percentual)}% apurado</span></h4><ol class="painel-lista">${cs
        .map((c, i) => {
          const cor = corPartido(c.partido)
          return `<li style="${estiloCor(cor)}"><span class="pos">${i + 1}º</span>${foto(c, cor)}<div class="painel-info"><div><strong>${esc(c.nome)}</strong> ${pill(c.partido, cor)} ${c.eleito ? '<span class="tag eleito-tse"><b>✔ Eleito</b></span>' : ''}</div>
            <div class="barra fina"><span style="width:${(100 * c.percentual) / max}%"></span></div></div><div class="painel-num"><strong>${fmtPct.format(c.percentual)}%</strong><small>${fmt.format(c.votos)} votos</small></div></li>`
        })
        .join('')}</ol></div>`
    }
    return `<section class="cartao painel-pres2"><div class="resumo-titulo"><h2><a href="?turno=2#presidente" class="link-aba">🗳️ Presidente · 2º turno</a></h2><span class="selo ${ref.final ? 'final' : ''}">${ref.final ? 'Totalização final · TSE' : ref.secoes.totalizadas ? 'Em apuração' : 'Aguardando o TSE'}</span></div>
      ${ref.secoes.totalizadas ? '' : '<p class="nota">A apuração começa a ser divulgada pelo TSE a partir das 17h de Brasília de domingo, 25/10, e se atualiza aqui sozinha.</p>'}
      <div class="progresso"><div class="progresso-barra" style="width:${Math.min(100, ref.secoes.percentual)}%"></div></div>
      <p class="progresso-texto"><strong>${fmtPct.format(ref.secoes.percentual)}%</strong> das seções do ${br ? 'Brasil' : 'estado'} totalizadas${ref.atualizadoEm ? ` <span class="mudo">· dados do TSE de ${esc(ref.atualizadoEm)}</span>` : ''}</p>
      <div class="pres2">${lista(br, 'Brasil')}${lista(sc, 'Santa Catarina')}${lista(zz, 'Exterior')}</div>${linhaBoletins()}</section>`
  }
  // linha com o andamento da leitura dos boletins de urna (Brasil e exterior)
  const linhaBoletins = () => {
    const B = estado.boletins
    if (!B?.br?.s?.[1]) return ''
    const [tot, lidas] = B.br.s
    return `<p class="nota">📄 Boletins de urna lidos: <strong>${fmt.format(lidas)}</strong> de ${fmt.format(tot)} seções (${fmtPct.format(pctDe(lidas, tot))}%) · Brasil e exterior · atualizado ${new Date(B.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>`
  }
  // apuração de Presidente em cada um dos 27 estados, agrupados por região
  const blocoEstados = () => {
    const P = estado.pres2 || {}
    const refCand = (P.br || P[UF])?.candidatos?.filter((c) => c.valido).slice(0, 2) || []
    const dados = ESTADOS.map(([uf, nome, reg]) => ({ uf, nome, reg, d: P[uf] || null }))
    if (!refCand.length || !dados.some((e) => e.d)) return ''
    const lider = new Map(refCand.map((c) => [c.numero, 0]))
    const tile = ({ uf, nome, d }) => {
      if (!d) return `<li class="uf-item uf-sem"><div class="uf-topo"><strong>${uf.toUpperCase()}</strong><small>${esc(nome)}</small></div><small class="mudo">sem dados do TSE</small></li>`
      const v = refCand.map((c) => d.candidatos.find((x) => x.numero === c.numero))
      const p = v.map((x) => x?.percentual || 0)
      const apurado = d.secoes.totalizadas > 0
      const iLider = apurado && p[0] !== p[1] ? (p[0] > p[1] ? 0 : 1) : -1
      if (iLider >= 0 && v[iLider]?.votos) lider.set(refCand[iLider].numero, lider.get(refCand[iLider].numero) + 1)
      const soma = p[0] + p[1] || 1
      return `<li class="uf-item" ${iLider >= 0 ? `style="${estiloCor(corPartido(refCand[iLider].partido))}"` : ''}>
        <div class="uf-topo"><strong>${uf.toUpperCase()}</strong><small>${esc(nome)}</small><span class="uf-ap">${fmtPct.format(d.secoes.percentual)}%</span></div>
        <div class="uf-barra" role="img" aria-label="${refCand.map((c, i) => `${esc(c.nome)} ${fmtPct.format(p[i])}%`).join(', ')}">${apurado ? refCand.map((c, i) => `<span style="width:${(100 * p[i]) / soma}%;background:${corPartido(c.partido)}"></span>`).join('') : ''}</div>
        <div class="uf-num">${refCand.map((c, i) => `<span class="${i === iLider ? 'uf-lider' : ''}">${esc(c.nome.split(' ').slice(-1)[0])} <strong>${apurado ? `${fmtPct.format(p[i])}%` : '—'}</strong></span>`).join('')}</div>
      </li>`
    }
    const regioes = [...new Set(ESTADOS.map(([, , r]) => r))]
    const corpo = regioes.map((r) => `<h4 class="uf-reg">${r}</h4><ul class="uf-grade">${dados.filter((e) => e.reg === r).map(tile).join('')}</ul>`).join('')
    const placar = refCand.map((c) => `<span class="tag" style="${estiloCor(corPartido(c.partido))}">${esc(c.nome)} ${pill(c.partido, corPartido(c.partido))} lidera em <strong>${lider.get(c.numero)}</strong> ${lider.get(c.numero) === 1 ? 'estado' : 'estados'}</span>`).join(' ')
    return `<section class="cartao painel-ufs"><h3>🗺️ Presidente · apuração por estado</h3>
      <p class="uf-placar">${placar}</p>
      <p class="nota">Percentual dos votos válidos em cada estado e quanto das seções já foi totalizado pelo TSE. Atualiza sozinho junto com o restante do Início.</p>
      ${corpo}</section>`
  }
  // países onde a votação já está acontecendo (o brasileiro no exterior vota no horário local, 8h às 17h)
  const blocoExterior = () => {
    const agora = Date.now()
    const grupos = new Map()
    for (const [nome, tz, cds] of EXTERIOR) {
      const base = nome.replace(/ \(.*\)$/, '')
      const g = grupos.get(base) || { nome: base, fases: [], tzs: [], cds: [] }
      g.fases.push(faseVotacao(tz, agora))
      g.tzs.push(tz)
      g.cds.push(...cds)
      grupos.set(base, g)
    }
    const P = estado.pres2 || {}
    const refCand = (P.zz || P.br)?.candidatos?.filter((c) => c.valido).slice(0, 2) || []
    const hora = (ms, comDia) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...(comDia ? { weekday: 'short', day: '2-digit', month: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' })
    const paises = [...grupos.values()].map((g) => {
      const fase = g.fases.includes('votando') ? 'votando' : g.fases.every((f) => f === 'encerrada') ? 'encerrada' : g.fases.every((f) => f === 'antes') ? 'antes' : 'votando'
      const fecha = Math.min(...g.tzs.map((tz) => instante(tz, 17, agora) ?? Infinity))
      const abre = Math.min(...g.tzs.map((tz) => instante(tz, 8, agora) ?? Infinity))
      const ds = g.cds.map((cd) => EXT.cidades.get(cd)).filter((d) => d && d.secoes.totalizadas > 0)
      const votos = new Map()
      let tot = 0, tots = 0, ts = 0
      for (const d of ds) {
        tots += d.secoes.totalizadas
        for (const c of d.candidatos) if (c.valido) (votos.set(c.numero, (votos.get(c.numero) || 0) + c.votos), (tot += c.votos))
      }
      for (const cd of g.cds) ts += EXT.cidades.get(cd)?.secoes?.total || 0
      return { ...g, fase, fecha, abre, votos, tot, tots, ts }
    })
    const por = (f) => paises.filter((p) => p.fase === f)
    const votando = por('votando').sort((a, b) => a.fecha - b.fecha || a.nome.localeCompare(b.nome, 'pt-BR'))
    const encerrados = por('encerrada').sort((a, b) => b.tot - a.tot || a.nome.localeCompare(b.nome, 'pt-BR'))
    const antes = por('antes').sort((a, b) => a.abre - b.abre || a.nome.localeCompare(b.nome, 'pt-BR'))
    const resultado = (p) => {
      if (!p.tot || !refCand.length) return p.fase === 'encerrada' ? '<span class="mudo">apuração aguardando o TSE</span>' : ''
      return `<span class="ext-res">${refCand.map((c) => `<span style="${estiloCor(corPartido(c.partido))}"><i></i>${esc(c.nome.split(' ').slice(-1)[0])} <strong>${fmtPct.format(pctDe(p.votos.get(c.numero) || 0, p.tot))}%</strong></span>`).join(' ')} <small class="mudo">${fmt.format(p.tots)} de ${fmt.format(p.ts)} seções</small></span>`
    }
    const linha = (p) => `<li class="ext-pais ext-${p.fase}"><span class="ext-ponto" aria-hidden="true"></span>
      <div class="ext-info"><strong>${esc(p.nome)}</strong> <small class="mudo">${p.cds.length} ${p.cds.length === 1 ? 'cidade' : 'cidades'}</small>
        <div class="ext-st">${p.fase === 'votando' ? `Votando agora · fecha às 17h local (${hora(p.fecha)} em Brasília)` : p.fase === 'encerrada' ? 'Votação encerrada' : `Abre às 8h local (${hora(p.abre, true)} em Brasília)`}</div></div>
      <div class="ext-num">${resultado(p)}</div></li>`
    const aberto = lerLocal('inicio:ext', '1') === '1'
    return `<section class="cartao painel-ext ${aberto ? '' : 'recolhido'}"><div class="ext-topo"><h3>🌎 Exterior · onde a votação está acontecendo</h3>
      <button type="button" class="botao secundario ext-botao" data-ext-toggle aria-expanded="${aberto}">${aberto ? 'Recolher ▴' : `Mostrar a lista (${paises.length} países) ▾`}</button></div>
      <p class="nota"><strong>${votando.length}</strong> ${votando.length === 1 ? 'país votando' : 'países votando'} agora · <strong>${encerrados.length}</strong> com a votação encerrada · ${antes.length} ainda não ${antes.length === 1 ? 'começou' : 'começaram'}. Em ordem de abertura das urnas: quem abre mais cedo vem primeiro. O brasileiro no exterior vota no horário local, das 8h às 17h do dia 25/10; a apuração só é divulgada pelo TSE depois das 17h de Brasília.</p>
      ${aberto ? `<ul class="ext-lista">${[...paises].sort((x, y) => x.abre - y.abre || x.nome.localeCompare(y.nome, 'pt-BR')).map(linha).join('')}</ul>` : ''}</section>`
  }
  const blocoCadeiras = (id, titulo) => {
    const d = D(id)
    if (!d) return ''
    const { eleitos, partidos } = cadeirasPorPartido(d)
    const vagas = d.vagas || eleitos.length || 1
    return `<section class="cartao painel-cadeiras"><h3><a href="#${id}" class="link-aba">${esc(titulo)}</a> <span class="mudo">· ${d.vagas} vagas</span></h3>
      <div class="cadeiras">${partidos.map(([p, cs]) => `<span style="width:${(100 * cs.length) / vagas}%;background:${corPartido(p)}" title="${esc(p)}: ${cs.length}"></span>`).join('')}</div>
      <div class="cadeiras-leg">${partidos.map(([p, cs]) => `<span class="tag" style="${estiloCor(corPartido(p))}">${pill(p, corPartido(p))} <strong>${cs.length}</strong></span>`).join('')}</div>
      <p class="nota">${d.tseDefinido ? 'Eleitos conforme o TSE.' : `Projeção do app com ${fmtPct.format(d.secoes.percentual)}% apurado (quociente eleitoral e sobras); pode mudar até o fim da apuração.`}</p>
      <details class="painel-eleitos"><summary>Ver os ${eleitos.length} ${d.tseDefinido ? 'eleitos' : 'eleitos pela projeção'}</summary>
        <ul>${eleitos.sort((a, b) => b.votos - a.votos).map((c) => `<li ${attrCand(c, id, UF)}><strong>${esc(c.nome)}</strong> ${pill(c.partido, corPartido(c.partido))} <span class="mudo">${fmt.format(c.votos)}</span></li>`).join('')}</ul></details>
    </section>`
  }
  const atalhos = `<section class="cartao"><h3>Explorar</h3><div class="painel-atalhos">
      <a href="#bairros">${icone('bairros')}<strong>Bairros</strong><small>zona, local e seção</small></a>
      <a href="#municipios">${icone('municipios')}<strong>Municípios</strong><small>apuração em cada cidade</small></a>
      <a href="#analises">${icone('analises')}<strong>Análises</strong><small>mapa, perfil e abstenção</small></a>
      ${PREF.mostrar2022 ? `<a href="#h2022">${icone('h2022')}<strong>Histórico</strong><small>eleições de 2012 a 2024</small></a>` : ''}
      <a href="#telao">${icone('tv')}<strong>Modo telão</strong><small>tela cheia para TV ou projetor</small></a>
    </div><p class="nota">Para comparar dois candidatos (inclusive de cargos diferentes), abra a ficha de um deles e toque em <strong>Comparar com outro candidato</strong>.</p></section>`
  const card = cardPainel(D)
  // Início 2026: o destaque é o 2º turno de Presidente; os dados do 1º turno ficam nas abas de cada cargo
  return blocoPresidente2() + blocoEstados() + blocoExterior() + meus + atalhos
}

// card de compartilhar com o resumo: governador, senado e cadeiras por partido
function cardPainel(D) {
  const gov = D('governador'), sen = D('senador'), fed = D('depfed'), est = D('depest')
  const ref = gov || fed || est
  if (!ref) return null
  const tiles = []
  for (const [d, rot, n] of [[gov, 'Governador', 2], [sen, 'Senado', 2]]) {
    if (!d) continue
    for (const c of d.candidatos.filter((x) => x.valido).slice(0, n)) tiles.push({ rot: `${rot} · ${c.partido}`, valor: c.nome, sub: `${fmtPct.format(c.percentual)}% · ${fmt.format(c.votos)} votos`, cor: corPartido(c.partido) })
  }
  const cad = new Map()
  for (const [d, k] of [[fed, 'f'], [est, 'e']]) if (d) for (const [p, cs] of cadeirasPorPartido(d).partidos) cad.set(p, { ...(cad.get(p) || { f: 0, e: 0 }), [k]: cs.length })
  const linhas = [...cad.entries()].map(([p, x]) => ({ p, ...x, t: x.f + x.e })).sort((a, b) => b.t - a.t).slice(0, 6)
  const max = Math.max(1, ...linhas.map((l) => l.t))
  const def = (fed?.tseDefinido ?? true) && (est?.tseDefinido ?? true)
  return {
    chapeu: 'APURAÇÃO 2026 · SANTA CATARINA', nome: 'Resumo da apuração', cor: '#0b7a45',
    sub: ref.final ? 'Resultado final · TSE' : `${fmtPct.format(ref.secoes.percentual)}% das seções apuradas`,
    titulo: 'Quem lidera em SC', subtitulo: ref.atualizadoEm ? `Dados do TSE de ${ref.atualizadoEm}` : '', tiles,
    linhas: linhas.map((l) => ({ nome: l.p, extra: `Federal ${l.f || 0} · Estadual ${l.e || 0}`, valor: `${l.t} ${l.t === 1 ? 'cadeira' : 'cadeiras'}`, frac: l.t / max, corBarra: corPartido(l.p) })),
    rodape: linhas.length ? (def ? 'Cadeiras de deputado: eleitos conforme o TSE' : 'Cadeiras de deputado: projeção do app') : '',
  }
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
export const painel = { ordem: 'regiao', busca: '', erroLista: false, carregando: 0 }

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
    if (!document.hidden) return carregar()
    // em segundo plano, só os acompanhados (para os alertas)
    if (ALERTAS.on && favoritos.length) conferirAcompanhados().finally(agendar)
    else agendar()
  }, intervalo)
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !estado.dados?.final) carregar()
})
async function conferirAcompanhados() {
  const grupos = new Set(favoritos.map((f) => `${f.aba}|${f.abr}`))
  await Promise.allSettled(
    [...grupos].map(async (k) => {
      const [abaId, abr] = k.split('|')
      const aba = ABAS.find((a) => a.id === abaId)
      if (aba?.cargo) registrarHistorico(abaId, abr, await buscar(aba, abr, TURNO))
    }),
  )
}

/* ---------------- renderização ---------------- */

const OUTROS = '#9aa5a0'

export function estiloCor(cor) {
  return `--cor:${cor};--cor-txt:${corTexto(cor)}`
}

// "FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL" → "FE BRASIL"; "Federação PSDB Cidadania" → "PSDB Cidadania"
function nomeCurto(nome) {
  const n = String(nome || '')
  if (!/^federa/i.test(n)) return n
  const sigla = n.split(/\s+-\s+/)[1]
  return sigla || n.replace(/^federa[çc][ãa]o\s+/i, '')
}

export function pill(sigla, cor = corPartido(sigla)) {
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
  const municipal = !ehAoVivo() && !!a.municipal
  return `${seg}<div class="local ${mun ? 'com-mun' : ''}">
    <span class="local-icone" aria-hidden="true">📍</span>
    <div class="local-campo">
      <input id="mun-busca" type="search" autocomplete="off" enterkeyhint="search"
        placeholder="${municipal ? 'Escolher município' : 'SC inteira · buscar município'}" value="${esc(mun?.nm || '')}" aria-label="Escolher município de SC">
      ${mun && !municipal ? '<button type="button" class="local-limpar" data-mun-limpar aria-label="Voltar para o estado todo">✕</button>' : ''}
      <ul id="mun-sugestoes" class="sugestoes" hidden></ul>
    </div>
  </div>${ehAoVivo() ? seletorZonas(mun) : seletorTurnoHist()}${atalhosLocal(mun, municipal)}`
}

const chip = (cd, nm, ativo) => `<button type="button" class="atalho ${ativo ? 'ativo' : ''}" data-mun-cd="${esc(cd)}" data-mun-nm="${esc(nm)}">${esc(nm)}</button>`

function atalhosLocal(mun, soCidades = false) {
  // fechado por padrão; o app lembra se a pessoa deixou aberto
  const aberto = estado.atalhos ?? lerLocal('atalhos:v1', '0') === '1'
  // cargos municipais: só cidades (sem somar regiões)
  if (soCidades) {
    const ativo = (cd) => mun && !mun.regiao && mun.cd === cd
    const gf = GRANDE_FLORIPA.map((nm) => MUNICIPIOS_SC.find((m) => chaveNome(m[2]) === chaveNome(nm))).filter(Boolean)
    const gfSet = new Set(gf.map((m) => m[0]))
    const maiores = MUNICIPIOS_SC.filter((m) => !gfSet.has(m[0])).slice(0, 12)
    return `<div class="atalhos"><div class="atalhos-grupo"><span class="atalhos-rot">🏝️ Grande Florianópolis</span><div class="atalhos-chips">${gf.map((m) => chip(m[0], m[2], ativo(m[0]))).join('')}</div></div>
      <div class="atalhos-grupo"><span class="atalhos-rot">🏙️ Maiores cidades</span><div class="atalhos-chips">${maiores.map((m) => chip(m[0], m[2], ativo(m[0]))).join('')}</div></div></div>`
  }
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
    lista = ehAoVivo() ? await municipios(estado.aba) : MUNICIPIOS_SC.map((m) => ({ cd: m[0], nm: m[2], capital: m[0] === FLORIPA_CD, zonas: [] }))
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
  const municipal = !ehAoVivo() && !!estado.aba.municipal
  ul.innerHTML =
    (municipal ? '' : `<li><button type="button" data-mun-limpar class="sug-estado">🗺️ Santa Catarina inteira</button></li>`) +
    (municipal ? [] : assocs).map(([sg, nm]) => `<li><button type="button" data-regiao="assoc:${sg}">🤝 ${esc(sg)} <span class="mudo">· ${esc(nm)} (associação)</span></button></li>`).join('') +
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
  if (h('[data-h22-mv]')) return ((H22.mv = h('[data-h22-mv]').dataset.h22Mv), (H22.pfTodos = false), renderizar())
  // 🔎 busca de candidatos
  if (h('[data-bc-cargo]')) return ((H22.buscaCargo = h('[data-bc-cargo]').dataset.bcCargo), (H22.buscaTodos = false), renderizar())
  if (h('[data-bc-sit]')) return ((H22.buscaSit = h('[data-bc-sit]').dataset.bcSit), (H22.buscaTodos = false), renderizar())
  if (h('[data-bc-sc]')) return ((H22.buscaSC = h('[data-bc-sc]').dataset.bcSc === '1'), (H22.buscaTodos = false), renderizar())
  if (h('[data-bc-todos]')) return ((H22.buscaTodos = true), renderizar())
  if (h('[data-bc-csv]') && H22.csvBusca) return baixarCSV(H22.csvBusca)
  if (h('[data-bc-xlsx]') && H22.csvBusca) return baixarExcel(H22.csvBusca.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Candidatos', ...H22.csvBusca }], h('[data-bc-xlsx]'))
  if (h('[data-bc-ir]')) {
    // atalho (câmara, explorador): abre a busca no cargo e na situação pedidos
    const b = h('[data-bc-ir]').dataset
    Object.assign(H22, { mv: 'votos', buscaCargo: b.bcIr, buscaSit: b.bcIrSit || '', buscaSC: false, buscaTodos: false, busca: '' })
    renderizar()
    return document.getElementById('busca-cand')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (tratarPrefeitos(h)) return
  if (tratarCamaras(h)) return
  if (tratarPerfil(h)) return
  if (h('[data-h22-vis]')) return ((X.vis = h('[data-h22-vis]').dataset.h22Vis), (X.verGrupos = false), renderizar())
  if (h('[data-h22-ord]')) return ((X.ordAbst = h('[data-h22-ord]').dataset.h22Ord), renderizar())
  if (h('[data-abst-grupo]')) return ((X.abstGrupo = h('[data-abst-grupo]').dataset.abstGrupo), (X.abstTodos = false), renderizar())
  if (h('[data-abst-todos]')) return ((X.abstTodos = true), renderizar())
  if (h('[data-csv-abst-sc]') && X.csvAbstSC) return baixarCSV(X.csvAbstSC)
  if (h('[data-xlsx-abst-sc]') && X.csvAbstSC) return baixarExcel(X.csvAbstSC.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Abstenção', ...X.csvAbstSC }], h('[data-xlsx-abst-sc]'))
  if (h('[data-h22-vis-abst]')) X.vis = 'abst'
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
  if (estado.aba.tipo === 'camp' && tratarCampanha(h)) return
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
    if (h('[data-b26-modo]')) return ((B26.modo = h('[data-b26-modo]').dataset.b26Modo), renderizar())
    if (tratarTerritorio(h)) return
    if (tratarQR(h)) return
    const ir = h('[data-b26-ir]')
    if (ir) {
      Object.assign(B26, { local: { cd: ir.dataset.b26Ir, nm: NOME_MUN.get(ir.dataset.b26Ir) || ir.dataset.b26Ir, bairro: ir.dataset.b26Bairro }, grupo: 'local', verTodos: false, verGrupos: false })
      renderizar()
      return window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  if (h('[data-csv-local]') && X.csv) return baixarCSV(X.csv)
  if (h('[data-xlsx-local]') && X.csv) return baixarExcel(X.csv.nome.replace(/\.csv$/, '.xlsx'), [{ aba: X.vis === 'abst' ? 'Abstenção' : 'Votos', ...X.csv }], h('[data-xlsx-local]'))
  const anoBtn = ev.target.closest('[data-h22-ano]')
  if (anoBtn) {
    Object.assign(H22, { busca: '', foco: null })
    const a = Number(anoBtn.dataset.h22Ano)
    if (a === anoAtual() || (ehAoVivo() && a === H22.ano)) return renderizar()
    return definirAno(a)
  }
  const h22Btn = ev.target.closest('[data-h22]')
  if (h22Btn) {
    X.sel = h22Btn.dataset.h22
    X.busca = ''
    X.foco = null
    if (X === H22) H22.buscaCargo = null
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
  const ppG = ev.target.closest('[data-pp-grupo]')
  if (ppG) return ((PP.grupo = ppG.dataset.ppGrupo), renderizar())
  if (ev.target.closest('[data-pp-todos]')) return ((PP.todos = true), renderizar())
  if (ev.target.closest('[data-pp-xlsx]')) return excelPartido(ev.target.closest('[data-pp-xlsx]'))
  const ppM = ev.target.closest('[data-pp-mun]')
  if (ppM) {
    const part = estado.partido
    PP.grupo = 'bairro'
    escolherMunicipio({ cd: ppM.dataset.ppMun, nm: NOME_MUN.get(ppM.dataset.ppMun) || ppM.dataset.ppMun })
    estado.partido = part
    return window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const ppA = ev.target.closest('[data-pp-assoc]')
  if (ppA) {
    const part = estado.partido
    PP.grupo = 'mun'
    escolherMunicipio(regiao(`assoc:${ppA.dataset.ppAssoc}`))
    estado.partido = part
    return window.scrollTo({ top: 0, behavior: 'smooth' })
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
  if (ev.target.id === 'pf-assoc') ((H22.pfAssoc = ev.target.value), (H22.pfTodos = false), renderizar())
  if (ev.target.id === 'perf-partido') ((H22.perfPartido = ev.target.value), renderizar())
})

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'mun-busca') {
    mostrarSugestoes()
    return
  }
  if (['terr-mun', 'terr-ref-busca', 'terr-nome'].includes(ev.target.id)) return inputTerritorio(ev.target)
  if (estado.aba.tipo === 'camp' && (CAMPOS_CAMPANHA.includes(ev.target.id) || ev.target.dataset.campPapel || ev.target.dataset.campCoord || ['camp-cv-papel', 'camp-cv-coord', 'camp-cv-usos'].includes(ev.target.id))) return inputCampanha(ev.target)
  if (ev.target.id === 'qr-foto') return lerFotoQR(ev.target)
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
    H22.buscaTodos = false
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

export function resumo(d) {
  const tpl = $('#tpl-resumo').content.cloneNode(true)
  const f = (n) => tpl.querySelector(`[data-f="${n}"]`)
  const local = nomeLocal(d)
  f('titulo').textContent = `${d.cargoNome} · ${local}`
  f('selo').textContent = d.hist ? `Resultado oficial · TSE ${d.ano}` : d.final ? 'Totalização final · TSE' : d.tseDefinido ? 'Eleitos definidos pelo TSE' : TURNO === 2 ? '2º turno' : 'Em apuração'
  f('selo').classList.toggle('final', !!(d.final || d.tseDefinido))
  const p = d.secoes.percentual
  f('barra').style.width = `${Math.min(100, p)}%`
  f('barra').parentElement.setAttribute('aria-valuenow', String(Math.round(p)))
  const item = (rot, cls, valor, extra) =>
    `<div class="num ${cls}"><dt>${rot}</dt><dd>${valor}${extra != null && !Number.isNaN(extra) ? ` <span class="mudo">${fmtPct.format(extra)}%</span>` : ''}</dd></div>`
  if (d.hist) {
    // eleição anterior: válidos e vagas; aptos e comparecimento quando o arquivo do ano já estiver no app
    const C = arquivoAno(`dados${d.ano}/comparecimento.json`, () => estado.dados === d && renderizar())
    const cds = d.mun ? (d.mun.regiao ? d.mun.membros.map((m) => m.cd) : [d.mun.cd]) : d.cd ? [d.cd] : null
    const t = C.valor?.[`t${Number(String(d.el.id)[1]) || 1}`]
    let aptos = 0, comp = 0
    if (t) for (const cd of cds || Object.keys(t)) if (t[cd]) (aptos += t[cd][0]), (comp += t[cd][1])
    f('ptexto').innerHTML = `<strong>100%</strong> das seções totalizadas <span class="mudo">· resultado oficial da eleição de ${d.ano}</span>`
    f('numeros').innerHTML = [
      ...(aptos ? [item('Comparecimento', 'n-comp', fmt.format(comp), pctDe(comp, aptos)), item('Abstenção', 'n-abst', fmt.format(aptos - comp), pctDe(aptos - comp, aptos))] : []),
      item('Votos válidos', 'n-val', fmt.format(d.votos.validos), aptos ? pctDe(d.votos.validos, comp) : null),
      item(d.vagas > 1 ? 'Vagas' : 'Vaga', 'n-vag', fmt.format(d.vagas)),
    ].join('')
    const div = document.createElement('div')
    div.appendChild(tpl)
    return div.innerHTML
  }
  f('ptexto').innerHTML = `<strong>${fmtPct.format(p)}%</strong> das seções totalizadas
    <span class="mudo">(${fmt.format(d.secoes.totalizadas)} de ${fmt.format(d.secoes.total)})</span>`
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

export function foto(c, cor = corPartido(c.partido)) {
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

function estrela(c, abaId = abaIdAtual(), abr = abrFicha()) {
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
  const aba = abaDe(f.aba)
  const cargoTxt = `${aba ? aba.rotulo.replace(/ SC$/, '') : ''} · ${aba?.hist ? nomeAbr(f.abr) : NOMES_ABR[f.abr] || f.abr.toUpperCase()}`
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
    ${aba?.hist ? `<p class="nota">📅 Resultado oficial de ${aba.ano} (TSE)</p>` : evolucao(serie, cor)}
  </article>`
}

function secaoAcompanhando(d) {
  const abr = abrFicha()
  if (munAtual()) return ''
  const meus = favoritos.filter((f) => f.aba === abaIdAtual() && f.abr === abr)
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
  // 2026 primeiro; depois as eleições anteriores, da mais recente à mais antiga
  const ordem = ABAS.map((a) => a.id)
  const peso = (id) => (ordem.includes(id) ? ordem.indexOf(id) : 1000 + (3000 - (abaHist(id)?.ano || 0)))
  const grupos = new Map()
  for (const f of [...favoritos].sort((a, b) => peso(a.aba) - peso(b.aba))) {
    const k = `${f.aba}|${f.abr}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(f)
  }
  return quadroAlertas() + [...grupos.entries()]
    .map(([k, lista]) => {
      const [abaId, abr] = k.split('|')
      const aba = abaDe(abaId)
      const d = estado.favDados?.get(k)
      const titulo = `${aba?.hist ? '📅 ' : ''}${aba ? aba.rotulo.replace(/ SC$/, '') : abaId} · ${aba?.hist ? nomeAbr(abr) : NOMES_ABR[abr] || abr.toUpperCase()}`
      const prog = aba?.hist
        ? `<p class="nota">Resultado oficial de ${aba.ano} (TSE). Toque num candidato para abrir a ficha.</p>`
        : d
        ? `<div class="progresso mini"><div class="progresso-barra" style="width:${Math.min(100, d.secoes.percentual)}%"></div></div>
           <p class="nota">${fmtPct.format(d.secoes.percentual)}% das seções totalizadas${d.final ? ' · totalização final' : ''}</p>`
        : '<p class="nota">Resultados ainda não divulgados.</p>'
      return `<section class="cartao acompanhando">
        <h3><a href="${aba?.hist ? esc(hashDe('h2022', { ano: aba.ano, e: aba.el, m: abr !== 'sc' ? abr : null })) : `#${esc(abaId)}`}" class="link-aba">${esc(titulo)}</a></h3>
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
      ? ehAoVivo()
        ? `<p class="nota">Em 2026 o Senado renova 2/3: SC elege <strong>${d.vagas}</strong> senadores — os ${d.vagas} mais votados.</p>`
        : `<p class="nota">Em ${anoAtual()} SC elegeu <strong>${d.vagas}</strong> ${d.vagas > 1 ? 'senadores' : 'senador'}: ${d.vagas > 1 ? 'os' : 'o'} mais ${d.vagas > 1 ? 'votados' : 'votado'}.</p>`
      : turnoAtual() === 2
        ? '<p class="nota">2º turno: vence quem tem mais votos válidos.</p>'
        : `<p class="nota">A linha tracejada marca 50% dos votos válidos: quem passar dela vence no 1º turno${estado.aba.cargo === 11 ? ' (nas cidades com 2º turno, acima de 200 mil eleitores)' : ''}.</p>`
  return `<section class="cartao">
      <h3>Divisão dos votos válidos</h3>
      ${barraEmpilhada(fatias, { marco50: estado.aba.cargo !== 5 && turnoAtual() === 1, total: d.votos.validos })}
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

/* ---------------- painel do partido ---------------- */

// Ao escolher um partido/federação nas abas de deputados: a chapa inteira, quem puxou mais votos e o
// partido por município, associação e (num município) bairro, com 2022. Soma os votos nominais dos
// candidatos da chapa (a legenda não vem separada por município nos arquivos do TSE).
const PP = { grupo: 'mun', todos: false }
function dadosPartido(d, g) {
  const aba = estado.aba
  const el = eleicaoDoCargo(aba.cargo)
  const chapa = d.candidatos.filter((c) => c.agremiacao === g.nome).sort((a, b) => b.votos - a.votos)
  const nums = new Set(chapa.map((c) => String(c.numero)))
  const siglas = new Set(g.partidos)
  const M = arquivoAno(`dados2026/municipios-${el}.json`)
  const M22 = arquivoAno(`dados2022/mun-t1-c${aba.cargo}.json`)
  const R22 = histDe(2022).resumo
  if (!R22) resumoAno(2022).then(() => renderizar()).catch(() => {})
  let porMun = null, por22 = null
  if (M.valor) {
    porMun = new Map()
    for (const nr of nums) for (const [cd, v] of Object.entries(M.valor.c[nr] || {})) porMun.set(cd, (porMun.get(cd) || 0) + v)
  }
  const el22 = R22?.eleicoes.find((e) => e.id === `t1-c${aba.cargo}`)
  if (M22.valor && el22) {
    por22 = new Map()
    for (const c of el22.candidatos) {
      if (!siglas.has(c.partido)) continue
      for (const [cd, v] of Object.entries(M22.valor.cand[c.sq] || {})) por22.set(cd, (por22.get(cd) || 0) + v)
    }
  }
  return { chapa, nums, porMun, por22, val: M.valor?.validos || {}, val22: M22.valor?.validos || {}, erro: M.erro }
}
// bairros do município escolhido (boletins de urna): nominais + legenda dos números do partido
function bairrosPartido(cd, nums, partNums, el) {
  const arq = secoesAno(2026, cd)
  if (!arq) return null
  const porB = new Map(), valB = new Map()
  for (const [zs, arr] of Object.entries(arq.votos[el] || {})) {
    const b = bairroDoLocal(arq, arq.secoes[zs])
    for (let i = 0; i < arr.length; i += 2) {
      const nr = arr[i], v = arr[i + 1]
      if (nr >= 95 && nr <= 97) continue
      valB.set(b, (valB.get(b) || 0) + v)
      if (nums.has(String(nr)) || (nr < 100 && partNums.has(String(nr)))) porB.set(b, (porB.get(b) || 0) + v)
    }
  }
  return { porB, valB }
}

function painelPartido(d) {
  const g = estado.grupos?.find((x) => x.nome === estado.partido)
  if (!g || estado.aba.tipo !== 'prop') return ''
  const mun = munAtual()
  const P = dadosPartido(d, g)
  const nominais = P.chapa.reduce((a, c) => a + c.votos, 0)
  const comProj = !!d.projecao?.qe
  const cadeiras = comProj ? g.vagasProj : g.eleitos
  const validos = d.votos?.validos || 1
  const pctP = pctDe(g.total, validos)
  const cor = g.cor
  const puxadores = P.chapa.slice(0, 5)
  const tiles = `<div class="pp-tiles">
      <div><span>Votos${g.legenda ? ' (com legenda)' : ''}</span><strong>${fmt.format(g.total)}</strong><small>${fmtPct.format(pctP)}% dos válidos${mun ? ` em ${esc(mun.nm)}` : ''}</small></div>
      ${mun
        ? `<div><span>Candidatos com voto</span><strong>${P.chapa.filter((c) => c.votos > 0).length}</strong><small>de ${P.chapa.length} na chapa</small></div>`
        : `<div><span>${comProj ? 'Cadeiras (projeção)' : 'Eleitos'}</span><strong>${cadeiras || 0}</strong><small>${comProj ? `${fmtDec(g.total / d.projecao.qe)} quocientes` : `${P.chapa.length} candidatos`}</small></div>`}
      ${g.legenda ? `<div><span>Legenda</span><strong>${fmt.format(g.legenda)}</strong><small>${fmtPct.format(pctDe(g.legenda, g.total || 1))}% do partido</small></div>` : `<div><span>Votos nominais</span><strong>${fmt.format(nominais)}</strong><small>soma dos candidatos</small></div>`}
      <div><span>Mais votado</span><strong class="pp-nome">${esc(puxadores[0]?.nome || '—')}</strong><small>${puxadores[0] ? `${fmtPct.format(pctDe(puxadores[0].votos, nominais || 1))}% dos nominais da chapa` : ''}</small></div>
    </div>`
  const chapa = `<h4>Quem puxou os votos da chapa</h4>
    <ol class="pp-chapa">${P.chapa.slice(0, PP.todos ? 999 : 10).map((c) => `<li ${attrCand(c)}><div class="pp-l"><span class="cand-nome">${esc(c.nome)}</span> ${c.partido !== g.nome ? pill(c.partido, corPartido(c.partido)) : ''} ${c.eleito ? '<span class="pp-sit">✔ eleito</span>' : c.projecao && !c.tseDefinido ? '<span class="pp-sit">★ projeção</span>' : ''}</div>
      <span class="pp-barra"><span style="width:${Math.max(1, (100 * c.votos) / (P.chapa[0]?.votos || 1))}%;background:${cor}"></span></span>
      <span class="pp-num"><strong>${fmt.format(c.votos)}</strong> <small>${fmtPct.format(pctDe(c.votos, nominais || 1))}%</small></span></li>`).join('')}</ol>
    ${P.chapa.length > 10 && !PP.todos ? `<button type="button" class="link-zonas" data-pp-todos>Ver os ${P.chapa.length} candidatos ▾</button>` : ''}`
  // por lugar
  const grupos = [['mun', 'Municípios'], ['assoc', 'Associações'], ...(mun && !mun.regiao ? [['bairro', `Bairros de ${mun.nm}`]] : [])]
  const grupo = grupos.some(([k]) => k === PP.grupo) ? PP.grupo : 'mun'
  let itens = null, aviso = ''
  if (grupo === 'bairro') {
    const partNums = new Set(P.chapa.map((c) => String(c.numero).slice(0, 2)))
    const B = bairrosPartido(mun.cd, P.nums, partNums, eleicaoDoCargo(estado.aba.cargo))
    if (B) itens = [...B.porB.entries()].map(([nome, v]) => ({ nome, v, meta: `${fmtPct.format(pctDe(v, B.valB.get(nome) || 1))}% dos votos do bairro (com legenda)` }))
    else aviso = erroSecoes(2026, mun.cd) ? 'Os boletins deste município ainda não estão no app.' : 'Carregando os bairros…'
  } else if (P.porMun) {
    const cds = mun ? (mun.regiao ? mun.membros.map((m) => m.cd) : [mun.cd]) : null
    const filtro = (cd) => !cds || cds.includes(cd)
    if (grupo === 'mun')
      itens = [...P.porMun.entries()].filter(([cd]) => filtro(cd)).map(([cd, v]) => ({ nome: NOME_MUN.get(cd) || cd, sub: ASSOCIACAO_MUN[cd] || '', v, v22: P.por22 ? P.por22.get(cd) || 0 : undefined, meta: `${fmtPct.format(pctDe(v, P.val[cd] || 1))}% dos votos nominais da cidade`, ir: `data-pp-mun="${esc(cd)}"` }))
    else {
      const A = new Map()
      for (const [cd, v] of P.porMun) {
        if (!filtro(cd)) continue
        const sg = ASSOCIACAO_MUN[cd]
        if (!sg) continue
        const a = A.get(sg) || { v: 0, v22: 0, val: 0 }
        a.v += v
        a.val += P.val[cd] || 0
        A.set(sg, a)
      }
      if (P.por22) for (const [cd, v] of P.por22) if (filtro(cd) && A.has(ASSOCIACAO_MUN[cd])) A.get(ASSOCIACAO_MUN[cd]).v22 += v
      itens = [...A.entries()].map(([sg, a]) => ({ nome: sg, sub: ASSOCIACOES[sg], v: a.v, v22: P.por22 ? a.v22 : undefined, meta: `${fmtPct.format(pctDe(a.v, a.val || 1))}% dos votos nominais da região`, ir: `data-pp-assoc="${esc(sg)}"` }))
    }
  } else aviso = P.erro ? 'Os votos por município ainda não estão no app.' : 'Carregando os municípios…'
  itens?.sort((a, b) => b.v - a.v)
  const tem22 = itens?.some((i) => i.v22 !== undefined)
  const lista = itens
    ? itens.length
      ? tem22
        ? listaComparada(itens.slice(0, 15), cor)
        : `<table class="tabela"><tbody>${itens.slice(0, 15).map((i) => `<tr><td><strong>${esc(i.nome)}</strong><div class="cand-meta">${i.meta}</div></td><td class="dir"><strong>${fmt.format(i.v)}</strong></td></tr>`).join('')}</tbody></table>`
      : '<p class="nota">Sem votos.</p>'
    : `<p class="nota">${aviso}</p>`
  const v26 = itens?.reduce((a, i) => a + i.v, 0) || 0
  const v22 = tem22 ? itens.reduce((a, i) => a + (i.v22 || 0), 0) : null
  PP.export = itens ? { g, itens, grupo, P, d, nominais, cadeiras, mun } : null
  const segs = `<div class="segmentado" role="group" aria-label="Agrupar por">${grupos.map(([k, rot]) => `<button type="button" data-pp-grupo="${k}" aria-pressed="${k === grupo}">${esc(rot)}</button>`).join('')}</div>`
  return `<section class="cartao pp" style="${estiloCor(cor)}">
    <div class="pp-cabeca"><h3>${icone('partido')} Painel ${g.partidos.length > 1 ? 'da federação' : 'do partido'} ${pill(nomeCurto(g.nome), cor)}</h3>${g.partidos.length > 1 ? `<p class="cand-meta">${esc(g.partidos.join(', '))}</p>` : ''}</div>
    ${tiles}
    ${chapa}
    <h4>Onde ${esc(nomeCurto(g.nome))} teve mais votos${tem22 ? ' · 2026 × 2022' : ''}</h4>
    ${segs}
    ${tem22 && v22 ? `<p class="var-resumo">Soma: <strong>${fmt.format(v26)}</strong> votos nominais em 2026 × ${fmt.format(v22)} em 2022 (${esc(g.partidos.join(', '))} em 2022) ${(() => { const va = variacao(v26, v22); return va ? `<span class="var ${va.cls}">${va.txt}</span>` : '' })()}</p>` : ''}
    ${lista}
    ${itens && itens.length > 15 ? `<p class="nota">Mostrando 15 de ${fmt.format(itens.length)} — a lista completa vai no Excel.</p>` : ''}
    <p class="nota">Votos nominais dos candidatos da chapa${grupo === 'bairro' ? ' + legenda' : ''} (TSE). ${tem22 ? 'Em 2022, os mesmos partidos (siglas), mesmo que em outra federação.' : ''}</p>
    <div class="exportar">${botaoCard('partido', cardPartido(g, P, cor, cadeiras, comProj, mun))}<button type="button" class="botao secundario" data-pp-xlsx ${itens ? '' : 'disabled'}>${icone('baixar')} Excel</button>${botaoLink()}</div>
  </section>`
}

function cardPartido(g, P, cor, cadeiras, comProj, mun) {
  const onde = mun ? mun.nm : 'Santa Catarina'
  const top = P.chapa.slice(0, 8)
  const max = Math.max(1, top[0]?.votos || 1)
  const nominais = P.chapa.reduce((a, c) => a + c.votos, 0)
  return {
    chapeu: `APURAÇÃO 2026 · ${onde.toUpperCase()}`, nome: nomeCurto(g.nome), cor,
    sub: `${estado.aba.rotulo.replace(/ SC$/, '')} · ${g.partidos.join(', ')}`,
    titulo: 'Quem puxou os votos da chapa', subtitulo: mun ? `${P.chapa.length} candidatos · votos em ${mun.nm}` : `${comProj ? 'Cadeiras pela projeção' : 'Eleitos'}: ${cadeiras || 0} · ${P.chapa.length} candidatos`,
    total: { rot: `Votos do partido · ${onde}`, valor: `${fmt.format(g.total)} votos`, sub: g.legenda ? `legenda: ${fmt.format(g.legenda)}` : '' },
    linhas: top.map((c) => ({ foto: c.foto, nome: c.nome, extra: `${c.partido} · nº ${c.numero}${c.eleito ? ' · ✔ eleito' : c.projecao && !c.tseDefinido ? ' · ★ projeção' : ''}`, valor: fmt.format(c.votos), dir2: `${fmtPct.format(pctDe(c.votos, nominais || 1))}% da chapa`, frac: c.votos / max, corBarra: cor })),
  }
}

function excelPartido(botao) {
  const X = PP.export
  if (!X) return
  const { g, P, itens, grupo } = X
  const nominais = X.nominais || 1
  const abas = [
    { aba: 'Chapa', cab: ['Candidato', 'Partido', 'Número', 'Votos', '% da chapa', 'Situação'], linhas: P.chapa.map((c) => [c.nome, c.partido, Number(c.numero), c.votos, pctDe(c.votos, nominais), c.eleito ? 'Eleito (TSE)' : c.projecao && !c.tseDefinido ? 'Eleito pela projeção' : '']) },
    { aba: grupo === 'bairro' ? 'Bairros' : grupo === 'assoc' ? 'Associações' : 'Municípios', cab: ['Lugar', 'Votos 2026', ...(itens.some((i) => i.v22 !== undefined) ? ['Votos 2022'] : [])], linhas: itens.map((i) => [i.sub && grupo === 'assoc' ? `${i.nome} · ${i.sub}` : i.nome, i.v, ...(i.v22 !== undefined ? [i.v22] : [])]) },
  ]
  baixarExcel(`${nomeArquivo(nomeCurto(g.nome))}-${nomeArquivo(estado.aba.rotulo)}-painel.xlsx`, abas, botao)
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
      : `${filtros}${painelPartido(d)}
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

export function renderizar() {
  if (estado.detalhe) renderDetalhe()
  else sincronizarLink()
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
  if (estado.aba.tipo === 'painel') {
    conteudo.innerHTML = renderPainel()
    return
  }
  if (estado.aba.tipo === 'camp') {
    const idf = CAMPOS_CAMPANHA.includes(document.activeElement?.id) ? document.activeElement.id : null
    const foco = idf ? document.activeElement.selectionStart : null
    conteudo.innerHTML = renderCampanha()
    if (idf) {
      const el = document.getElementById(idf)
      el?.focus()
      if (foco != null && el?.setSelectionRange) {
        try {
          el.setSelectionRange(foco, foco)
        } catch {}
      }
    }
    return
  }
  if (estado.aba.tipo === 'h22' || estado.aba.tipo === 'bai' || estado.aba.tipo === 'pro') {
    const idf = ['h22-busca', 'h22-mun', 'pro-busca', 'b26-busca', 'terr-mun', 'terr-ref-busca', 'terr-nome'].includes(document.activeElement?.id) ? document.activeElement.id : null
    const foco = idf ? document.activeElement.selectionStart : null
    conteudo.innerHTML = estado.aba.tipo === 'pro' ? renderPro() : estado.aba.tipo === 'bai' ? renderBairros26() : render2022()
    if (estado.aba.tipo === 'pro' && PRO.chave && PRO.aba === 'mapa') montarMapaPro()
    for (const div of conteudo.querySelectorAll('[data-mapa]')) montarMapaAberto(div)
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

function attrCand(c, abaId = abaIdAtual(), abr = abrFicha()) {
  return `data-cand="${esc(c.sqcand)}" data-cand-aba="${esc(abaId)}" data-cand-abr="${esc(abr)}"`
}

/* ---------------- tela de detalhes do candidato ---------------- */

const detalheEl = document.createElement('div')
detalheEl.className = 'detalhe'
detalheEl.hidden = true
detalheEl.setAttribute('role', 'dialog')
detalheEl.setAttribute('aria-modal', 'true')
document.body.appendChild(detalheEl)

function abrirDetalhe({ aba, abr, sqcand, substituir = false }) {
  const hist = abaHist(aba)
  const mun = !hist && estado.aba.id === aba && abrAtual() === abr ? munAtual() : null
  if (estado.detalhe) {
    estado.detalhe.ctrlPorMun?.abort()
    estado.detalhe.ctrlComp?.abort()
  }
  estado.detalhe = { aba, abr, sqcand, mun, floripa: null, hist }
  history[substituir || (hist && history.state?.detalhe) ? 'replaceState' : 'pushState']({ detalhe: true }, '', `${location.search}${hashDesejado()}`)
  document.documentElement.classList.add('com-detalhe')
  detalheEl.hidden = false
  detalheEl.scrollTop = 0
  renderDetalhe()
  if (hist) {
    // eleição anterior: o resultado do ano e as outras eleições (para o histórico e a comparação)
    const det = estado.detalhe
    carregarHistorico()
    Promise.all([resumoAno(hist.ano), carregarHistorico()])
      .then(() => estado.detalhe === det && renderDetalhe())
      .catch(() => {
        if (estado.detalhe === det) ((det.erro = true), renderDetalhe())
      })
    return
  }
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

export function fecharDetalhe(voltarHistorico = true) {
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

export function dadosDetalhe() {
  const det = estado.detalhe
  if (!det) return null
  if (det.hist) return dadosHist(det.aba, det.abr)
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
  const idFoco = ['det-busca-mun', 'comp-busca', 'det-busca-bairro-mun', 'urnas-busca'].includes(document.activeElement?.id) ? document.activeElement.id : null
  const focoBusca = idFoco ? document.activeElement.selectionStart : null
  renderDetalheConteudo()
  sincronizarLink()
  for (const div of detalheEl.querySelectorAll('[data-mapa]')) montarMapaAberto(div)
  if (focoBusca != null) {
    const el = document.getElementById(idFoco)
    el?.focus()
    el?.setSelectionRange(focoBusca, focoBusca)
  }
}

function renderDetalheConteudo() {
  const det = estado.detalhe
  const aba = abaDe(det.aba)
  const d = dadosDetalhe()
  const voltar = `<div class="det-topo"><button type="button" class="det-voltar" data-fechar>‹ Voltar</button>
    <span class="det-onde">${esc(aba ? aba.rotulo.replace(/ SC$/, '') : '')} · ${esc(det.mun ? `${det.mun.nm} (SC)${det.mun.zona ? ` · ${Number(det.mun.zona)}ª zona` : ''}` : det.hist ? nomeAbr(det.abr) : NOMES_ABR[det.abr] || det.abr.toUpperCase())}</span>${botaoLink('det-link')}</div>`
  if (!d) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${det.erro ? '<div class="cartao vazio">Não consegui carregar os dados agora.</div>' : esqueleto('Carregando a ficha…')}</div>`
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
  const aba2 = det.comp?.aba ? abaDe(det.comp.aba) : aba
  const d2 = det.comp?.aba ? listaComp(det, det.comp.aba, det.comp.abr) : d
  const c2 = det.comp && d2?.candidatos?.find((x) => x.sqcand === det.comp.sqcand)
  if (c2) {
    const ex = det.comp.extra
    const d3 = ex ? (ex.aba ? listaComp(det, ex.aba, ex.abr) : d) : null
    const c3 = d3?.candidatos?.find((x) => x.sqcand === ex.sq)
    const ext = c3 ? { c: c3, d: d3, aba: ex.aba ? abaDe(ex.aba) : aba } : null
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${renderComparacao(d, c, c2, aba, d2, aba2, ext)}</div>`
    return
  }
  if (det.hist) {
    detalheEl.innerHTML = `<div class="det-corpo">${voltar}${fichaHist(det, d, c, aba)}</div>`
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
      <button type="button" class="botao comparar" data-comparar>${icone('comparar')} Comparar com outro candidato</button>
      <div class="exportar">${botaoCard('ficha-resumo', cardFicha(det, d, c, aba, pos, total), `${icone('compartilhar')} Compartilhar desempenho`, 'botao secundario')}<button type="button" class="botao secundario" data-relatorio>${icone('pdf')} Relatório em PDF</button></div>
    </section>
    <section class="cartao"><h3>Tendência</h3>${tendTxt}
      ${graficoLinha(ptsPct, { cor, fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoLinha(ptsVot, { cor, fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${ptsPos.length > 1 && new Set(ptsPos.map((p) => p.y)).size > 1 ? graficoLinha(ptsPos, { cor, fmtY: (v) => `${Math.round(-v)}º`, titulo: 'Posição (mais alto = melhor)' }) : ''}
    </section>
    ${secao2022(c, d, aba)}
    ${secaoHistorico(c, d, aba)}
    ${secaoAnalise(det, c, aba, d)}
    ${secaoBairros(det, c, aba)}
    ${secaoUrnas(det, c, aba)}
    ${secaoMapaFicha(det, c, aba)}
    ${secaoIdade(det, c, aba)}
    ${secaoMetas(det, c, aba)}
    <section class="cartao"><h3>${c.eleito || d.tseDefinido ? 'Situação oficial (TSE)' : 'Chance de reverter'}</h3>${textoChance(d, c, aba)}</section>
    <section class="cartao"><h3>Disputa</h3>${blocoDisputa(d, c, aba)}</section>
    ${aba?.tipo === 'prop' ? secaoQuocienteFicha(d, c, det) : ''}
    ${vices}
    ${floripa}
  </div>`
}

// ficha de um candidato de uma eleição anterior (2012 a 2024): resultado oficial do TSE, histórico,
// onde foi mais votado (até a urna), mapa
function fichaHist(det, d, c, aba) {
  const re = () => estado.detalhe === det && renderDetalhe()
  const cor = corPartido(c.partido)
  const pos = d.candidatos.indexOf(c) + 1
  const total = d.candidatos.length
  const onde = nomeAbr(det.abr)
  const municipalAno = !!histDe(aba.ano).resumo?.municipal
  if (municipalAno) arquivoAno(`dados${aba.ano}/perfil.json`, re)
  return `<section class="cartao det-cabeca" style="${estiloCor(cor)}">
      <div class="det-id">
        ${foto(c, cor)}
        <div class="cand-info">
          <h2>${esc(c.nome)}</h2>
          ${c.nomeCompleto && c.nomeCompleto !== c.nome ? `<p class="mudo det-completo">${esc(c.nomeCompleto)}</p>` : ''}
          <div class="cand-meta">${pill(c.partido, cor)} nº ${esc(c.numero)}${c.fed ? ` · ${esc(c.fed)}` : ''}</div>
          <div class="det-selo">${situ2022(c.sit || '')}</div>
          ${municipalAno ? linhaPerfil(aba.ano, c.sq) : ''}
        </div>
        ${estrela(c, det.aba, det.abr)}
      </div>
      <div class="fav-nums">
        <div><span class="fav-rot">Votos</span><strong>${fmt.format(c.votos)}</strong></div>
        <div><span class="fav-rot">% válidos</span><strong>${fmtPct.format(c.percentual)}%</strong></div>
        <div><span class="fav-rot">Posição</span><strong>${pos}º</strong><span class="mudo">de ${total}</span></div>
      </div>
      <p class="nota">📅 Eleições ${aba.ano} · ${esc(aba.rotulo.replace(/ \d{4}$/, ''))} · ${esc(onde)} · resultado oficial (TSE, dados abertos)${ehFavorito(det.aba, det.abr, det.sqcand) ? '' : ' · toque no ♡ para acompanhar'}</p>
      <button type="button" class="botao comparar" data-comparar>${icone('comparar')} Comparar com outro candidato</button>
      <div class="exportar">${botaoCard('ficha-resumo', cardFichaHist(det, d, c, aba, pos, total), `${icone('compartilhar')} Compartilhar desempenho`, 'botao secundario')}<button type="button" class="botao secundario" data-relatorio>${icone('pdf')} Relatório em PDF</button></div>
    </section>
    <section class="cartao"><h3>🏁 Resultado e disputa</h3>${blocoDisputaHist(d, c, aba, re)}</section>
    ${secaoHistorico(c, d, aba)}
    ${secaoAnalise(det, c, aba, d)}
    ${secaoBairros(det, c, aba)}
    ${secaoUrnas(det, c, aba)}
    ${secaoMapaFicha(det, c, aba)}
    ${secaoIdade(det, c, aba)}
    ${secaoMetas(det, c, aba)}`
}

// card da ficha de uma eleição anterior: resultado oficial e os lugares mais fortes (se já carregados)
function cardFichaHist(det, d, c, aba, pos, total) {
  const cor = corPartido(c.partido)
  const onde = nomeAbr(det.abr)
  const fortes = det.bai?.export?.card?.linhas?.slice(0, 4) || []
  return {
    chapeu: `ELEIÇÕES ${aba.ano} · ${onde.toUpperCase()}`, foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ \d{4}$/, '')}`,
    titulo: 'Resultado oficial', subtitulo: `${(c.sit || '').toLowerCase().replace(/^./, (m) => m.toUpperCase())} · TSE`, fonte: `Fonte: TSE · resultado ${aba.ano}`,
    tiles: [
      { rot: 'Votos', valor: fmt.format(c.votos) },
      { rot: '% dos válidos', valor: `${fmtPct.format(c.percentual)}%` },
      { rot: 'Posição', valor: `${pos}º`, sub: `de ${total} candidatos${d.cd ? ' na cidade' : ''}` },
      { rot: 'Situação', valor: c.eleito ? '✔ Eleito' : /2º turno/i.test(c.sit || '') ? '2º turno' : /suplente/i.test(c.sit || '') ? 'Suplente' : 'Não eleito' },
    ],
    ...(fortes.length ? { linhas: fortes } : {}),
  }
}

// resultado de um candidato de eleição anterior: lugar, distâncias, partido e (vereador) quociente eleitoral
function blocoDisputaHist(d, c, aba, re) {
  const pos = d.candidatos.indexOf(c) + 1
  const acima = d.candidatos[pos - 2]
  const abaixo = d.candidatos[pos]
  const onde = d.cd ? NOME_MUN.get(d.cd) || '' : 'SC'
  const itens = [`${pos === 1 ? '🥇' : '🏁'} <strong>${pos}º lugar</strong> em ${esc(onde)}, com <strong>${fmt.format(c.votos)}</strong> votos (${fmtPct.format(c.percentual)}% dos votos nominais)`]
  if (acima) itens.push(`▼ <strong>${fmt.format(acima.votos - c.votos)}</strong> votos atrás do ${pos - 1}º (${esc(acima.nome)}, ${esc(acima.partido)})`)
  if (abaixo) itens.push(`▲ <strong>${fmt.format(c.votos - abaixo.votos)}</strong> votos à frente do ${pos + 1}º (${esc(abaixo.nome)}, ${esc(abaixo.partido)})`)
  if (aba.tipo === 'prop') {
    const vagas = d.candidatos.filter((x) => x.eleito).length
    const doPartido = d.candidatos.filter((x) => x.agremiacao === c.agremiacao)
    const eleitosP = doPartido.filter((x) => x.eleito)
    const nome = c.agremiacao
    itens.push(`🏛️ ${doPartido.indexOf(c) + 1}º mais votado de ${esc(nome)} (${doPartido.length} candidatos) · o partido elegeu <strong>${eleitosP.length}</strong> de ${vagas} vagas`)
    const ultimo = eleitosP[eleitosP.length - 1]
    if (!c.eleito && ultimo) itens.push(`🎯 Ficou a <strong>${fmt.format(ultimo.votos - c.votos)}</strong> votos do último eleito do partido (${esc(ultimo.nome)}, ${fmt.format(ultimo.votos)})`)
    if (!c.eleito && !eleitosP.length) itens.push('O partido não elegeu ninguém.')
    // câmara de vereadores: quociente eleitoral e forma de eleição (scripts/gerar_municipais.py)
    if (aba.cargo === 13 && d.cd) {
      const cam = arquivoAno(`dados${aba.ano}/municipal.json`, re).valor?.[d.cd]?.cam
      if (cam?.qe) {
        const forma = cam.el.find((x) => x[0] === c.sq)?.[4]
        itens.push(`📐 Quociente eleitoral da câmara: <strong>${fmt.format(cam.qe)}</strong> votos (${fmt.format(cam.val)} válidos ÷ ${cam.vagas} vagas). ${esc(c.nome)} fez <strong>${fmtPct.format(pctDe(c.votos, cam.qe))}%</strong> do QE${c.votos >= 0.1 * cam.qe ? ' (passou dos 10% exigidos para vaga por QP)' : ' (abaixo dos 10% do QE)'}${forma ? `. Eleito por ${forma === 'QP' ? 'quociente partidário' : 'média (sobras)'}` : ''}.`)
      }
    } else if (d.el.qe) itens.push(`📐 Quociente eleitoral: <strong>${fmt.format(d.el.qe)}</strong> votos · ${esc(c.nome)} fez ${fmtPct.format(pctDe(c.votos, d.el.qe))}% do QE.`)
  } else {
    if (pos === 1 && abaixo) itens.push(`🏆 Venceu com <strong>${fmtPct.format(c.percentual - abaixo.percentual)}</strong> p.p. de vantagem sobre ${esc(abaixo.nome)}`)
    if (aba.cargo !== 5 && aba.el.startsWith('t1') && c.percentual > 50) itens.push('✅ Mais de 50% dos votos válidos')
    if (/2º turno|2º TURNO/i.test(c.sit || '')) itens.push('↪ Foi ao 2º turno')
  }
  return `<div class="chance-det">${situ2022(c.sit || '')}</div><ul class="det-lista">${itens.map((i) => `<li>${i}</li>`).join('')}</ul>
    <p class="nota">Resultado oficial do TSE (${aba.ano}).${ehMunicipal(aba.cargo) ? ' Posição e % dentro do município.' : ''}</p>`
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
const abasComparaveis = (det) => (det.abr === UF || det.hist ? ABAS.filter((a) => a.cargo && a.abrangencias.includes(UF)) : [])

// lista de candidatos do outro lado da comparação: um cargo de 2026 (SC) ou uma eleição anterior
function listaComp(det, abaId, abr) {
  if (ehAbaHist(abaId)) {
    const d = dadosHist(abaId, abr || 'sc')
    if (!d && !histDe(abaHist(abaId).ano).resumo) resumoAno(abaHist(abaId).ano).then(() => estado.detalhe === det && renderDetalhe()).catch(() => {})
    return d
  }
  return det.compListas?.[abaId]
}

function carregarListaComp(det, abaId) {
  if (ehAbaHist(abaId)) return listaComp(det, abaId, null)
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
  if (det.compCargo === 'hist') return escolherCompHist(det, c, outras)
  const abaSel = outras.find((a) => a.id === det.compCargo) || null
  let base = d
  if (abaSel) {
    carregarListaComp(det, abaSel.id)
    base = det.compListas[abaSel.id]
  }
  const seletor = outras.length
    ? seletorCompCargo(det, outras, abaSel)
    : ''
  const cab = `<section class="cartao">
    <h3>⚖️ ${det.escolhendo === 'extra' ? `3º candidato para comparar com ${esc(c.nome)}` : `Comparar ${esc(c.nome)} com…`}</h3>${seletor}
    <input id="comp-busca" type="search" placeholder="Buscar ${abaSel ? esc(abaSel.rotulo.replace(/ SC$/, '')) : ''} por nome, partido ou número…" value="${esc(det.buscaComp || '')}" autocomplete="off">`
  if (!base?.candidatos) return `${cab}<p class="nota">${base?.erro ? 'Não consegui carregar os candidatos deste cargo agora.' : 'Carregando os candidatos…'}</p><button type="button" class="botao secundario" data-sair-comp>Cancelar</button></section>`
  const termo = semAcento((det.buscaComp || '').trim())
  const lista = base.candidatos
    .filter((x) => x !== c && x.valido && !(det.escolhendo === 'extra' && x.sqcand === det.comp?.sqcand))
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

// cargos da comparação: a mesma eleição, os cargos de 2026 em SC e as eleições anteriores (2012 a 2024)
const seletorCompCargo = (det, outras, abaSel) =>
  `<div class="segmentado comp-cargos" role="group" aria-label="Cargo do outro candidato"><button type="button" data-comp-cargo="" aria-pressed="${!abaSel && det.compCargo !== 'hist'}">${det.hist ? 'Mesma eleição' : 'Mesmo cargo'}</button>${outras
    .map((a) => `<button type="button" data-comp-cargo="${a.id}" aria-pressed="${abaSel === a}">${esc(a.rotulo.replace(/ SC$/, ''))}${det.hist ? ' 2026' : ''}</button>`)
    .join('')}<button type="button" data-comp-cargo="hist" aria-pressed="${det.compCargo === 'hist'}">📅 Outra eleição</button></div>`

// comparar com um candidato de outra eleição (2012 a 2024): as outras participações do próprio candidato
// (evolução) e a busca por nome em todos os anos
function escolherCompHist(det, c, outras) {
  if (!det.histPedido) det.histPedido = carregarHistorico().then(() => estado.detalhe === det && det.compCargo === 'hist' && renderDetalhe())
  const termo = semAcento((det.buscaComp || '').trim())
  const palavras = termo.split(/\s+/).filter(Boolean)
  const atualId = det.hist ? `${det.aba}|${det.abr}|${det.sqcand}` : ''
  const item = ({ el, c: x }) => {
    const cor = corPartido(x.partido)
    const id = idHist(el.ano, el.id)
    if (`${id}|${x.cd || 'sc'}|${x.sq}` === atualId) return ''
    return `<li><button type="button" data-comp-sq="${esc(x.sq)}" data-comp-aba="${esc(id)}" data-comp-abr="${esc(x.cd || 'sc')}" style="${estiloCor(cor)}">
      <span class="pos">${el.ano}</span>
      <span class="comp-nome"><strong>${esc(x.nome)}</strong> ${pill(x.partido, cor)} <small class="mudo">${esc(ROTULO_ELEICAO[el.id] || el.nome)}${x.cd ? ` · ${esc(NOME_MUN.get(x.cd) || '')}` : ''}</small></span>
      <span class="mudo">${fmt.format(x.votos)}</span></button></li>`
  }
  const proprias = acharAnteriores(c)
  let achados = []
  if (palavras.length && termo.length >= 3)
    for (const ano of ANOS_HIST) {
      const R = histDe(ano).resumo
      if (!R) continue
      for (const el of R.eleicoes) for (const x of el.candidatos) if (casa(semAcento(`${x.nome} ${x.nomeCompleto} ${x.partido}`), palavras)) achados.push({ el, c: x })
    }
  achados = achados.sort((a, b) => b.el.ano - a.el.ano || b.c.votos - a.c.votos).slice(0, 60)
  return `<section class="cartao">
    <h3>⚖️ ${det.escolhendo === 'extra' ? `3º candidato para comparar com ${esc(c.nome)}` : `Comparar ${esc(c.nome)} com…`}</h3>${seletorCompCargo(det, outras, null)}
    <input id="comp-busca" type="search" placeholder="Buscar candidato de 2012 a 2024 pelo nome…" value="${esc(det.buscaComp || '')}" autocomplete="off">
    ${termo.length >= 3
      ? `<ul class="comp-lista">${achados.map(item).join('') || '<li class="nota">Nenhum candidato encontrado.</li>'}</ul>`
      : `${proprias.length ? `<p class="atalhos-rot">📜 ${esc(c.nome)} em outras eleições (evolução)</p><ul class="comp-lista">${proprias.map(item).join('')}</ul>` : ''}<p class="nota">Digite ao menos 3 letras do nome para buscar entre todos os candidatos de 2012 a 2024 em SC.</p>`}
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

function renderComparacao(d, a, b, aba, d2 = d, aba2 = aba, ext = null) {
  const det = estado.detalhe
  const outroCargo = aba2 !== aba || (ext && ext.aba !== aba)
  const corA = corPartido(a.partido)
  let corB = corPartido(b.partido)
  // mesmo partido: o segundo fica com uma cor neutra para as barras se distinguirem
  if (corB === corA) corB = '#6b7570'
  let corC = ext ? corPartido(ext.c.partido) : null
  if (ext && (corC === corA || corC === corB)) corC = corB === '#6b7570' ? '#9b6b2f' : '#6b7570'
  const pa = d.candidatos.indexOf(a) + 1, pb = d2.candidatos.indexOf(b) + 1
  const cargoDe = (ab, c) => (ab ? `${ab.rotulo.replace(/ SC$/, '')}${ab.hist && c?.cd ? ` · ${NOME_MUN.get(c.cd) || ''}` : ''}` : '')
  const lider = a.votos >= b.votos ? a : b
  const outro = lider === a ? b : a
  const dif = lider.votos - outro.votos
  const hist = !!(aba?.hist || aba2?.hist || ext?.aba?.hist)
  const sa = hist ? [] : serieDe(det, a.sqcand), sb = outroCargo || hist ? [] : serieDe(det, b.sqcand)
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
      ${outroCargo ? `<span class="comp-cargo">${esc(cargoDe(c === a ? aba : aba2, c))}</span>` : ''}
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
      <div class="comp-topo ${ext ? 'tres' : ''}">${lado(a, corA, pa, ga)}<span class="comp-vs">×</span>${lado(b, corB, pb, gb)}${ext ? `<span class="comp-vs">×</span>${ladoExt(ext, corC)}` : ''}</div>
      <div class="comp-veredito" style="${estiloCor(corPartido(lider.partido))}">
        ${dif === 0 ? 'Empatados' : outroCargo ? `<strong>${esc(lider.nome)}</strong> teve <strong>${fmt.format(dif)}</strong> votos a mais${hist ? '' : ' em SC'}` : hist ? `<strong>${esc(lider.nome)}</strong> teve <strong>${fmt.format(dif)}</strong> votos a mais (${fmtPct.format(Math.abs(a.percentual - b.percentual))} p.p.)` : `<strong>${esc(lider.nome)}</strong> está <strong>${fmt.format(dif)}</strong> votos à frente (${fmtPct.format(Math.abs(a.percentual - b.percentual))} p.p.)`}
      </div>
      <table class="comp-tabela"><tbody>
        ${linha('Votos', a.votos, b.votos, true, (v) => fmt.format(v))}
        ${linha(outroCargo ? '% dos válidos (no seu cargo)' : '% dos válidos', a.percentual, b.percentual, true, (v) => `${fmtPct.format(v)}%`)}
        ${linha(outroCargo ? 'Posição no seu cargo' : 'Posição', pa, pb, false, (v) => `${v}º`)}
        ${ga || gb ? linha('Ganho na última atualização', ga, gb, true, (v) => `+${fmt.format(v)}`) : ''}
      </tbody></table>
      <p class="nota">${hist ? 'Resultado oficial do TSE' : `${fmtPct.format(d.secoes.percentual)}% das seções apuradas`}${det.mun && !outroCargo ? ` · ${esc(det.mun.nm)}` : outroCargo && !hist ? ' · Santa Catarina' : ''}. Em verde, quem leva vantagem em cada linha.${outroCargo ? ` ${hist ? 'Eleições ou cargos diferentes' : 'Cargos diferentes'}: ${esc(a.nome)} (${esc(cargoDe(aba, a))}) × ${esc(b.nome)} (${esc(cargoDe(aba2, b))})${hist ? '; % e posição são de cada um na sua eleição.' : '; cada eleitor vota nos dois cargos, então os votos podem ser comparados lugar a lugar.'}` : ''}</p>
      ${ext ? tabela3(d, a, b, ext, aba, aba2, d2, [corA, corB, corC]) : ''}
      <div class="pm-botoes"><button type="button" class="botao secundario" data-trocar-comp>Trocar candidato</button>
        ${ext ? '<button type="button" class="botao secundario" data-comp-rem3>Tirar o 3º candidato</button>' : '<button type="button" class="botao secundario" data-comp-add3>+ Comparar com mais um (3º)</button>'}
        <button type="button" class="botao secundario" data-sair-comp>Sair da comparação</button></div>
      <div class="exportar">${botaoCard('comparacao', {
        ...(hist ? { chapeu: 'ELEIÇÕES EM SANTA CATARINA' } : {}),
        nome: `${a.nome} × ${b.nome}`, cor: corA, fotos: [b.foto, a.foto], sub: outroCargo ? `${cargoDe(aba, a)} × ${cargoDe(aba2, b)}${hist ? '' : ' · SC'}` : `${cargoDe(aba, a)}${det.mun ? ` · ${det.mun.nm}` : ''} · ${hist ? 'resultado oficial' : `${fmtPct.format(d.secoes.percentual)}% apurado`}`,
        titulo: 'Comparação', subtitulo: dif === 0 ? 'Empatados' : outroCargo ? `${lider.nome} teve ${fmt.format(dif)} votos a mais` : `${lider.nome} está ${fmt.format(dif)} votos à frente`,
        tiles: [
          { rot: `${a.nome} · votos`, valor: fmt.format(a.votos), cor: corA }, { rot: `${b.nome} · votos`, valor: fmt.format(b.votos), cor: corB },
          { rot: '% dos válidos', valor: `${fmtPct.format(a.percentual)}%`, cor: corA }, { rot: '% dos válidos', valor: `${fmtPct.format(b.percentual)}%`, cor: corB },
          { rot: outroCargo ? `Posição · ${cargoDe(aba, a)}` : 'Posição', valor: `${pa}º`, sub: a.partido, cor: corA }, { rot: outroCargo ? `Posição · ${cargoDe(aba2, b)}` : 'Posição', valor: `${pb}º`, sub: b.partido, cor: corB },
        ],
      })}</div>
    </section>
    ${outroCargo || hist ? '' : `<section class="cartao"><h3>Evolução</h3>${tendDif}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsPct(sa) }, { nome: b.nome, cor: corB, pontos: ptsPct(sb) }], { fmtY: (v) => `${fmtPct.format(v)}%`, titulo: '% dos votos válidos' })}
      ${graficoDuplo([{ nome: a.nome, cor: corA, pontos: ptsVot(sa) }, { nome: b.nome, cor: corB, pontos: ptsVot(sb) }], { fmtY: (v) => fmt.format(Math.round(v)), zero: true, titulo: 'Votos acumulados' })}
      ${sa.length < 2 || sb.length < 2 ? '<p class="nota">Os gráficos aparecem depois de algumas atualizações com votos novos.</p>' : ''}
    </section>`}
    ${secaoCompDiferenca(det, [{ c: a, cor: corA, aba }, { c: b, cor: corB, aba: aba2 }, ...(ext ? [{ c: ext.c, cor: corC, aba: ext.aba }] : [])]) ?? (det.abr === UF || aba?.id === 'presidente' ? secaoCompMunicipios(det, a, b, corA, corB) : '')}`
}

// terceiro candidato da comparação: cabeçalho e tabela com os três
function ladoExt(ext, cor) {
  const c = ext.c
  return `<div class="comp-lado" style="${estiloCor(cor)}">${foto(c, cor)}
      <span class="comp-cargo">${esc(ext.aba.rotulo.replace(/ SC$/, ''))}</span>
      <strong class="comp-nome-g">${esc(c.nome)}</strong><div>${pill(c.partido, corPartido(c.partido))}</div>
      <div class="comp-selos">${selo(c)}</div></div>`
}
function tabela3(d, a, b, ext, aba, aba2, d2, cores) {
  const L = [[a, d, aba], [b, d2, aba2], [ext.c, ext.d, ext.aba]]
  const cel = (vals, melhor, f) => vals.map((v) => `<td class="${v === melhor ? 'vence' : ''}">${f(v)}</td>`).join('')
  const votos = L.map(([c]) => c.votos), pcts = L.map(([c]) => c.percentual), pos = L.map(([c, dd]) => dd.candidatos.indexOf(c) + 1)
  return `<table class="comp-tabela tres"><thead><tr><th></th>${L.map(([c], i) => `<th style="color:${cores[i]}">${esc(c.nome)}</th>`).join('')}</tr></thead><tbody>
    <tr><th>Votos</th>${cel(votos, Math.max(...votos), (v) => fmt.format(v))}</tr>
    <tr><th>% válidos</th>${cel(pcts, Math.max(...pcts), (v) => `${fmtPct.format(v)}%`)}</tr>
    <tr><th>Posição</th>${cel(pos, Math.min(...pos), (v) => `${v}º`)}</tr></tbody></table>`
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
function dadosDiferenca(D, P, re) {
  const fora = D.mun ? new Set(D.mun.cds) : null
  const zero = () => P.map(() => 0)
  if (D.grupo === 'mun' || D.grupo === 'assoc' || D.grupo === 'meso') {
    if (P.some((p) => p.F.erro)) return { erro: true }
    if (P.some((p) => !p.F.mun)) return { msg: 'Carregando os votos por município…' }
    const Ms = P.map((p) => ({ valor: { validos: p.F.mun.validos, c: { [p.nr]: p.F.mun.meus } } }))
    const g = new Map()
    for (const cd of Object.keys(Ms[0].valor.validos)) {
      if (fora && !fora.has(cd)) continue
      const k = D.grupo === 'mun' ? cd : D.grupo === 'assoc' ? ASSOCIACAO_MUN[cd] : MUN_REG.get(cd)?.meso
      if (!k) continue
      const x = g.get(k) || { k, v: zero(), val: zero() }
      P.forEach((p, i) => {
        x.v[i] += Ms[i].valor.c[p.nr]?.[cd] || 0
        x.val[i] += Ms[i].valor.validos[cd] || 0
      })
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
  // os arquivos de seções do ano de cada candidato (zonas e bairros se mantêm entre eleições; locais, não)
  const anos = [...new Set(P.map((p) => p.F.ano))]
  const arqs = cds.map((cd) => [cd, Object.fromEntries(anos.map((ano) => [ano, secoesAno(ano, cd, re)]))])
  const prontos = arqs.filter(([, a]) => anos.every((ano) => a[ano]))
  const faltam = arqs.filter(([cd, a]) => anos.some((ano) => !a[ano] && !erroSecoes(ano, cd))).length
  if (!prontos.length) return { msg: faltam ? `Carregando as seções de ${esc(D.mun.nm)}…` : 'Os boletins deste lugar ainda não estão no app.' }
  const linhas = []
  for (const [cd, porAno] of prontos) {
    const arq = porAno[P[0].F.ano]
    // prefeito/vereador de outra cidade: sem votos aqui (o número se repete entre cidades)
    const gs = P.map((p) => (p.F.cdFixo && p.F.cdFixo !== cd ? new Map() : new Map(agregarSecoes(porAno[p.F.ano], p.F.el, {}, D.grupo, p.nr).grupos.map((x) => [x.chave, x]))))
    const nmMun = NOME_MUN.get(cd) || cd
    for (const k of new Set(gs.flatMap((g) => [...g.keys()]))) {
      let nome = k, sub = regiao ? nmMun : ''
      if (D.grupo === 'zona') nome = `${Number(k)}ª zona${cd === FLORIPA_CD && ROTULO_ZONA[z4(k)] ? ` · ${ROTULO_ZONA[z4(k)]}` : ''}`
      else if (D.grupo === 'local') {
        nome = tituloLocal((arq.locais[k] || [k])[0])
        sub = [bairroDoLocal(arq, k), regiao ? nmMun : ''].filter(Boolean).join(' · ')
      }
      linhas.push({ k: `${cd}|${k}`, nome, sub, v: gs.map((g) => g.get(k)?.foco || 0), val: gs.map((g) => g.get(k)?.validos || 0) })
    }
  }
  return { linhas, aviso: faltam ? `Carregando mais ${faltam} município(s)…` : '' }
}

// fonte dos votos da comparação, conforme os anos dos candidatos
const anos2 = (P) => {
  const anos = [...new Set(P.map((p) => p.F?.ano || 2026))].sort()
  return anos.length === 1 && anos[0] === 2026 ? 'Votos do 1º turno nos boletins de urna (TSE).' : `Votos por seção (TSE) de ${anos.join(' e ')}.`
}
// vantagem do candidato i sobre o melhor dos outros, num lugar
const vantagem = (x, i) => x.v[i] - Math.max(...x.v.filter((_, j) => j !== i))
const ordemNoLugar = (x) => x.v.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)

// barras lado a lado dos candidatos em cada lugar (2 ou 3)
function listaDueloN(itens, P) {
  const max = Math.max(1, ...itens.flatMap((i) => i.v))
  const barra = (v) => `${Math.max(v ? 1.5 : 0, (100 * v) / max)}%`
  const lado = (X, v, i) => `<div class="cmp-ano duo ${i ? 'b' : 'a'}" style="--cor:${X.cor}"><span class="cmp-rot" title="${esc(X.nome)}">${esc(X.nome)}</span><span class="cmp-trilho"><span style="width:${barra(v)};background:${X.cor}"></span></span><span class="cmp-num"><strong>${fmt.format(v)}</strong></span></div>`
  return `<div class="cmp-lista" role="list">${itens
    .map((x) => {
      const o = ordemNoLugar(x)
      const d = x.v[o[0]] - x.v[o[1]]
      const lider = P[o[0]]
      const pctI = (i) => (x.val?.[i] ? ` ${fmtPct.format(pctDe(x.v[i], x.val[i]))}%` : '')
      const meta = P.length > 2
        ? o.map((i, n) => `${n + 1}º ${esc(P[i].nome)}${pctI(i)}`).join(' · ')
        : (d ? `${esc(lider.nome)} teve ${fmt.format(d)} votos a mais${x.v[o[1]] > 0 ? ` (${fmtDec(x.v[o[0]] / x.v[o[1]])}×)` : ''}` : 'Mesma votação') +
          (x.val?.[0] ? ` · ${x.v.map((v, i) => `${fmtPct.format(pctDe(v, x.val[i]))}%`).join(' × ')} dos válidos` : '')
      return `<div class="cmp-linha ${x.ir ? 'clicavel' : ''}" role="listitem" ${x.ir || ''}>
        <div class="cmp-topo"><div class="cmp-nome"><strong>${esc(x.nome)}</strong>${x.sub ? ` <span class="mudo">· ${esc(x.sub)}</span>` : ''}</div>${d ? `<span class="var var-a" style="--cor:${lider.cor}">+${fmt.format(d)}</span>` : '<span class="var">empate</span>'}</div>
        ${P.map((p, i) => lado(p, x.v[i], i)).join('')}
        <div class="cand-meta">${meta}</div>
      </div>`
    })
    .join('')}</div>`
}
// compatível com o formato de 2 candidatos (a, b) usado no Meu território
const listaDuelo = (itens, A, B) => listaDueloN(itens.map((i) => ({ ...i, v: [i.a, i.b], val: i.valA ? [i.valA, i.valB] : null })), [A, B])

function secaoCompDiferenca(det, lista) {
  // lista: [{ c, cor, aba }] com 2 ou 3 candidatos; a ficha é sempre o primeiro
  if ((det.abr !== UF && !det.hist) || lista.some((x) => !x.aba?.cargo)) return null
  const re = () => estado.detalhe === det && renderDetalhe()
  // cada candidato com a sua fonte: 2026 (boletins de urna) ou uma eleição anterior (dados abertos)
  const P = lista.map(({ c, cor, aba }) => {
    const F = fonteFicha(det, c, aba, re)
    return { nome: c.nome, cor, nr: F.nr, el: F.elId, cargo: aba.cargo, rot: `${aba.rotulo.replace(/ SC$/, '')}${F.cdFixo ? ` · ${NOME_MUN.get(F.cdFixo) || ''}` : ''}`, c, F, chave: `${F.ano}|${F.elId}` }
  })
  // prefeito/vereador: começa na cidade (o voto é só nela)
  const cdIni = P.find((p) => p.F.cdFixo)?.F.cdFixo
  const D = (det.comp.dif ??= { grupo: cdIni ? 'zona' : 'mun', modo: 'w0', mun: cdIni ? lugarBairros(cdIni) : null, painel: false, busca: '', todos: false })
  D.lista = lista
  if (!/^w\d$|^eq$|^v$/.test(D.modo) || Number(D.modo[1]) >= lista.length) D.modo = 'w0'
  const mesmoCargo = new Set(P.map((p) => p.chave)).size === 1
  const niveis = D.mun
    ? [...(D.mun.cds.length > 1 ? [['mun', 'Municípios']] : []), ['zona', 'Zonas'], ['bairro', 'Bairros'], ['local', 'Locais']]
    : [['mun', 'Municípios'], ['assoc', 'Associações'], ['meso', 'Regiões']]
  if (!niveis.some(([k]) => k === D.grupo)) D.grupo = niveis[0][0]
  const nomeNivel = Object.fromEntries(niveis)[D.grupo]
  const r = dadosDiferenca(D, P, re)
  // sem os arquivos de 2026: com 2 do mesmo cargo, cai na consulta ao TSE de antes
  if (r.erro && mesmoCargo && P.length === 2) return null
  const modos = [...P.map((p, i) => [`w${i}`, `${p.nome} na frente`]), ['eq', '≈ Mais parecidos'], ['v', 'Mais votos']]
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
    const soma = (x) => x.v.reduce((a, v) => a + v, 0)
    const spread = (x) => (Math.max(...x.v) - Math.min(...x.v)) / (soma(x) || 1)
    const minEq = D.grupo === 'zona' || D.grupo === 'bairro' || D.grupo === 'local' ? 50 : 300
    let vis
    if (D.modo[0] === 'w') {
      const i = Number(D.modo[1])
      vis = ls.filter((x) => vantagem(x, i) > 0).sort((x, y) => vantagem(y, i) - vantagem(x, i))
    } else if (D.modo === 'eq') vis = ls.filter((x) => x.v.every((v) => v > 0) && soma(x) >= minEq).sort((x, y) => spread(x) - spread(y) || soma(y) - soma(x))
    else vis = ls.filter((x) => soma(x) > 0).sort((x, y) => soma(y) - soma(x))
    const lim = D.todos ? vis.length : 15
    const vence = P.map((_, i) => ls.filter((x) => vantagem(x, i) > 0).length)
    const tot = P.map((_, i) => ls.reduce((t, x) => t + x.v[i], 0))
    const nivelMin = nomeNivel.toLowerCase()
    const rotOrdem = D.modo[0] === 'w' ? `onde ${P[Number(D.modo[1])].nome} ficou mais à frente` : D.modo === 'eq' ? 'onde a votação foi mais parecida' : 'mais votos somados'
    corpo = (r.aviso ? `<p class="nota">${r.aviso}</p>` : '') +
      `<p class="comp-placar">${P.map((p, i) => `<span style="${estiloCor(p.cor)}">${esc(p.nome)}: <strong>${fmt.format(tot[i])}</strong> votos · ${P.length > 2 ? '1º' : 'na frente'} em <strong>${fmt.format(vence[i])}</strong></span>`).join(' ')} <span class="mudo">${esc(nivelMin)} em ${esc(lugar)}</span></p>` +
      (vis.length ? listaDueloN(vis.slice(0, lim), P) : `<p class="nota">${D.modo[0] === 'w' ? `${esc(P[Number(D.modo[1])].nome)} não ficou à frente em nenhum lugar` : 'Sem votos'} em ${esc(lugar)}.</p>`) +
      (vis.length > lim ? `<button type="button" class="botao secundario" data-cd-todos>Mostrar todos (${fmt.format(vis.length)})</button>` : '') +
      `<p class="nota">${D.mun ? '' : 'Toque num município, associação ou região para ver as zonas e os bairros. '}${anos2(P)}${!mesmoCargo && new Set(P.map((p) => p.F.ano)).size === 1 ? ' Cada eleitor vota em todos os cargos, então a diferença mostra onde um puxou mais votos que o outro.' : ''}${new Set(P.map((p) => p.F.ano)).size > 1 && D.grupo === 'local' ? ' Locais de votação de anos diferentes têm códigos diferentes: compare por zona ou bairro.' : ''}</p>`
    // imagem, carrossel e planilha
    const tit = `${nomeNivel} · ${lugar}`
    const o = tot.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
    const total = { rot: D.mun ? `Soma ${{ mun: 'dos municípios', zona: 'das zonas', bairro: 'dos bairros', local: 'dos locais' }[D.grupo]} de ${lugar}` : 'Santa Catarina inteira', quem: P.map((p) => p.nome).join(' × '),
      valor: tot.map((v) => (P.length > 2 && v >= 10_000 ? `${fmt.format(Math.round(v / 1000))} mil` : fmt.format(v))).join(' × '), sub: o[0][0] === o[1][0] ? 'empate' : `${P[o[0][1]].nome} +${fmt.format(o[0][0] - o[1][0])}` }
    const base = { turno: turnoDe(P[0].el), foto: P[1].c.foto, fotos: P.slice(1, 2).map((p) => p.c.foto).concat(P[0].c.foto), nome: P.map((p) => p.nome).join(' × '), cor: P[0].cor,
      sub: mesmoCargo ? `${P[0].rot} · ${P.map((p) => p.c.partido).join(' × ')}` : P.map((p) => p.rot).join(' × ') }
    const linhaCar = (x, max) => {
      const ord = ordemNoLugar(x)
      const d = x.v[ord[0]] - x.v[ord[1]]
      return { nome: x.nome, extra: x.sub || '', par: { max, barras: P.map((p, i) => ({ rot: p.nome, v: x.v[i], cor: p.cor })) }, dir2: d ? `+${fmt.format(d)} ${P[ord[0]].nome}` : 'empate', corDir2: d ? P[ord[0]].cor : null }
    }
    const POR = P.length > 2 ? 5 : 6
    const montar = () => {
      const capaLin = vis.slice(0, P.length > 2 ? 2 : 3)
      const capa = { ...base, total, titulo: tit, subtitulo: rotOrdem,
        tiles: P.map((p, i) => ({ rot: `${p.nome} · votos`, valor: fmt.format(tot[i]), sub: `${P.length > 2 ? '1º' : 'na frente'} em ${fmt.format(vence[i])} ${nivelMin}`, cor: p.cor })),
        linhas: capaLin.map((x) => linhaCar(x, Math.max(1, ...capaLin.flatMap((y) => y.v)))) }
      const paginas = [capa]
      const max = Math.max(1, ...vis.flatMap((x) => x.v))
      const n = Math.min(9, Math.ceil(vis.length / POR))
      for (let k = 0; k < n; k++) paginas.push({ ...base, total, titulo: tit, subtitulo: `${rotOrdem}${n > 1 ? ` · parte ${k + 1} de ${n}` : ''}`, numerar: false, linhas: vis.slice(k * POR, (k + 1) * POR).map((x) => linhaCar(x, max)) })
      return paginas
    }
    const topo = vis.slice(0, POR)
    D.export = {
      card: { ...base, total, titulo: tit, subtitulo: rotOrdem, numerar: false, linhas: topo.map((x) => linhaCar(x, Math.max(1, ...topo.flatMap((y) => y.v)))) },
      carrossel: montar,
      paginas: 1 + Math.min(9, Math.ceil(vis.length / POR)),
      legenda: legendaShare(`${base.nome} · ${tit}`),
      csv: { nome: `${P.map((p) => nomeArquivo(p.nome)).join('-x-')}-${nomeArquivo(nomeNivel)}-${nomeArquivo(lugar)}.csv`,
        cab: [nomeNivel, 'Onde', ...P.map((p) => `${p.nome} (${p.rot})`), 'Quem ficou em 1º', 'Vantagem do 1º', ...P.map((p) => `% válidos ${p.nome}`)],
        linhas: vis.map((x) => { const ord = ordemNoLugar(x); return [x.nome, x.sub || '', ...x.v, P[ord[0]].nome, x.v[ord[0]] - x.v[ord[1]], ...x.v.map((v, i) => pctDe(v, x.val[i]))] }) },
    }
  }
  const mapa = !r.erro && !r.msg ? mapaComparacao(D, P, r.linhas) : ''
  return `<section class="cartao bai cdif"><h3>📍 Onde a diferença foi maior</h3>${controles}${corpo}${mapa}
    ${D.export ? `<div class="exportar">${botaoCard('comp-diferenca', D.export.card)}<button type="button" class="botao" data-cd-carrossel>${icone('carrossel')} Carrossel (${D.export.paginas} imagens)</button><button type="button" class="botao secundario" data-cd-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-cd-xlsx>${icone('baixar')} Excel</button><button type="button" class="botao secundario" data-cd-pdf>${icone('pdf')} Relatório em PDF</button><button type="button" class="botao secundario" data-cd-legenda>${icone('copiar')} Copiar legenda com o link do Instagram</button></div>` : ''}
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
  // outra eleição do mesmo candidato (histórico eleitoral): troca a ficha
  const candEl = ev.target.closest('[data-cand]')
  if (candEl) return abrirDetalhe({ aba: candEl.dataset.candAba, abr: candEl.dataset.candAbr, sqcand: candEl.dataset.cand, substituir: true })
  const det = estado.detalhe
  if (ev.target.closest('[data-comparar]') || ev.target.closest('[data-trocar-comp]')) {
    det.escolhendo = true
    det.buscaComp = ''
    det.compCargo = det.comp?.aba ? (ehAbaHist(det.comp.aba) ? 'hist' : det.comp.aba) : null
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  if (ev.target.closest('[data-comp-add3]')) return ((det.escolhendo = 'extra'), (det.buscaComp = ''), (det.compCargo = null), (detalheEl.scrollTop = 0), renderDetalhe())
  if (ev.target.closest('[data-comp-rem3]')) return ((det.comp.extra = null), renderDetalhe())
  const compSq = ev.target.closest('[data-comp-sq]')
  if (compSq && det.escolhendo === 'extra') {
    det.escolhendo = false
    det.comp.extra = { sq: compSq.dataset.compSq, aba: compSq.dataset.compAba || null, abr: compSq.dataset.compAbr || null }
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  if (compSq) {
    det.escolhendo = false
    det.comp = { sqcand: compSq.dataset.compSq, aba: compSq.dataset.compAba || null, abr: compSq.dataset.compAbr || null, porMun: null, dif: null }
    detalheEl.scrollTop = 0
    return renderDetalhe()
  }
  if (ev.target.closest('[data-sair-comp]') && det.escolhendo === 'extra') return ((det.escolhendo = false), renderDetalhe())
  if (ev.target.closest('[data-sair-comp]')) {
    det.escolhendo = false
    det.ctrlComp?.abort()
    det.comp = null
    return renderDetalhe()
  }
  const relBt = ev.target.closest('[data-relatorio]')
  if (relBt) return gerarRelatorio(relBt)
  const cdPdf = ev.target.closest('[data-cd-pdf]')
  if (cdPdf && det?.comp?.dif?.export) {
    const cmp = CARDS.get('comparacao')
    return gerarPDF([cmp, ...det.comp.dif.export.carrossel()].filter(Boolean), `${cmp?.nome || 'comparacao'}`, cdPdf)
  }
  if (det?.metas && tratarMetas(ev)) return
  if (det && tratarUrnas(ev, det)) return
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
    if (D.export && ev.target.closest('[data-cd-xlsx]')) return excelComparacao(det, ev.target.closest('[data-cd-xlsx]'))
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
  if (det?.idade && ev.target.closest('[data-idade-xlsx]')) return baixarExcel(det.idade.xlsx.nome, det.idade.xlsx.abas, ev.target.closest('[data-idade-xlsx]'))
  const zu = ev.target.closest('[data-bai-zona-urnas]')
  if (zu && det?.bai) {
    const us = (det.bai.zonasUrnas ??= new Set())
    const k = zu.dataset.baiZonaUrnas
    us.has(k) ? us.delete(k) : us.add(k)
    return renderDetalhe()
  }
  const bu = ev.target.closest('[data-bai-bairro-urnas]')
  if (bu && det?.bai) {
    const us = (det.bai.bairrosUrnas ??= new Set())
    const k = bu.dataset.baiBairroUrnas
    us.has(k) ? us.delete(k) : us.add(k)
    return renderDetalhe()
  }
  const uo = ev.target.closest('[data-bai-urnas-ord]')
  if (uo && det?.bai) return ((det.bai.ordUrnas = uo.dataset.baiUrnasOrd), renderDetalhe())
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
  const ucar = ev.target.closest('[data-urnas-car]')
  if (ucar && URNAS_CAR.has(ucar.dataset.urnasCar)) {
    const cards = URNAS_CAR.get(ucar.dataset.urnasCar)()
    // o Instagram aceita até 20 imagens por publicação: acima disso, vira PDF
    if (cards.length > 20) return gerarPDF(cards, `${cards[0].nome} · ${cards[0].titulo}`, ucar)
    ucar.disabled = true
    return compartilharCarrossel(cards, `${cards[0].nome} · ${cards[0].titulo}`, ucar).finally(() => (ucar.disabled = false))
  }
  const upar = ev.target.closest('[data-urnas-parte]')
  if (upar && URNAS_CAR.has(upar.dataset.urnasParte)) {
    const todas = URNAS_CAR.get(upar.dataset.urnasParte)()
    const i = Number(upar.dataset.parte)
    const partes = Math.ceil(todas.length / POR_POST)
    const cards = todas.slice(i * POR_POST, (i + 1) * POR_POST).map((cd) => ({ ...cd, chapeu: `${cd.chapeu} · PARTE ${i + 1}/${partes}` }))
    upar.disabled = true
    return compartilharCarrossel(cards, `${cards[0].nome} · ${cards[0].titulo} · parte ${i + 1} de ${partes}`, upar).finally(() => (upar.disabled = false))
  }
  const updf = ev.target.closest('[data-urnas-pdf]')
  if (updf && URNAS_CAR.has(updf.dataset.urnasPdf)) {
    const cards = URNAS_CAR.get(updf.dataset.urnasPdf)()
    return gerarPDF(cards, `${cards[0].nome} · ${cards[0].titulo}`, updf)
  }
  const btCar = ev.target.closest('[data-bai-carrossel]')
  if (btCar && det?.bai?.carrossel) {
    if (det.bai.export?.zonas && det.bai.export.zonas.every((z) => !z.dentro)) return
    const cards = det.bai.carrossel()
    btCar.disabled = true
    return compartilharCarrossel(cards, `${cards[0].nome} · ${cards[0].titulo}`, btCar).finally(() => (btCar.disabled = false))
  }
  if (det?.bai?.export && ev.target.closest('[data-bai-csv]')) return baixarCSV(det.bai.export.csv)
  if (det?.bai?.export && ev.target.closest('[data-bai-xlsx]')) return excelFicha(ev.target.closest('[data-bai-xlsx]'))
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
  const mi = ev.target.closest?.('[data-meta-k]')
  if (mi && estado.detalhe?.metas) {
    const M = estado.detalhe.metas
    const v = Math.max(0, Math.round(Number(String(mi.value).replace(/\D/g, '')) || 0))
    const t = (M.dados[M.nivel] ??= {})
    v ? (t[mi.dataset.metaK] = v) : delete t[mi.dataset.metaK]
    salvarMetas(M)
    // fora do evento: redesenhar tira o campo da tela, o que dispara outro "change" (blur) no meio do redesenho
    return setTimeout(() => estado.detalhe && renderDetalhe())
  }
  const sel = ev.target.closest('[data-bai-mun]')
  const det = estado.detalhe
  if (!sel || !det?.bai) return
  det.bai.mun = lugarBairros(sel.value)
  det.bai.todos = false
  renderDetalhe()
})
// abre a aba "Bairros" no bairro escolhido, com o candidato em destaque
function irParaBairro(det, cd, bairro, tipo, chave) {
  const aba = abaDe(det.aba)
  const d = dadosDetalhe()
  const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
  if (!aba?.cargo || !c) return
  const local = { cd, nm: NOME_MUN.get(cd) || cd }
  let grupo = 'local'
  if (tipo === 'zona') Object.assign(local, { zona: chave }), (grupo = 'bairro')
  else if (tipo === 'local') Object.assign(local, { localVot: chave, zona: chave.split('-')[0] }), (grupo = 'secao')
  else if (tipo === 'secao') Object.assign(local, { secao: chave, zona: chave.split('-')[0] }), (grupo = 'secao')
  else local.bairro = bairro
  // eleição anterior: abre o explorador do 📅 Histórico no ano dela
  if (aba.hist) Object.assign(H22, { ano: aba.ano, sel: aba.el, local, grupo, foco: Number(c.numero), mv: 'votos', vis: 'votos', busca: '', buscaMun: '', verTodos: false, verGrupos: false })
  else Object.assign(B26, { sel: eleicaoDoCargo(aba.cargo), local, grupo, foco: Number(c.numero), buscaMun: '', verTodos: false, verGrupos: false })
  const ir = () => {
    trocarAba(aba.hist ? 'h2022' : 'bairros')
    window.scrollTo({ top: 0 })
  }
  // fechar a ficha volta uma entrada do histórico; troca de aba só depois disso
  const voltar = history.state?.detalhe
  fecharDetalhe()
  if (voltar) window.addEventListener('popstate', () => setTimeout(ir), { once: true })
  else ir()
}
detalheEl.addEventListener('input', (ev) => {
  if (ev.target.id === 'urnas-zona' && estado.detalhe?.urnas) {
    Object.assign(estado.detalhe.urnas, { zona: ev.target.value ? Number(ev.target.value) : null, vis: 'urnas', todos: false, busca: '' })
    return renderDetalhe()
  }
  if (ev.target.id === 'urnas-faixa' && estado.detalhe?.urnas) {
    Object.assign(estado.detalhe.urnas, { faixa: ev.target.value === '' ? null : Number(ev.target.value), todos: false })
    return renderDetalhe()
  }
  if (ev.target.id === 'urnas-busca' && estado.detalhe?.urnas) {
    estado.detalhe.urnas.busca = ev.target.value
    estado.detalhe.urnas.todos = false
    return renderDetalhe()
  }
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

export const PREF = { mostrar2022: lerLocal('pref:2022', '1') === '1' }
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
      <details><summary>Abstenção, brancos e nulos</summary>
        <p>Por município, zona, bairro, local e seção, em 2026 e nas eleições de 2012 a 2024 (explorador das abas Bairros e Histórico, opção "📉 Abstenção, brancos e nulos"). <strong>Abstenção</strong> = eleitores aptos que não votaram ÷ aptos; aptos e comparecimento de cada seção vêm do arquivo do TSE "detalhe da votação por seção" (e, no 2º turno de 2026, dos boletins de urna). <strong>Brancos e nulos</strong> são em % dos votos do cargo escolhido; os nulos incluem os votos anulados (candidatos sem registro válido). Os totais de SC conferem com os do TSE.</p></details>
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
        <li><strong>Sem rastreamento:</strong> o app não usa cookies de publicidade nem ferramentas de análise de visitas. Consultar resultados não pede cadastro; a aba 🧭 Campanha pede nome, e-mail e senha (ou conta Google) e guarda só o que a equipe cria. <a href="termos.html" target="_blank" rel="noopener">Termos de uso</a> · <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a>.</li>
        <li><strong>Tudo fica no seu aparelho:</strong> candidatos acompanhados (❤️), preferências e a última aba aberta são salvos só no navegador deste aparelho.</li>
        <li><strong>Dados públicos:</strong> os resultados e as fotos dos candidatos são baixados direto dos servidores do TSE e deste site (no mapa da área 🔒, também do OpenStreetMap/Esri); nenhum dado pessoal é enviado.</li>
        <li><strong>Área 🔒:</strong> os dados exclusivos ficam criptografados (AES-256); a senha é verificada no próprio aparelho e não é enviada a lugar nenhum.</li>
      </ul>
    </section>
    ${CAMPANHA_ATIVA ? renderPrecos({ compacto: true }) : ''}
    <section class="cartao"><h3>ℹ️ Sobre esta versão</h3>
      <p>Versão <strong>${esc(versaoLegivel())}</strong> · Eleições 2026, ${TURNO}º turno.</p>
      <p class="nota">Encontrou algo estranho nos números? Fale com <a href="https://www.instagram.com/maiconcombat/" target="_blank" rel="noopener">@maiconcombat</a>.</p>
    </section>`
}
// "202610071200" → "07/10/2026 12:00"
const versaoLegivel = () => (/^\d{12}$/.test(VERSAO) ? `${VERSAO.slice(6, 8)}/${VERSAO.slice(4, 6)}/${VERSAO.slice(0, 4)} ${VERSAO.slice(8, 10)}:${VERSAO.slice(10, 12)}` : VERSAO || 'local')

/* ---------------- eleições de 2022 (SC) ---------------- */

export const H22 = { resumo: null, carregando: null, mun: new Map(), atual: null, atualT: 0, sel: 't1-c7', busca: '', ano: 2022 }
// eleições anteriores com dados no app (dados<ano>/): 2022 é o H22; as outras ficam em HIST
const ANOS_HIST = [2024, 2022, 2020, 2018, 2016, 2014, 2012]
const HIST = new Map([[2022, H22]])
const histDe = (ano) => {
  if (!HIST.has(ano)) HIST.set(ano, { resumo: null, carregando: null, mun: new Map(), indice: null })
  return HIST.get(ano)
}
const chaveNomeCompleto = (s) => semAcento(s || '').replace(/[^a-z]/g, '')
const ABA_DO_CARGO = { 3: 'governador', 5: 'senador', 6: 'depfed', 7: 'depest' }

export const resumo2022 = () => resumoAno(2022)
function resumoAno(ano) {
  const X = histDe(ano)
  if (X.resumo) return Promise.resolve(X.resumo)
  X.carregando ??= fetch(`dados${ano}/resumo.json?v=${VERSAO}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      X.indice = new Map()
      X.indice3 = new Map()
      for (const el of j.eleicoes) {
        el.id = `t${el.turno}-c${el.cargo}`
        el.ano = ano
        el.anul = new Set()
        // municipais: o número se repete entre as cidades, então o anulado vem com o município ("t1-c11-15-81051")
        for (const x of j.anulados.filter((x) => x.startsWith(el.id + '-'))) {
          const [, , nr, cd] = x.split('-')
          if (cd) (el.anulMun ??= new Map()).set(cd, (el.anulMun.get(cd) || new Set()).add(Number(nr)))
          else if (el.cargo !== 11 && el.cargo !== 13) el.anul.add(Number(nr))
        }
        el.partidos = j.partidos
        el.situ = (c) => situ2022(c.sit)
        el.candidatos.forEach((x, i) => {
          // municipais: x[8] = município do candidato (a posição é dentro do município)
          const c = { sq: x[0], numero: x[1], nome: x[2], nomeCompleto: x[3], partido: x[4], fed: x[5], votos: x[6], sit: x[7], pos: i + 1, cd: x[8] || null }
          el.candidatos[i] = c
          const k = chaveNomeCompleto(c.nomeCompleto)
          if (!X.indice.has(k)) X.indice.set(k, [])
          X.indice.get(k).push({ el, c })
          const k3 = tresNomes(c.nomeCompleto)
          if (k3) X.indice3.set(k3, [...(X.indice3.get(k3) || []), { el, c }])
        })
        if (ehMunicipal(el.cargo)) {
          const n = new Map()
          for (const c of el.candidatos) c.pos = (n.set(c.cd, (n.get(c.cd) || 0) + 1), n.get(c.cd))
        }
      }
      X.resumo = j
      return j
    })
    .catch((e) => {
      X.carregando = null
      throw e
    })
  return X.carregando
}

const mun2022 = (id) => munAno(2022, id)
function munAno(ano, id) {
  const X = histDe(ano)
  if (!X.mun.has(id)) {
    const p = fetch(`dados${ano}/mun-${id}.json?v=${VERSAO}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP'))))
    p.catch(() => X.mun.delete(id))
    X.mun.set(id, p)
    p.then((j) => (p.valor = j)).catch(() => {})
  }
  return X.mun.get(id)
}

// todas as participações do candidato nas eleições anteriores, da mais recente à mais antiga.
// Liga pelo nome completo; se não achar, aceita nome que só ganhou/perdeu sobrenomes no fim
// (ex.: "ANA CAROLINE CAMPAGNOLO" → "ANA CAROLINE CAMPAGNOLO GALVAO"), com pelo menos 3 nomes iguais.
const nomesDe = (n) => semAcento(n || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean)
const tresNomes = (n) => { const t = nomesDe(n); return t.length >= 3 ? t.slice(0, 3).join(' ') : '' }
function acharAnteriores(c) {
  if (!c?.nomeCompleto) return []
  const k = chaveNomeCompleto(c.nomeCompleto)
  const t = nomesDe(c.nomeCompleto)
  return ANOS_HIST.flatMap((ano) => {
    const X = HIST.get(ano)
    const exato = X?.indice?.get(k)
    if (exato?.length) return exato
    return (X?.indice3?.get(tresNomes(c.nomeCompleto)) || []).filter(({ c: v }) => {
      const u = nomesDe(v.nomeCompleto)
      const [a, b] = u.length <= t.length ? [u, t] : [t, u]
      return a.every((x, i) => x === b[i])
    })
  })
}
let historicoPronto = null
const carregarHistorico = () => (historicoPronto ??= Promise.allSettled(ANOS_HIST.map((a) => resumoAno(a))))

// Participações de um candidato de 2026 em 2022 (pelo nome completo).
export function achar2022(c) {
  if (!H22.resumo || !c?.nomeCompleto) return []
  return H22.indice.get(chaveNomeCompleto(c.nomeCompleto)) || []
}

const seta = (dp) => (Math.abs(dp) < 0.005 ? '＝' : dp > 0 ? `▲ ${fmtPct.format(dp)}` : `▼ ${fmtPct.format(-dp)}`)
const situ2022 = (sit) =>
  /^ELEITO/.test(sit) ? `<span class="tag eleito-tse"><b>✔ ${esc(sit.toLowerCase().replace(/^./, (m) => m.toUpperCase()))}</b></span>` : `<span class="tag nao-eleito">${esc(sit.toLowerCase().replace(/^./, (m) => m.toUpperCase()))}</span>`

// série histórica do candidato: todas as eleições de 2012 a 2024 em SC (pelo nome completo) + 2026
function secaoHistorico(c, d, aba) {
  if (!PREF.mostrar2022 || DEMO) return ''
  // carrega as eleições anteriores uma vez só: se um ano falhar, não fica redesenhando em laço
  if (!historicoPronto && !ANOS_HIST.every((a) => HIST.get(a)?.resumo || HIST.get(a)?.carregando)) carregarHistorico().then(() => estado.detalhe && renderDetalhe())
  const parts = acharAnteriores(c)
  if (!parts.length) return ''
  // na ficha de uma eleição anterior, "esta" é a participação da ficha; 2026 entra se ele concorre agora
  const a26 = d.hist ? atual2026(c) : null
  const itens = [
    ...parts.map(({ el, c: v }) => {
      const cid = v.cd ? cidadeDe(el, v.cd) : null
      const esta = d.hist && el.ano === d.ano && el.id === d.hist.el && v.sq === c.sq
      return { ano: el.ano, rot: `${ROTULO_ELEICAO[el.id] || el.nome}${v.cd ? ` · ${NOME_MUN.get(v.cd) || ''}` : ''}`, votos: v.votos, partido: v.partido,
        pos: `${v.pos}º de ${(cid || el).candidatos.length}`, sit: v.sit, agora: esta, ir: esta ? '' : attrHist(el.ano, el.id, v) }
    }),
    ...(!d.hist
      ? [{ ano: 2026, rot: `${aba?.rotulo.replace(/ SC$/, '') || ''}${d.mun ? ` · ${d.mun.nm}` : ''}`, votos: c.votos, partido: c.partido, pos: `${d.candidatos.indexOf(c) + 1}º de ${d.candidatos.length}`, agora: true }]
      : a26 ? [{ ano: 2026, rot: a26.aba.rotulo.replace(/ SC$/, ''), votos: a26.c.votos, partido: a26.c.partido, pos: `${a26.pos}º de ${a26.d.candidatos.length}`, tag: selo(a26.c) || '<span class="tag">2026</span>', ir: attrCand(a26.c, a26.aba.id, UF) }] : []),
  ].sort((a, b) => a.ano - b.ano || a.votos - b.votos)
  if (itens.length < 2 && d.hist) return ''
  const max = Math.max(1, ...itens.map((i) => i.votos))
  const cor = corPartido(c.partido)
  return `<section class="cartao historico"><h3>📜 Histórico eleitoral</h3>
    <ol class="hist-lista">${itens
      .map((i) => `<li class="${i.agora ? 'agora' : ''} ${i.ir ? 'clicavel' : ''}" ${i.ir || ''}><span class="hist-ano">${i.ano}</span><div class="hist-info"><div><strong>${esc(i.rot)}</strong> ${pill(i.partido)} ${i.agora ? `<span class="tag">${d.hist ? 'esta ficha' : 'agora'}</span>` : i.tag || situ2022(i.sit)}</div>
        <div class="barra fina"><span style="width:${(100 * i.votos) / max}%;background:${i.agora ? cor : 'var(--mudo)'}"></span></div>
        <div class="cand-meta">${fmt.format(i.votos)} votos · ${i.pos}${i.ir ? ' · <span class="link-ficha">ver a ficha ›</span>' : ''}</div></div></li>`)
      .join('')}</ol>
    <p class="nota">Eleições em SC de 2012 a 2024 (TSE, dados abertos), ligadas pelo nome completo. Prefeito e vereador: posição dentro do município. Toque numa eleição para abrir a ficha dela.</p></section>`
}

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
    await resumoAno(H22.ano || 2022)
  } catch {
    conteudo.innerHTML = '<div class="cartao vazio erro"><p>Não consegui carregar os dados dessa eleição.</p></div>'
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
  statusEl.textContent = `Dados de ${H22.ano || 2022} · TSE`
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
export function secoesAno(ano, cd, aoCarregar) {
  const p = arquivoAno(`dados${ano}/secoes/${cd}.json`, aoCarregar)
  if (p.valor) p.valor.cd = cd
  return p.valor || null
}
export const erroSecoes = (ano, cd) => !!ARQ_ANO.get(`dados${ano}/secoes/${cd}.json`)?.erro

const BAIRRO_LOCAL_FLORIPA = new Map(FLORIPA.locais.map((l) => [`${l.z}-${l.cod}`, l.bairro]))
// bairro do local de votação, gravado no arquivo de cada ano (cadastro de locais do TSE; em Florianópolis,
// a lista do TRE-SC); a lista de floripa.js só entra se o arquivo não trouxer o bairro
export function bairroDoLocal(arq, loc) {
  return arq.locais[loc]?.[2] || (arq.cd === FLORIPA_CD && BAIRRO_LOCAL_FLORIPA.get(loc)) || 'Bairro não informado'
}
const tituloLocal = (s) => titulo22(s)
export function titulo22(s) {
  const MIN = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em'])
  return String(s)
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i && MIN.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\b(Sc|Br|Ii|Iii|Iv|Ifsc|Udesc|Ufsc|Senai|Sesi|Sesc)\b/g, (m) => m.toUpperCase())
}

// Soma os votos das seções do município filtrando por zona/local/bairro/seção, e agrupa.
export function agregarSecoes(arq, el, filtro, grupo, foco) {
  const votos = arq.votos[el.id] || {}
  const anul = el.anulMun?.get(arq.cd) || el.anul
  const prop = ehProp(el.cargo)
  const total = new Map()
  const grupos = new Map()
  // aptos e comparecimento de cada seção (TSE: detalhe da votação por seção / boletins de urna)
  const apT = arq.ap?.[`t${turnoDe(el.id)}`]
  let validos = 0, brancos = 0, nulos = 0, secoes = 0, aptos = 0, comp = 0
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
    const g = grupos.get(chave) || { chave, validos: 0, foco: 0, top: new Map(), aptos: 0, comp: 0, br: 0, nu: 0 }
    const a = apT?.[zs]
    if (a) {
      aptos += a[0]
      comp += a[1]
      g.aptos += a[0]
      g.comp += a[1]
    }
    for (let i = 0; i < arr.length; i += 2) {
      const nr = arr[i], v = arr[i + 1]
      if (nr === 95) { brancos += v; g.br += v; continue }
      if (nr === 96 || nr === 97 || anul.has(nr)) { nulos += v; g.nu += v; continue }
      validos += v
      g.validos += v
      total.set(nr, (total.get(nr) || 0) + v)
      if (nr === foco) g.foco += v
      if (!prop || nr > 99) g.top.set(nr, (g.top.get(nr) || 0) + v)
    }
    grupos.set(chave, g)
  }
  return { total, grupos: [...grupos.values()], validos, brancos, nulos, secoes, aptos, comp, temAp: !!apT }
}

function nomeVotavel(el, nr) {
  if (nr < 100 && ehProp(el.cargo)) {
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
export function posicaoNoGrupo(g, nr) {
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
  const prop = ehProp(el.cargo)
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
      <div class="cand-meta">${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, ag.validos))}% dos válidos${n.c ? ` · ${ehMunicipal(el.cargo) ? 'na cidade' : 'em SC'}: ${fmt.format(n.c.votos)}` : ''}${n.c?.sq && el.ano !== 2026 ? ` · <button type="button" class="link-zonas leve" ${attrHist(el.ano, el.id, n.c)}>📋 Ficha completa ›</button>` : ''}</div>${n.c?.sq && ehMunicipal(el.cargo) ? linhaPerfil(el.ano, n.c.sq) : ''}</li>`
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
      ${quadroComparecimento(ag, prop)}
    </section>
    ${X.vis === 'abst' ? listaAbstLocal(X, el, L, arq, grupo, grupos, ag) : ''}
    <section class="cartao"><h3>Mais votados aqui · ${esc(ROTULO_ELEICAO[el.id] || el.nome)}</h3>
      <p class="nota">Toque num candidato para ver quantos votos teve em cada ${grupo === 'secao' ? 'seção' : grupo}.${el.ano !== 2026 ? ` <button type="button" class="link-zonas leve" data-bc-ir="${el.id}">🔎 Buscar qualquer candidato (eleitos e não eleitos)</button>` : ''}</p>
      <ul class="h22-lista">${linhasRank}</ul>
      ${ranking.length > 25 && !X.verTodos ? `<button type="button" class="botao secundario" data-h22-todos>Mostrar todos (${ranking.length})</button>` : ''}
    </section>
    ${X.vis === 'abst' ? '' : `<section class="cartao"><h3>Por ${grupo === 'secao' ? 'seção' : grupo === 'local' ? 'local de votação' : grupo}${focoInfo ? ` · ${esc(focoInfo.nome)}` : ''}</h3>
      ${seletorVisao(X)}
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
      <div class="exportar">${botaoCard(`local-${el.ano}`, cardLocal(X, el, L, arq, grupo, linhasGrupo, ranking, ag, focoInfo, rotuloSimples))}<button type="button" class="botao secundario" data-csv-local>${icone('baixar')} Baixar planilha (CSV)</button><button type="button" class="botao secundario" data-xlsx-local>${icone('baixar')} Excel</button>${botaoLink()}</div>
      <p class="nota">Toque numa linha para entrar nela. Fonte: TSE, ${el.ano === 2026 ? 'boletins de urna de cada seção (2026)' : `votação por seção eleitoral (${el.ano})`}. Bairros pelo cadastro de locais de votação ${floripa ? 'do TRE-SC' : `do TSE (${el.ano})`}.</p>
    </section>`}`
}

/* ---------------- eleições municipais: prefeitos, câmaras, perfil ---------------- */

// dados<ano>/municipal.json (scripts/gerar_municipais.py): por município, prefeito eleito e adversários,
// câmara (vagas, eleitos, suplentes, quociente) e o prefeito da eleição anterior
const seletorMunicipal = () =>
  `<div class="segmentado h22-mv" role="group" aria-label="Ver">${[['votos', 'Votos'], ['prefeitos', '🏛️ Prefeitos'], ['camaras', '🪑 Câmaras'], ['perfil', '👤 Perfil']]
    .filter(([k]) => k === 'votos' || k === 'prefeitos' || MV_PRONTAS.has(k))
    .map(([k, rot]) => `<button type="button" data-h22-mv="${k}" aria-pressed="${(H22.mv || 'votos') === k}">${rot}</button>`)
    .join('')}</div>`
const MV_PRONTAS = new Set(['camaras', 'perfil'])

function dadosPrefeitos(ano) {
  const M = arquivoAno(`dados${ano}/municipal.json`)
  if (!M.valor) return M
  if (!M.valor._pf) {
    M.valor._pf = Object.entries(M.valor)
      .filter(([cd, o]) => cd !== '_pf' && o.pf)
      .map(([cd, o]) => {
        const seg = o.pf.t2 ? (o.t2 || []).find((x) => x[0] !== o.pf.sq) : o.adv[0]
        return { cd, nm: NOME_MUN.get(cd) || cd, ...o.pf, seg, margem: seg ? o.pf.pct - seg[4] : o.pf.pct, unico: !o.adv.length && !o.t2, ant: o.ant, trocou: !!(o.ant && o.ant.p !== o.pf.p), assoc: ASSOCIACAO_MUN[cd] || '' }
      })
  }
  return M
}

function renderPrefeitos(ano) {
  const M = dadosPrefeitos(ano)
  if (!M.valor) return M.erro ? `<section class="cartao vazio">O resultado por município de ${ano} ainda não está no app.</section>` : esqueleto(`Carregando os prefeitos de ${ano}…`)
  const todos = M.valor._pf
  const porPartido = new Map()
  for (const x of todos) porPartido.set(x.p, (porPartido.get(x.p) || 0) + 1)
  const partidos = [...porPartido.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const filtroP = H22.pfPartido || ''
  const filtroA = H22.pfAssoc || ''
  let ls = todos.filter((x) => (!filtroP || x.p === filtroP) && (!filtroA || x.assoc === filtroA))
  const ord = H22.pfOrd || 'pct'
  const fns = { pct: (a, b) => b.pct - a.pct, apertada: (a, b) => (a.unico - b.unico) || a.margem - b.margem, votos: (a, b) => b.v - a.v, mudou: (a, b) => b.trocou - a.trocou || b.pct - a.pct }
  ls = [...ls].sort(fns[ord] || fns.pct)
  if (ord === 'mudou') ls = ls.filter((x) => x.trocou)
  const reeleitos = todos.filter((x) => x.ree).length
  const trocaram = todos.filter((x) => x.trocou).length
  const anterior = todos.some((x) => x.ant)
  const max = H22.pfTodos ? ls.length : 40
  // mapa: um círculo por município, na cor do partido do prefeito
  const C = coordsLocais(() => renderizar())
  let mapa = '<p class="nota">Carregando o mapa…</p>'
  if (C.valor) {
    const id = `pf-${ano}-${filtroP}-${filtroA}`
    const pts = ls
      .map((x) => {
        const c = C.valor._mun[x.cd]
        if (!c) return null
        const ap = M.valor[x.cd]?.ap?.[0] || 1
        return { lat: c[0], lon: c[1], tam: ap, cor: corPartido(x.p), html: `<strong>${esc(x.nm)}</strong><br>${esc(x.n)} (${esc(x.p)})<br>${fmtPct.format(x.pct)}% · ${fmt.format(x.v)} votos${x.ree ? '<br>Reeleito' : ''}${x.trocou ? `<br>Antes: ${esc(x.ant.p)}` : ''}` }
      })
      .filter(Boolean)
    MAPAS.set(id, pts)
    mapa = `<div class="pro-mapa" data-mapa="${esc(id)}" role="region" aria-label="Mapa dos prefeitos"></div><p class="nota">Cada círculo é um município, na cor do partido do prefeito eleito (tamanho = eleitores aptos).</p>`
  } else if (C.erro) mapa = ''
  const chips = partidos
    .map(([p, n]) => `<button type="button" class="filtro ${filtroP === p ? 'ativo' : ''}" data-pf-partido="${esc(p)}" style="${estiloCor(corPartido(p))}"><i></i>${esc(p)} <strong>${n}</strong></button>`)
    .join('')
  const assocs = Object.keys(ASSOCIACOES).sort()
  const titOrd = { pct: 'maior %', apertada: 'disputas mais apertadas', votos: 'mais votos', mudou: `trocaram de partido desde ${ano - 4}` }[ord]
  const onde = [filtroP, filtroA].filter(Boolean).join(' · ')
  H22.csvPf = {
    nome: `prefeitos-sc-${ano}${filtroP ? '-' + nomeArquivo(filtroP) : ''}${filtroA ? '-' + nomeArquivo(filtroA) : ''}.csv`,
    cab: ['Município', 'Associação', 'Prefeito eleito', 'Partido', 'Votos', '% válidos', '2º colocado', 'Partido do 2º', '% do 2º', 'Diferença (p.p.)', 'Reeleito', ...(anterior ? [`Prefeito ${ano - 4}`, `Partido ${ano - 4}`] : []), 'Coligação'],
    linhas: ls.map((x) => [x.nm, x.assoc, x.n, x.p, x.v, x.pct, x.seg?.[1] || '', x.seg?.[2] || '', x.seg?.[4] ?? '', x.unico ? '' : Math.round(x.margem * 100) / 100, x.ree ? 'sim' : '', ...(anterior ? [x.ant?.n || '', x.ant?.p || ''] : []), x.col || '']),
  }
  const top = partidos.slice(0, 8)
  const card = {
    chapeu: `ELEIÇÕES ${ano} · SANTA CATARINA`, nome: `Prefeitos eleitos em ${ano}`, cor: corPartido(top[0]?.[0]), sub: `${todos.length} municípios · ${reeleitos} reeleitos${anterior ? ` · ${trocaram} trocaram de partido` : ''}`,
    titulo: 'Prefeituras por partido', subtitulo: 'Santa Catarina', fonte: `Fonte: TSE · resultado ${ano}`,
    total: { rot: 'Municípios de SC', valor: `${todos.length} prefeituras`, sub: `${reeleitos} reeleitos` },
    linhas: top.map(([p, n]) => ({ ponto: corPartido(p), nome: p, extra: `${fmtPct.format(pctDe(n, todos.length))}% das prefeituras`, valor: `${n}`, frac: n / top[0][1], corBarra: corPartido(p) })),
  }
  return `<section class="cartao pf"><h3>🏛️ Prefeitos eleitos em ${ano} · SC</h3>
      <div class="calc-num">
        <div><span>Prefeituras</span><strong>${todos.length}</strong></div>
        <div><span>Reeleitos</span><strong>${reeleitos}</strong><small>${fmtPct.format(pctDe(reeleitos, todos.length))}%</small></div>
        ${anterior ? `<div><span>Partido diferente de ${ano - 4}</span><strong>${trocaram}</strong><small>prefeituras (inclui prefeito que trocou de partido)</small></div>` : ''}
      </div>
      <div class="filtros pf-chips"><button type="button" class="filtro ${filtroP ? '' : 'ativo'}" data-pf-partido="">Todos</button>${chips}</div>
      ${mapa}
    </section>
    <section class="cartao pf"><h3>Prefeito de cada município${onde ? ` · ${esc(onde)}` : ''}</h3>
      <div class="segmentado" role="group" aria-label="Ordenar">${[['pct', 'Maior %'], ['apertada', 'Mais apertadas'], ['votos', 'Mais votos'], ...(anterior ? [['mudou', 'Trocou de partido']] : [])].map(([k, r]) => `<button type="button" data-pf-ord="${k}" aria-pressed="${ord === k}">${r}</button>`).join('')}</div>
      <select id="pf-assoc" class="pf-assoc" aria-label="Associação de municípios"><option value="">Todas as associações (FECAM)</option>${assocs.map((sg) => `<option value="${esc(sg)}" ${filtroA === sg ? 'selected' : ''}>${esc(sg)} · ${esc(ASSOCIACOES[sg])}</option>`).join('')}</select>
      <p class="nota"><strong>${fmt.format(ls.length)}</strong> municípios · ${esc(titOrd)}${ls.length > max ? ` · mostrando ${max}` : ''}.</p>
      <table class="tabela pf-tab"><tbody>${ls
        .slice(0, max)
        .map((x) => `<tr class="clicavel" data-h22-mun="${x.cd}" data-h22-nm="${esc(x.nm)}" data-pf-cidade style="${estiloCor(corPartido(x.p))}"><td><strong>${esc(x.nm)}</strong> ${pill(x.p)}${x.ree ? ' <span class="pp-sit">reeleito</span>' : ''}
            <div class="cand-meta">${esc(x.n)}${x.t2 ? ' · 2º turno' : ''}${x.trocou ? ` · antes: ${esc(x.ant.n)} (${esc(x.ant.p)})` : ''}</div>
            <div class="cand-meta">${x.unico ? 'Candidato único' : x.seg ? `2º: ${esc(x.seg[1])} (${esc(x.seg[2])}) ${fmtPct.format(x.seg[4])}% · diferença de ${fmtPct.format(x.margem)} p.p.` : ''}</div></td>
          <td class="dir"><strong>${fmtPct.format(x.pct)}%</strong><div class="cand-meta">${fmt.format(x.v)} votos</div></td></tr>`)
        .join('')}</tbody></table>
      ${ls.length > max ? `<button type="button" class="botao secundario" data-pf-todos>Mostrar todos (${ls.length})</button>` : ''}
      <div class="exportar">${botaoCard(`pf-${ano}`, card)}<button type="button" class="botao secundario" data-pf-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-pf-xlsx>${icone('baixar')} Excel</button>${botaoLink()}</div>
      <p class="nota">Toque num município para ver o resultado por zona, bairro, local e seção. Fonte: TSE (resultado ${ano}; reeleição pelo nome do prefeito de ${ano - 4} e pelo cadastro de candidatos).</p>
    </section>`
}
// 👤 Perfil dos candidatos (consulta_cand e bem_candidato do TSE, em dados<ano>/perfil.json)
const curto = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase())
const fmtReais = (v) => (v >= 1e6 ? `R$ ${fmtDec(v / 1e6)} mi` : v >= 1e3 ? `R$ ${fmt.format(Math.round(v / 1e3))} mil` : `R$ ${fmt.format(Math.round(v))}`)
function linhaPerfil(ano, sq) {
  const P = arquivoAno(`dados${ano}/perfil.json`)
  const x = P.valor?.c[sq]
  if (!x) return ''
  const d = P.valor.dic
  return `<div class="cand-meta perfil-linha">👤 ${[x[0] ? `${x[0]} anos` : '', curto(d.g[x[1]]), curto(d.i[x[3]]), curto(d.o[x[4]]), x[6] ? `bens ${fmtReais(x[6])}` : 'sem bens declarados'].filter(Boolean).map(esc).join(' · ')}</div>`
}
const FAIXAS = [[16, 29, 'até 29'], [30, 39, '30 a 39'], [40, 49, '40 a 49'], [50, 59, '50 a 59'], [60, 200, '60 ou mais']]
const mediana = (v) => { const a = [...v].sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0 }
function renderPerfil(ano, j) {
  const P = arquivoAno(`dados${ano}/perfil.json`)
  if (!P.valor) return P.erro ? `<section class="cartao vazio">O perfil dos candidatos de ${ano} ainda não está no app.</section>` : esqueleto(`Carregando o perfil dos candidatos de ${ano}…`)
  const d = P.valor.dic
  const fem = d.g.indexOf('FEMININO')
  const cargo = H22.pfCargo || 13
  const grupo = H22.pfGrupo || 'eleitos'
  const cd = H22.local?.cd || null
  const partido = H22.perfPartido || ''
  const el = j.eleicoes.find((e) => e.turno === 1 && e.cargo === cargo)
  if (!el) return ''
  const final = cargo === 11 ? j.eleicoes.find((e) => e.turno === 2 && e.cargo === 11) : null
  const eleitoSq = new Set([...el.candidatos, ...(final?.candidatos || [])].filter((c) => /^ELEITO/.test(c.sit)).map((c) => c.sq))
  const base = el.candidatos.filter((c) => (!cd || c.cd === cd) && P.valor.c[c.sq])
  const cands = base.filter((c) => (grupo === 'todos' || eleitoSq.has(c.sq)) && (!partido || c.partido === partido))
  const xs = cands.map((c) => P.valor.c[c.sq])
  const n = xs.length || 1
  const conta = (i) => { const m = new Map(); for (const x of xs) m.set(x[i], (m.get(x[i]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]) }
  const barras = (lista, rot) => `<div class="pc-barras">${lista
    .map(([k, v]) => `<div class="pc-b"><span>${esc(rot(k))}</span><span class="pc-tr"><span style="width:${(100 * v) / n}%"></span></span><strong>${fmtPct.format((100 * v) / n)}%</strong><small>${fmt.format(v)}</small></div>`)
    .join('')}</div>`
  const idades = xs.map((x) => x[0]).filter(Boolean)
  const faixas = FAIXAS.map(([a, b, r]) => [r, idades.filter((i) => i >= a && i <= b).length])
  const bens = xs.map((x) => x[6])
  const mulheres = xs.filter((x) => x[1] === fem).length
  // mulheres: candidatas × eleitas (mesmo recorte)
  const recorte = base.filter((c) => !partido || c.partido === partido)
  const fCand = recorte.filter((c) => P.valor.c[c.sq][1] === fem).length
  const fEl = recorte.filter((c) => eleitoSq.has(c.sq) && P.valor.c[c.sq][1] === fem).length
  const nEl = recorte.filter((c) => eleitoSq.has(c.sq)).length
  // por partido
  const porP = new Map()
  for (const c of base) {
    const g = porP.get(c.partido) || { cand: 0, el: 0, fEl: 0, fCand: 0, idades: [], bens: [] }
    const x = P.valor.c[c.sq]
    g.cand++
    if (x[1] === fem) g.fCand++
    if (eleitoSq.has(c.sq)) {
      g.el++
      if (x[1] === fem) g.fEl++
      if (x[0]) g.idades.push(x[0])
      g.bens.push(x[6])
    }
    porP.set(c.partido, g)
  }
  const tab = [...porP.entries()].sort((a, b) => b[1].el - a[1].el || b[1].cand - a[1].cand)
  const nomeCargo = cargo === 11 ? 'Prefeito' : 'Vereador'
  const onde = cd ? NOME_MUN.get(cd) : 'SC'
  const rotGrupo = grupo === 'todos' ? 'candidatos' : 'eleitos'
  H22.csvPerf = {
    nome: `perfil-${nomeArquivo(nomeCargo)}-${nomeArquivo(onde)}-${ano}.csv`,
    cab: ['Partido', 'Candidatos', 'Eleitos', 'Candidatas mulheres', 'Eleitas mulheres', '% mulheres entre os eleitos', 'Idade média dos eleitos', 'Mediana de bens dos eleitos (R$)'],
    linhas: tab.map(([p, g]) => [p, g.cand, g.el, g.fCand, g.fEl, g.el ? pctDe(g.fEl, g.el) : '', g.idades.length ? Math.round(g.idades.reduce((a, b) => a + b, 0) / g.idades.length) : '', g.el ? Math.round(mediana(g.bens)) : '']),
  }
  const card = {
    chapeu: `ELEIÇÕES ${ano} · ${String(onde).toUpperCase()}`, nome: `Perfil dos ${rotGrupo}`, cor: '#7a3fb0', sub: `${nomeCargo}${partido ? ` · ${partido}` : ''} · ${fmt.format(xs.length)} ${rotGrupo}`,
    titulo: 'Quem são', subtitulo: `${fmtPct.format(pctDe(mulheres, n))}% mulheres · idade média ${idades.length ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length) : '—'} anos`, fonte: `Fonte: TSE · candidaturas ${ano} (dados declarados)`,
    tiles: [
      { rot: 'Mulheres', valor: `${fmtPct.format(pctDe(mulheres, n))}%`, sub: `${fmt.format(mulheres)} de ${fmt.format(xs.length)}`, cor: '#c2185b' },
      { rot: 'Idade média', valor: idades.length ? `${Math.round(idades.reduce((a, b) => a + b, 0) / idades.length)} anos` : '—', sub: `de ${Math.min(...idades)} a ${Math.max(...idades)} anos` },
      { rot: 'Superior completo', valor: `${fmtPct.format(pctDe(xs.filter((x) => d.i[x[3]] === 'SUPERIOR COMPLETO').length, n))}%` },
      { rot: 'Bens (mediana)', valor: fmtReais(mediana(bens)), sub: `${fmtPct.format(pctDe(bens.filter((b) => !b).length, n))}% sem bens declarados` },
    ],
    linhas: conta(4).slice(0, 4).map(([k, v]) => ({ nome: curto(d.o[k]), extra: 'ocupação', valor: `${fmtPct.format((100 * v) / n)}%`, frac: v / n })),
  }
  const partidosOpc = [...porP.keys()].sort()
  return `<section class="cartao perfil"><h3>👤 Perfil dos ${rotGrupo} · ${nomeCargo} · ${esc(onde)} · ${ano}</h3>
      <div class="segmentado" role="group" aria-label="Cargo"><button type="button" data-perf-cargo="13" aria-pressed="${cargo === 13}">Vereadores</button><button type="button" data-perf-cargo="11" aria-pressed="${cargo === 11}">Prefeitos</button></div>
      <div class="segmentado" role="group" aria-label="Quem"><button type="button" data-perf-grupo="eleitos" aria-pressed="${grupo === 'eleitos'}">Eleitos</button><button type="button" data-perf-grupo="todos" aria-pressed="${grupo === 'todos'}">Todos os candidatos</button></div>
      <select id="perf-partido" class="pf-assoc" aria-label="Partido"><option value="">Todos os partidos</option>${partidosOpc.map((p) => `<option value="${esc(p)}" ${p === partido ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <div class="calc-num">
        <div><span>${grupo === 'todos' ? 'Candidatos' : 'Eleitos'}</span><strong>${fmt.format(xs.length)}</strong></div>
        <div><span>Mulheres</span><strong>${fmtPct.format(pctDe(mulheres, n))}%</strong><small>${fmt.format(mulheres)}</small></div>
        <div><span>Idade média</span><strong>${idades.length ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length) : '—'}</strong><small>anos</small></div>
        <div><span>Bens (mediana)</span><strong>${fmtReais(mediana(bens))}</strong><small>${fmtPct.format(pctDe(bens.filter((b) => !b).length, n))}% sem bens</small></div>
      </div>
      <p class="var-resumo">Mulheres: <strong>${fmtPct.format(pctDe(fCand, recorte.length))}%</strong> das candidaturas e <strong>${fmtPct.format(pctDe(fEl, nEl))}%</strong> dos eleitos (${fmt.format(fEl)} de ${fmt.format(nEl)}).</p>
      <h4>Idade</h4>${barras(faixas, (k) => k)}
      <h4>Cor/raça</h4>${barras(conta(2), (k) => curto(d.r[k]))}
      <h4>Escolaridade</h4>${barras(conta(3), (k) => curto(d.i[k]))}
      <h4>Ocupações mais comuns</h4>${barras(conta(4).slice(0, 10), (k) => curto(d.o[k]))}
      <div class="exportar">${botaoCard(`perf-${ano}`, card)}${botaoLink()}</div>
    </section>
    <section class="cartao perfil"><h3>Por partido · ${nomeCargo} · ${esc(onde)}</h3>
      <table class="tabela"><thead><tr><th>Partido</th><th class="dir">Eleitos</th><th class="dir">Mulheres eleitas</th><th class="dir">Idade média</th></tr></thead><tbody>${tab
        .filter(([, g]) => g.el || grupo === 'todos')
        .map(([p, g]) => `<tr style="${estiloCor(corPartido(p))}"><td>${pill(p)}<div class="cand-meta">${fmt.format(g.cand)} candidatos · bens (mediana) ${fmtReais(mediana(g.bens))}</div></td><td class="dir">${g.el}</td><td class="dir">${g.el ? `${fmtPct.format(pctDe(g.fEl, g.el))}%` : '—'}<div class="cand-meta">${g.fEl} de ${g.el}</div></td><td class="dir">${g.idades.length ? Math.round(g.idades.reduce((a, b) => a + b, 0) / g.idades.length) : '—'}</td></tr>`)
        .join('')}</tbody></table>
      <div class="exportar"><button type="button" class="botao secundario" data-perf-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-perf-xlsx>${icone('baixar')} Excel</button></div>
      <p class="nota">Dados declarados pelos candidatos ao TSE no registro da candidatura (idade no dia da eleição, gênero, cor/raça, escolaridade, ocupação e bens). Escolha um município acima para ver o perfil só dele.</p>
    </section>`
}
function tratarPerfil(h) {
  const c = h('[data-perf-cargo]')
  if (c) return ((H22.pfCargo = Number(c.dataset.perfCargo)), (H22.perfPartido = ''), renderizar(), true)
  const g = h('[data-perf-grupo]')
  if (g) return ((H22.pfGrupo = g.dataset.perfGrupo), renderizar(), true)
  if (h('[data-perf-csv]') && H22.csvPerf) return (baixarCSV(H22.csvPerf), true)
  if (h('[data-perf-xlsx]') && H22.csvPerf) return (baixarExcel(H22.csvPerf.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Perfil por partido', ...H22.csvPerf }], h('[data-perf-xlsx]')), true)
  return false
}

// Ficha da cidade num ano municipal: prefeito eleito e adversários, câmara, comparecimento e a eleição anterior
function fichaCidadeMunicipal(ano, cd) {
  const M = dadosPrefeitos(ano)
  if (!M.valor) return M.erro ? '' : `<section class="cartao">${esqueleto('Carregando o resultado da cidade…', '', 2)}</section>`
  const o = M.valor[cd]
  if (!o?.pf) return ''
  const nm = NOME_MUN.get(cd) || cd
  const pf = o.pf
  // votação final (2º turno, quando houve) e 1º turno
  const disputa = pf.t2 ? o.t2 : [[pf.sq, pf.n, pf.p, pf.v, pf.pct], ...o.adv]
  const maxV = Math.max(1, ...disputa.map((x) => x[4]))
  const elPf = pf.t2 ? 't2-c11' : 't1-c11'
  const linhaCand = (x, eleito) => `<div class="fc-cand clicavel" style="${estiloCor(corPartido(x[2]))}" ${attrHist(ano, elPf, { sq: x[0], cd })}><div class="fc-nome"><strong>${esc(x[1])}</strong> ${pill(x[2])}${eleito ? ' <span class="pp-sit">✔ eleito</span>' : ''}</div>
      <div class="fc-barra"><span style="width:${(100 * x[4]) / maxV}%"></span></div><div class="fc-num"><strong>${fmtPct.format(x[4])}%</strong> <small>${fmt.format(x[3])} votos</small></div></div>`
  const porP = new Map()
  for (const e of o.cam?.el || []) porP.set(e[2], (porP.get(e[2]) || 0) + 1)
  const fatias = [...porP.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ valor: n, cor: corPartido(p), rotulo: `${p} (${n})` }))
  const [aptos, comp] = o.ap || [0, 0]
  const ant = o.ant
  const mudou = ant ? (ant.p !== pf.p ? `<strong>${esc(pf.p)}</strong> no lugar de <strong>${esc(ant.p)}</strong>` : `o mesmo partido (${esc(pf.p)})`) : ''
  const card = {
    chapeu: `ELEIÇÕES ${ano} · ${nm.toUpperCase()}`, nome: `Resultado em ${nm}`, cor: corPartido(pf.p), sub: `Prefeito eleito: ${pf.n} (${pf.p})${pf.ree ? ' · reeleito' : ''}`,
    titulo: pf.t2 ? 'Prefeito · 2º turno' : 'Prefeito', subtitulo: o.cam ? `Câmara: ${fatias.map((f) => f.rotulo).join(' · ')}` : '', fonte: `Fonte: TSE · resultado ${ano}`,
    total: aptos ? { rot: `Comparecimento · ${nm}`, valor: `${fmtPct.format(pctDe(comp, aptos))}%`, sub: `${fmt.format(comp)} de ${fmt.format(aptos)} eleitores` } : null,
    linhas: disputa.slice(0, 8).map((x) => ({ nome: x[1], extra: x[0] === pf.sq ? `${x[2]} · eleito` : x[2], valor: `${fmtPct.format(x[4])}%`, dir2: `${fmt.format(x[3])} votos`, frac: x[4] / maxV, corBarra: corPartido(x[2]) })),
  }
  return `<section class="cartao fc" style="${estiloCor(corPartido(pf.p))}"><h3>🏛️ ${esc(nm)} · ${ano}</h3>
    <div class="fc-bloco"><h4>Prefeito${pf.t2 ? ' · 2º turno' : ''}</h4>${disputa.map((x) => linhaCand(x, x[0] === pf.sq)).join('')}
      ${pf.t2 && o.adv.length ? `<p class="nota">1º turno: ${[[pf.sq, pf.n, pf.p, 0, 0], ...o.adv].filter((x) => x[4]).map((x) => `${esc(x[1])} ${fmtPct.format(x[4])}%`).join(' · ')}</p>` : ''}
      ${!o.adv.length && !pf.t2 ? '<p class="nota">Candidato único.</p>' : ''}
      ${pf.col ? `<p class="nota">Coligação: ${esc(pf.col)}</p>` : ''}</div>
    ${o.cam ? `<div class="fc-bloco"><h4>Câmara · ${o.cam.vagas} vereadores</h4>${barraEmpilhada(fatias)}<button type="button" class="link-zonas" data-h22-mv="camaras">🪑 Ver os vereadores eleitos ›</button></div>` : ''}
    <div class="calc-num">
      ${aptos ? `<div><span>Eleitores aptos</span><strong>${fmt.format(aptos)}</strong></div><div><span>Comparecimento</span><strong>${fmtPct.format(pctDe(comp, aptos))}%</strong><small>${fmt.format(comp)} votaram</small></div><div class="abst"><span>Abstenção</span><strong>${fmtPct.format(pctDe(aptos - comp, aptos))}%</strong><small>${fmt.format(aptos - comp)} não votaram</small></div>` : ''}
      ${o.cam ? `<div><span>Quociente eleitoral</span><strong>${fmt.format(o.cam.qe)}</strong><small>votos por vaga</small></div>` : ''}
    </div>
    ${ant ? `<p class="fc-ant">🔁 Em ${ano - 4}: <strong>${esc(ant.n)}</strong> ${pill(ant.p)}. Em ${ano}: ${pf.ree ? `<strong>${esc(pf.n)}</strong> foi reeleito` : `<strong>${esc(pf.n)}</strong> foi eleito`} — ${mudou}.</p>` : ''}
    <div class="exportar">${botaoCard(`fc-${ano}-${cd}`, card)}${botaoLink()}</div>
    <p class="nota">Abaixo, os votos de ${ano} em ${esc(nm)} por zona, bairro, local e seção. Fonte: TSE.</p>
  </section>`
}

// 🪑 Câmaras de vereadores: SC (cadeiras por partido, mais votados) ou a câmara da cidade escolhida
function renderCamaras(ano) {
  const M = dadosPrefeitos(ano)
  if (!M.valor) return M.erro ? `<section class="cartao vazio">O resultado por município de ${ano} ainda não está no app.</section>` : esqueleto(`Carregando as câmaras de ${ano}…`)
  const fatiasDe = (porP) => [...porP.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ valor: n, cor: corPartido(p), rotulo: `${p} (${n})` }))
  if (H22.local) {
    const cd = H22.local.cd
    const o = M.valor[cd]
    if (!o?.cam) return '<section class="cartao vazio">Sem dados da câmara deste município.</section>'
    const cam = o.cam
    const porP = new Map()
    for (const e of cam.el) porP.set(e[2], (porP.get(e[2]) || 0) + 1)
    const nm = NOME_MUN.get(cd) || cd
    H22.csvCam = { nome: `camara-${nomeArquivo(nm)}-${ano}.csv`, cab: ['Vereador', 'Partido', 'Votos', 'Situação'], linhas: [...cam.el.map((e) => [e[1], e[2], e[3], `Eleito ${e[4] === 'QP' ? 'por QP' : 'por média'}`]), ...cam.sup.map((x) => [x[1], x[2], x[3], 'Suplente'])] }
    const card = {
      chapeu: `ELEIÇÕES ${ano} · ${nm.toUpperCase()}`, nome: `Câmara de ${nm}`, cor: corPartido([...porP.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]), sub: `${cam.vagas} vereadores · quociente eleitoral ${fmt.format(cam.qe)}`,
      titulo: 'Vereadores eleitos', subtitulo: [...porP.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(' · '), fonte: `Fonte: TSE · resultado ${ano}`,
      linhas: cam.el.slice(0, 14).map((e) => ({ nome: e[1], extra: `${e[2]} · ${e[4] === 'QP' ? 'QP' : 'média'}`, valor: fmt.format(e[3]), frac: e[3] / (cam.el[0]?.[3] || 1), corBarra: corPartido(e[2]) })),
    }
    return `<section class="cartao cam"><h3>🪑 Câmara de ${esc(nm)} · ${ano}</h3>
      <div class="calc-num">
        <div><span>Vereadores</span><strong>${cam.vagas}</strong></div>
        <div><span>Quociente eleitoral</span><strong>${fmt.format(cam.qe)}</strong><small>${fmt.format(cam.val)} válidos ÷ ${cam.vagas}</small></div>
        <div><span>Partidos</span><strong>${porP.size}</strong></div>
      </div>
      ${barraEmpilhada(fatiasDe(porP))}
      <table class="tabela cam-tab"><thead><tr><th>Eleito</th><th class="dir">Votos</th></tr></thead><tbody>${cam.el
        .map((e, i) => `<tr class="clicavel" style="${estiloCor(corPartido(e[2]))}" ${attrHist(ano, 't1-c13', { sq: e[0], cd })}><td><span class="pos">${i + 1}º</span> <strong>${esc(e[1])}</strong> ${pill(e[2])}<div class="cand-meta">${e[4] === 'QP' ? 'Eleito por QP' : 'Eleito por média'} · ${fmtPct.format(pctDe(e[3], cam.val))}% dos válidos</div></td><td class="dir"><strong>${fmt.format(e[3])}</strong></td></tr>`)
        .join('')}</tbody></table>
      ${cam.sup.length ? `<details class="cam-sup"><summary>Primeiros suplentes de cada partido (${cam.sup.length})</summary><table class="tabela"><tbody>${cam.sup.map((x) => `<tr class="clicavel" ${attrHist(ano, 't1-c13', { sq: x[0], cd })}><td>${esc(x[1])} ${pill(x[2])}</td><td class="dir">${fmt.format(x[3])}</td></tr>`).join('')}</tbody></table></details>` : ''}
      <button type="button" class="botao" data-bc-ir="t1-c13" data-bc-ir-sit="nao">🔎 Todos os candidatos a vereador (inclui os não eleitos)</button>
      <div class="exportar">${botaoCard(`cam-${ano}-${cd}`, card)}<button type="button" class="botao secundario" data-cam-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-cam-xlsx>${icone('baixar')} Excel</button>${botaoLink()}</div>
      <p class="nota">Quociente eleitoral = votos válidos de vereador (nominais + legenda) ÷ vagas. "QP" = eleito pelo quociente partidário; "média" = nas sobras. Fonte: TSE.</p>
    </section>`
  }
  // SC inteira
  const cidades = Object.entries(M.valor).filter(([cd, o]) => cd !== '_pf' && o.cam)
  const porP = new Map()
  const vereadores = []
  for (const [cd, o] of cidades)
    for (const e of o.cam.el) {
      porP.set(e[2], (porP.get(e[2]) || 0) + 1)
      vereadores.push({ cd, sq: e[0], n: e[1], p: e[2], v: e[3], s: e[4], pct: pctDe(e[3], o.cam.val) })
    }
  const total = vereadores.length
  const filtroP = H22.camPartido || ''
  const ordV = H22.camOrd || 'v'
  const vs = vereadores.filter((x) => !filtroP || x.p === filtroP).sort(ordV === 'p' ? (a, b) => b.pct - a.pct : (a, b) => b.v - a.v)
  const max = H22.camTodos ? vs.length : 20
  const partidos = [...porP.entries()].sort((a, b) => b[1] - a[1])
  H22.csvCam = { nome: `vereadores-eleitos-sc-${ano}${filtroP ? '-' + nomeArquivo(filtroP) : ''}.csv`, cab: ['Vereador', 'Partido', 'Município', 'Votos', '% dos válidos da cidade', 'Situação'], linhas: vs.map((x) => [x.n, x.p, NOME_MUN.get(x.cd) || x.cd, x.v, x.pct, `Eleito ${x.s === 'QP' ? 'por QP' : 'por média'}`]) }
  const top = partidos.slice(0, 8)
  const card = {
    chapeu: `ELEIÇÕES ${ano} · SANTA CATARINA`, nome: `Vereadores eleitos em ${ano}`, cor: corPartido(top[0]?.[0]), sub: `${fmt.format(total)} cadeiras nas ${cidades.length} câmaras de SC`,
    titulo: 'Cadeiras por partido', subtitulo: 'Soma de todas as câmaras municipais', fonte: `Fonte: TSE · resultado ${ano}`,
    total: { rot: 'Câmaras de SC', valor: `${fmt.format(total)} vereadores`, sub: `${cidades.length} municípios` },
    linhas: top.map(([p, n]) => ({ ponto: corPartido(p), nome: p, extra: `${fmtPct.format(pctDe(n, total))}% das cadeiras`, valor: fmt.format(n), frac: n / top[0][1], corBarra: corPartido(p) })),
  }
  return `<section class="cartao cam"><h3>🪑 Câmaras de vereadores · ${ano} · SC</h3>
      <div class="calc-num">
        <div><span>Vereadores eleitos</span><strong>${fmt.format(total)}</strong></div>
        <div><span>Câmaras</span><strong>${cidades.length}</strong></div>
        <div><span>Partidos com cadeira</span><strong>${porP.size}</strong></div>
      </div>
      ${barraEmpilhada(fatiasDe(porP).slice(0, 12))}
      <div class="filtros pf-chips"><button type="button" class="filtro ${filtroP ? '' : 'ativo'}" data-cam-partido="">Todos</button>${partidos.map(([p, n]) => `<button type="button" class="filtro ${filtroP === p ? 'ativo' : ''}" data-cam-partido="${esc(p)}" style="${estiloCor(corPartido(p))}"><i></i>${esc(p)} <strong>${fmt.format(n)}</strong></button>`).join('')}</div>
      <div class="exportar">${botaoCard(`cam-${ano}`, card)}</div>
    </section>
    <section class="cartao cam"><h3>Vereadores eleitos${filtroP ? ` · ${esc(filtroP)}` : ''} · os mais votados</h3>
      <div class="segmentado" role="group" aria-label="Ordenar"><button type="button" data-cam-ord="v" aria-pressed="${ordV === 'v'}">Mais votos</button><button type="button" data-cam-ord="p" aria-pressed="${ordV === 'p'}">Maior % da cidade</button></div>
      <table class="tabela cam-tab"><tbody>${vs
        .slice(0, max)
        .map((x, i) => `<tr class="clicavel" data-h22-mun="${x.cd}" data-h22-nm="${esc(NOME_MUN.get(x.cd) || x.cd)}" style="${estiloCor(corPartido(x.p))}"><td><span class="pos">${i + 1}º</span> <strong>${esc(x.n)}</strong> ${pill(x.p)} <button type="button" class="link-zonas leve" ${attrHist(ano, 't1-c13', { sq: x.sq, cd: x.cd })}>📋 Ficha ›</button><div class="cand-meta">${esc(NOME_MUN.get(x.cd) || x.cd)} · ${x.s === 'QP' ? 'QP' : 'média'} · ${fmtPct.format(x.pct)}% dos válidos da cidade</div></td><td class="dir"><strong>${fmt.format(x.v)}</strong></td></tr>`)
        .join('')}</tbody></table>
      ${vs.length > max ? `<button type="button" class="botao secundario" data-cam-todos>Mostrar todos (${fmt.format(vs.length)})</button>` : ''}
      <div class="exportar"><button type="button" class="botao secundario" data-cam-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-cam-xlsx>${icone('baixar')} Excel</button>${botaoLink()}</div>
      <p class="nota">Escolha um município acima (ou toque num vereador) para ver a câmara dele: composição, eleitos, quociente eleitoral e suplentes. Fonte: TSE.</p>
    </section>`
}
function tratarCamaras(h) {
  const p = h('[data-cam-partido]')
  if (p) return ((H22.camPartido = p.dataset.camPartido || ''), (H22.camTodos = false), renderizar(), true)
  const o = h('[data-cam-ord]')
  if (o) return ((H22.camOrd = o.dataset.camOrd), renderizar(), true)
  if (h('[data-cam-todos]')) return ((H22.camTodos = true), renderizar(), true)
  if (h('[data-cam-csv]') && H22.csvCam) return (baixarCSV(H22.csvCam), true)
  if (h('[data-cam-xlsx]') && H22.csvCam) return (baixarExcel(H22.csvCam.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Vereadores', ...H22.csvCam }], h('[data-cam-xlsx]')), true)
  return false
}
function tratarPrefeitos(h) {
  const p = h('[data-pf-partido]')
  if (p) return ((H22.pfPartido = p.dataset.pfPartido || ''), (H22.pfTodos = false), renderizar(), true)
  const o = h('[data-pf-ord]')
  if (o) return ((H22.pfOrd = o.dataset.pfOrd), (H22.pfTodos = false), renderizar(), true)
  if (h('[data-pf-todos]')) return ((H22.pfTodos = true), renderizar(), true)
  if (h('[data-pf-csv]') && H22.csvPf) return (baixarCSV(H22.csvPf), true)
  if (h('[data-pf-xlsx]') && H22.csvPf) return (baixarExcel(H22.csvPf.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Prefeitos', ...H22.csvPf }], h('[data-pf-xlsx]')), true)
  // tocar no município: abre a cidade (votos por zona, bairro, local e seção)
  if (h('[data-pf-cidade]')) H22.mv = 'votos'
  return false
}

/* ---------------- abstenção, brancos e nulos (explorador) ---------------- */

// % de brancos e nulos sobre os votos do cargo (válidos + brancos + nulos), que é o comparecimento do cargo
const votosCargo = (x) => x.validos + (x.brancos ?? x.br) + (x.nulos ?? x.nu)
function quadroComparecimento(ag, prop) {
  const vc = votosCargo(ag)
  const abst = ag.aptos - ag.comp
  return `<div class="calc-num h22-tot">
        ${ag.temAp && ag.aptos
          ? `<div><span>Eleitores aptos</span><strong>${fmt.format(ag.aptos)}</strong></div>
        <div><span>Comparecimento</span><strong>${fmt.format(ag.comp)}</strong><small>${fmtPct.format(pctDe(ag.comp, ag.aptos))}% dos aptos</small></div>
        <div class="abst"><span>Abstenção</span><strong>${fmt.format(abst)}</strong><small>${fmtPct.format(pctDe(abst, ag.aptos))}% não votaram</small></div>`
          : ''}
        <div><span>Votos válidos</span><strong>${fmt.format(ag.validos)}</strong><small>${prop ? 'nominais + legenda · ' : ''}${fmtPct.format(pctDe(ag.validos, vc))}%</small></div>
        <div><span>Brancos</span><strong>${fmt.format(ag.brancos)}</strong><small>${fmtPct.format(pctDe(ag.brancos, vc))}% dos votos</small></div>
        <div><span>Nulos</span><strong>${fmt.format(ag.nulos)}</strong><small>${fmtPct.format(pctDe(ag.nulos, vc))}% · inclui anulados</small></div>
        <div><span>Seções</span><strong>${fmt.format(ag.secoes)}</strong></div>
      </div>`
}
const seletorVisao = (X) => `<div class="segmentado h22-vis" role="group" aria-label="O que mostrar"><button type="button" data-h22-vis="votos" aria-pressed="${X.vis !== 'abst'}">Votos dos candidatos</button><button type="button" data-h22-vis="abst" aria-pressed="${X.vis === 'abst'}">📉 Abstenção, brancos e nulos</button></div>`
const ORD_ABST = [['abst', 'Maior abstenção'], ['aus', 'Mais ausentes'], ['br', 'Mais brancos'], ['nu', 'Mais nulos'], ['menor', 'Menor abstenção']]
// linhas com aptos, ausentes, abstenção, brancos e nulos (zona, bairro, local, seção ou município)
function linhasAbst(lista, ordem, temAp) {
  const ls = lista.map((g) => {
    const vc = g.validos + g.br + g.nu
    return { ...g, aus: g.aptos - g.comp, pab: pctDe(g.aptos - g.comp, g.aptos), pbr: pctDe(g.br, vc), pnu: pctDe(g.nu, vc), vc }
  })
  const o = !temAp && ['abst', 'aus', 'menor'].includes(ordem) ? 'br' : ordem
  const ord = { abst: (a, b) => b.pab - a.pab, aus: (a, b) => b.aus - a.aus, br: (a, b) => b.pbr - a.pbr, nu: (a, b) => b.pnu - a.pnu, menor: (a, b) => a.pab - b.pab }
  return ls.sort(ord[o] || ord.abst)
}
function tabelaAbst(ls, temAp, rotulo, alvo, max) {
  const maxAb = Math.max(1, ...ls.map((g) => g.pab))
  return `<table class="tabela bai-tabela abst-tab"><thead><tr><th></th><th class="dir">${temAp ? 'Abstenção' : 'Votos'}</th><th class="dir">Brancos · Nulos</th></tr></thead><tbody>${ls
    .slice(0, max)
    .map(
      (g) => `<tr class="clicavel" ${alvo(g)}><td>${rotulo(g)}
        <div class="cand-meta">${temAp ? `${fmt.format(g.aptos)} aptos · <strong>${fmt.format(g.aus)}</strong> ausentes` : `${fmt.format(g.vc)} votos no cargo`}</div>
        ${temAp ? `<div class="abst-barra"><span style="width:${(100 * g.pab) / maxAb}%"></span></div>` : ''}</td>
        <td class="dir">${temAp ? `<strong>${fmtPct.format(g.pab)}%</strong>` : fmt.format(g.vc)}</td>
        <td class="dir">${fmtPct.format(g.pbr)}% · ${fmtPct.format(g.pnu)}%<div class="cand-meta">${fmt.format(g.br)} · ${fmt.format(g.nu)}</div></td></tr>`,
    )
    .join('')}</tbody></table>`
}
const ordensAbst = (atual, temAp) => `<div class="segmentado abst-ord" role="group" aria-label="Ordenar">${ORD_ABST.filter(([k]) => temAp || !['abst', 'aus', 'menor'].includes(k))
  .map(([k, rot]) => `<button type="button" data-h22-ord="${k}" aria-pressed="${atual === k}">${rot}</button>`)
  .join('')}</div>`
const notaAbst = (temAp, ano) => `<p class="nota">${temAp ? 'Abstenção = eleitores aptos que não votaram ÷ aptos. ' : `Sem aptos/comparecimento por seção para ${ano} no app: só brancos e nulos. `}Brancos e nulos em % dos votos do cargo escolhido (nulos incluem votos anulados). Fonte: TSE, ${ano === 2026 ? 'boletins de urna' : 'detalhe da votação por seção'}.</p>`

function listaAbstLocal(X, el, L, arq, grupo, grupos, ag) {
  const ordem = X.ordAbst || (ag.temAp ? 'abst' : 'br')
  const ls = linhasAbst(ag.grupos, ordem, ag.temAp)
  const max = X.verGrupos ? ls.length : 60
  const nomeG = { zona: 'zona', local: 'local de votação', bairro: 'bairro', secao: 'seção' }[grupo]
  const rotuloSimples = (k) => (grupo === 'zona' ? `${Number(k)}ª zona` : grupo === 'bairro' ? k : grupo === 'local' ? tituloLocal((arq.locais[k] || [k])[0]) : `Seção ${k.split('-')[1]} (${Number(k.split('-')[0])}ª zona)`)
  const alvo = (g) => (grupo === 'zona' ? `data-h22-zona="${g.chave}"` : grupo === 'local' ? `data-h22-local="${esc(g.chave)}"` : grupo === 'bairro' ? `data-h22-bairro="${esc(g.chave)}"` : `data-h22-secao="${esc(g.chave)}"`)
  const onde = [L.nm, L.zona ? `${Number(L.zona)}ª zona` : '', L.bairro || '', L.localVot ? tituloLocal((arq.locais[L.localVot] || [''])[0]) : ''].filter(Boolean).join(' › ')
  const cargo = ROTULO_ELEICAO[el.id] || ROTULO_26[el.id] || el.nome
  const vc = votosCargo(ag)
  X.csv = {
    nome: `${nomeArquivo(L.nm)}-${el.ano}-abstencao-brancos-nulos-${nomeArquivo(cargo)}-${grupo}.csv`,
    cab: [{ zona: 'Zona', local: 'Local de votação', bairro: 'Bairro', secao: 'Seção' }[grupo], ...(grupo === 'local' || grupo === 'secao' ? ['Bairro', 'Zona'] : []), 'Aptos', 'Comparecimento', 'Abstenção', '% abstenção', 'Votos válidos', 'Brancos', '% brancos', 'Nulos', '% nulos'],
    linhas: ls.map((g) => {
      const loc = grupo === 'secao' ? arq.secoes[g.chave] : g.chave
      return [rotuloSimples(g.chave), ...(grupo === 'local' || grupo === 'secao' ? [bairroDoLocal(arq, loc), `${Number(String(g.chave).split('-')[0])}ª`] : []), ag.temAp ? g.aptos : '', ag.temAp ? g.comp : '', ag.temAp ? g.aus : '', ag.temAp ? g.pab : '', g.validos, g.br, g.pbr, g.nu, g.pnu]
    }),
  }
  const titulo = Object.fromEntries(ORD_ABST)[ordem] || 'Abstenção'
  const card = {
    chapeu: `ELEIÇÕES ${el.ano} · ${L.nm.toUpperCase()}`, nome: onde, cor: '#1c5cab', turno: el.ano === 2026 ? turnoDe(el.id) : null,
    sub: ag.temAp ? `Abstenção ${fmtPct.format(pctDe(ag.aptos - ag.comp, ag.aptos))}% · brancos ${fmtPct.format(pctDe(ag.brancos, vc))}% · nulos ${fmtPct.format(pctDe(ag.nulos, vc))}%` : `Brancos ${fmtPct.format(pctDe(ag.brancos, vc))}% · nulos ${fmtPct.format(pctDe(ag.nulos, vc))}%`,
    titulo: `${titulo} · ${{ zona: 'zonas', local: 'locais', bairro: 'bairros', secao: 'seções' }[grupo]}`, subtitulo: cargo,
    total: ag.temAp ? { rot: `Ausentes · ${onde}`, valor: fmt.format(ag.aptos - ag.comp), sub: `${fmtPct.format(pctDe(ag.aptos - ag.comp, ag.aptos))}% de ${fmt.format(ag.aptos)} aptos` } : { rot: `Brancos e nulos · ${onde}`, valor: fmt.format(ag.brancos + ag.nulos), sub: `${fmtPct.format(pctDe(ag.brancos + ag.nulos, vc))}% dos votos` },
    linhas: ls.slice(0, 8).map((g) => ({ nome: rotuloSimples(g.chave), extra: ag.temAp ? `${fmt.format(g.aptos)} aptos · ${fmt.format(g.aus)} ausentes` : `${fmt.format(g.vc)} votos`, valor: ordem === 'br' ? `${fmtPct.format(g.pbr)}%` : ordem === 'nu' ? `${fmtPct.format(g.pnu)}%` : ordem === 'aus' ? fmt.format(g.aus) : `${fmtPct.format(g.pab)}%`, dir2: ordem === 'br' || ordem === 'nu' ? (ag.temAp ? `abstenção ${fmtPct.format(g.pab)}%` : '') : `brancos ${fmtPct.format(g.pbr)}% · nulos ${fmtPct.format(g.pnu)}%`, frac: ordem === 'br' ? g.pbr / 100 : ordem === 'nu' ? g.pnu / 100 : g.pab / 100, corBarra: '#2a78d6' })),
  }
  return `<section class="cartao"><h3>📉 Abstenção, brancos e nulos por ${nomeG}</h3>
      ${seletorVisao(X)}
      <div class="segmentado" role="group">${grupos
        .map((k) => `<button type="button" data-h22-grupo="${k}" aria-pressed="${grupo === k}">${{ zona: 'Zonas', local: 'Locais', bairro: 'Bairros', secao: 'Seções' }[k]}</button>`)
        .join('')}</div>
      ${ordensAbst(ordem, ag.temAp)}
      <p class="nota"><strong>${fmt.format(ls.length)}</strong> ${{ zona: 'zonas', local: 'locais de votação', bairro: 'bairros', secao: 'seções' }[grupo]} · ${esc(cargo)}${ls.length > max ? ` · mostrando ${max}` : ''}.</p>
      ${tabelaAbst(ls, ag.temAp, (g) => rotuloGrupo(arq, grupo, g.chave), alvo, max)}
      ${ls.length > max ? `<button type="button" class="botao secundario" data-h22-vergrupos>Mostrar todas as ${fmt.format(ls.length)} linhas</button>` : ''}
      <div class="exportar">${botaoCard(`abst-${el.ano}`, card)}<button type="button" class="botao secundario" data-csv-local>${icone('baixar')} Baixar planilha (CSV)</button><button type="button" class="botao secundario" data-xlsx-local>${icone('baixar')} Excel</button>${botaoLink()}</div>
      ${notaAbst(ag.temAp, el.ano)}
    </section>`
}

// SC inteira: abstenção, brancos e nulos por município ou associação (dados<ano>/comparecimento.json)
function abstSC(X, el, ano) {
  const C = arquivoAno(`dados${ano}/comparecimento.json`)
  if (!C.valor) return C.erro ? '' : `<section class="cartao">${esqueleto('Carregando a abstenção por município…', '', 3)}</section>`
  const ap = C.valor[`t${turnoDe(el.id)}`] || {}
  const bn = C.valor.brnu?.[el.id] || {}
  const temAp = Object.keys(ap).length > 0
  const porAssoc = X.abstGrupo === 'assoc'
  const G = new Map()
  for (const cd of new Set([...Object.keys(ap), ...Object.keys(bn)])) {
    const k = porAssoc ? ASSOCIACAO_MUN[cd] : cd
    if (!k) continue
    const g = G.get(k) || { chave: k, aptos: 0, comp: 0, br: 0, nu: 0, validos: 0 }
    const [a, c] = ap[cd] || [0, 0]
    const [b, n] = bn[cd] || [0, 0]
    g.aptos += a
    g.comp += c
    g.br += b
    g.nu += n
    // votos válidos do cargo ≈ comparecimento − brancos − nulos (o arquivo não traz os válidos)
    g.validos += Math.max(0, c - b - n)
    G.set(k, g)
  }
  const ordem = X.ordAbst || (temAp ? 'abst' : 'br')
  const ls = linhasAbst([...G.values()], ordem, temAp)
  const tot = ls.reduce((s, g) => ({ aptos: s.aptos + g.aptos, comp: s.comp + g.comp, br: s.br + g.br, nu: s.nu + g.nu }), { aptos: 0, comp: 0, br: 0, nu: 0 })
  const max = X.abstTodos ? ls.length : 15
  const cargo = ROTULO_ELEICAO[el.id] || ROTULO_26[el.id] || el.nome
  const rotulo = (g) => (porAssoc ? `<strong>${esc(g.chave)}</strong> <span class="mudo">· ${esc(ASSOCIACOES[g.chave] || '')}</span>` : `<strong>${esc(NOME_MUN.get(g.chave) || g.chave)}</strong>`)
  const alvo = (g) => (porAssoc ? '' : `data-h22-mun="${g.chave}" data-h22-nm="${esc(NOME_MUN.get(g.chave) || g.chave)}" data-h22-vis-abst`)
  X.csvAbstSC = {
    nome: `sc-${ano}-abstencao-brancos-nulos-${nomeArquivo(cargo)}-${porAssoc ? 'associacoes' : 'municipios'}.csv`,
    cab: [porAssoc ? 'Associação' : 'Município', 'Aptos', 'Comparecimento', 'Abstenção', '% abstenção', 'Brancos', '% brancos', 'Nulos', '% nulos'],
    linhas: ls.map((g) => [porAssoc ? `${g.chave} · ${ASSOCIACOES[g.chave] || ''}` : NOME_MUN.get(g.chave) || g.chave, g.aptos, g.comp, g.aus, g.pab, g.br, g.pbr, g.nu, g.pnu]),
  }
  const vc = tot.comp || tot.br + tot.nu
  const card = {
    chapeu: `ELEIÇÕES ${ano} · SANTA CATARINA`, nome: `Abstenção · ${cargo}`, cor: '#1c5cab', turno: ano === 2026 ? turnoDe(el.id) : null,
    sub: temAp ? `SC: ${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}% de abstenção · brancos ${fmtPct.format(pctDe(tot.br, vc))}% · nulos ${fmtPct.format(pctDe(tot.nu, vc))}%` : '',
    titulo: `${Object.fromEntries(ORD_ABST)[ordem]} · ${porAssoc ? 'associações' : 'municípios'}`, subtitulo: porAssoc ? 'Associações de municípios (FECAM)' : 'Municípios de SC',
    total: { rot: 'Ausentes · Santa Catarina', valor: fmt.format(tot.aptos - tot.comp), sub: `${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}% de ${fmt.format(tot.aptos)} aptos` },
    linhas: ls.slice(0, 8).map((g) => ({ nome: porAssoc ? `${g.chave}` : NOME_MUN.get(g.chave) || g.chave, extra: `${fmt.format(g.aptos)} aptos · ${fmt.format(g.aus)} ausentes`, valor: ordem === 'br' ? `${fmtPct.format(g.pbr)}%` : ordem === 'nu' ? `${fmtPct.format(g.pnu)}%` : ordem === 'aus' ? fmt.format(g.aus) : `${fmtPct.format(g.pab)}%`, dir2: ordem === 'br' || ordem === 'nu' ? `abstenção ${fmtPct.format(g.pab)}%` : `brancos ${fmtPct.format(g.pbr)}% · nulos ${fmtPct.format(g.pnu)}%`, frac: ordem === 'br' ? g.pbr / 100 : ordem === 'nu' ? g.pnu / 100 : g.pab / 100, corBarra: '#2a78d6' })),
  }
  return `<section class="cartao abst-sc"><h3>📉 Abstenção, brancos e nulos · ${esc(cargo)} · ${ano}</h3>
    <div class="calc-num h22-tot">
      ${temAp ? `<div><span>Eleitores aptos</span><strong>${fmt.format(tot.aptos)}</strong></div>
      <div class="abst"><span>Abstenção</span><strong>${fmt.format(tot.aptos - tot.comp)}</strong><small>${fmtPct.format(pctDe(tot.aptos - tot.comp, tot.aptos))}% não votaram</small></div>` : ''}
      <div><span>Brancos</span><strong>${fmt.format(tot.br)}</strong><small>${fmtPct.format(pctDe(tot.br, vc))}% dos votos</small></div>
      <div><span>Nulos</span><strong>${fmt.format(tot.nu)}</strong><small>${fmtPct.format(pctDe(tot.nu, vc))}%</small></div>
    </div>
    <div class="segmentado" role="group"><button type="button" data-abst-grupo="mun" aria-pressed="${!porAssoc}">Municípios</button><button type="button" data-abst-grupo="assoc" aria-pressed="${porAssoc}">Associações</button></div>
    ${ordensAbst(ordem, temAp)}
    ${tabelaAbst(ls, temAp, rotulo, alvo, max)}
    ${ls.length > max ? `<button type="button" class="botao secundario" data-abst-todos>Mostrar todos (${ls.length})</button>` : ''}
    <div class="exportar">${botaoCard(`abst-sc-${ano}`, card)}<button type="button" class="botao secundario" data-csv-abst-sc>${icone('baixar')} Baixar planilha (CSV)</button><button type="button" class="botao secundario" data-xlsx-abst-sc>${icone('baixar')} Excel</button></div>
    ${notaAbst(temAp, ano)}${porAssoc ? '' : '<p class="nota">Toque num município para ver por zona, bairro, local e seção.</p>'}
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
  const ano = H22.ano || 2022
  const j = histDe(ano).resumo
  const anos = `<div class="segmentado h22-anos" role="group" aria-label="Ano da eleição">${ANOS_HIST.map((a) => `<button type="button" data-h22-ano="${a}" aria-pressed="${a === ano}">${a}</button>`).join('')}</div>`
  if (!j) {
    resumoAno(ano).then(() => estado.aba.tipo === 'h22' && renderizar()).catch(() => {})
    return `<section class="cartao resumo">${anos}</section>${esqueleto(`Carregando ${ano}…`)}`
  }
  const municipal = !!j.municipal
  const elEstado = j.eleicoes.find((e) => e.id === H22.sel) || j.eleicoes.find((e) => e.id === (municipal ? 't1-c13' : 't1-c7')) || j.eleicoes[0]
  // eleição municipal: com um município escolhido, só os candidatos dele (os números se repetem entre cidades)
  const el = municipal && H22.local ? cidadeDe(elEstado, H22.local.cd) : elEstado
  const prop = ehProp(el.cargo)
  const pills = `${anos}<div class="segmentado h22-pills" role="group">${j.eleicoes
    .map((e) => `<button type="button" data-h22="${e.id}" aria-pressed="${e.id === el.id}">${esc(ROTULO_ELEICAO[e.id] || e.nome)}</button>`)
    .join('')}</div>`
  const eleitos = el.candidatos.filter((c) => /^ELEITO/.test(c.sit))
  const destaque = municipal && !H22.local ? el.candidatos.slice(0, 20) : prop ? eleitos : el.candidatos.slice(0, Math.max(eleitos.length, 4))
  const st26 = (c) => {
    const a = atual2026(c)
    if (!a) return H22.atual ? '<span class="mudo">Não está na disputa de 2026 em SC</span>' : '<span class="mudo">consultando 2026…</span>'
    const mesmo = a.aba.cargo === el.cargo
    const p22 = pctDe(c.votos, el.validos)
    return `<span class="h22-26">🔁 2026: <strong>${esc(a.aba.rotulo.replace(/ SC$/, ''))}</strong> ${pill(a.c.partido)} · ${a.pos}º · ${fmt.format(a.c.votos)} votos (${fmtPct.format(a.c.percentual)}%)${
      mesmo ? ` <span class="h22-delta ${a.c.percentual >= p22 ? 'sobe' : 'desce'}">${seta(a.c.percentual - p22)} p.p.</span>` : ''
    } ${selo(a.c)} <button type="button" class="link-zonas leve" ${attrCand(a.c, a.aba.id, UF)}>Ficha 2026 ›</button></span>`
  }
  const cartaoCand = (c, i) => {
    const a = atual2026(c)
    const cor = corPartido(c.partido)
    return `<li class="h22-cand clicavel" style="${estiloCor(cor)}" ${attrHist(ano, elEstado.id, c)}>
      <div class="cand-linha"><span class="pos">${municipal && !H22.local ? el.candidatos.indexOf(c) + 1 : c.pos}º</span><span class="cand-nome">${esc(c.nome)}</span> ${pill(c.partido)} ${situ2022(c.sit)}</div>
      <div class="cand-meta">${fmt.format(c.votos)} votos${municipal && !H22.local ? ` · ${esc(NOME_MUN.get(c.cd) || '')}` : ` · ${fmtPct.format(pctDe(c.votos, el.validos))}%`}${c.fed ? ` · ${esc(c.fed)}` : ''}</div>
      ${municipal ? linhaPerfil(ano, c.sq) : ''}
      <div class="cand-meta">${st26(c)}</div>
    </li>`
  }
  // partidos: 2022 × 2026 (votos nominais do mesmo cargo)
  let partidos = ''
  if (prop && !municipal) {
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
    partidos = `<section class="cartao"><h3>Partidos: ${ano} × 2026</h3>
      <p class="nota">% dos votos nominais do cargo. Vagas 2026 = eleitos pelo TSE ou, antes disso, a projeção do app${d26 ? ` (${fmtPct.format(d26.secoes.percentual)}% apurado)` : ''}.</p>
      <table class="tabela h22-part"><thead><tr><th>Partido</th><th class="dir">${ano}</th><th class="dir">2026</th></tr></thead><tbody>${siglas
        .filter((sg) => (g22.get(sg)?.votos || 0) / tot22 > 0.003 || (g26.get(sg)?.votos || 0) / tot26 > 0.003)
        .map((sg) => {
          const a = g22.get(sg), b = g26.get(sg)
          const p22 = a ? pctDe(a.votos, tot22) : 0, p26 = b ? pctDe(b.votos, tot26) : 0
          return `<tr style="${estiloCor(corPartido(sg))}"><td>${pill(sg)}</td>
            <td class="dir">${fmtPct.format(p22)}%<div class="cand-meta">${a?.eleitos || 0} eleitos</div></td>
            <td class="dir">${d26 ? `${fmtPct.format(p26)}% <span class="h22-delta ${p26 >= p22 ? 'sobe' : 'desce'}">${seta(p26 - p22)}</span><div class="cand-meta">${b?.vagas || 0} vagas</div>` : '–'}</td></tr>`
        })
        .join('')}</tbody></table>
      <p class="nota">Partidos mudaram de nome ou se fundiram desde ${ano}; a comparação é pela sigla.</p></section>`
  }
  const busca = !municipal || !H22.mv || H22.mv === 'votos' ? cartaoBuscaCand(ano, j) : ''
  return `<section class="cartao resumo">
      <div class="resumo-titulo"><h2>Eleições ${ano} · ${esc(el.nome)}${el.turno === 2 ? ' (2º turno)' : ''} · ${municipal && H22.local ? esc(H22.local.nm) : 'SC'}</h2><span class="selo final">Resultado oficial</span></div>
      ${municipal ? seletorMunicipal() : ''}
      ${!municipal || !H22.mv || H22.mv === 'votos' ? pills : ''}
      ${seletorLocal(H22)}
      <p class="nota">${fmt.format(el.validos)} votos nominais válidos · ${el.candidatos.length} candidatos${prop && el.vagas ? ` · ${el.vagas} vagas` : ''}.${prop && el.qe ? ` <strong>📐 Quociente eleitoral de ${ano}: ${fmt.format(el.qe)}</strong> (${fmt.format(el.validosTotais)} válidos com legenda ÷ ${el.vagas}).` : ''} Toque num candidato para abrir a ficha dele em ${ano}: onde foi mais votado (até a urna), mapa e histórico.</p>
    </section>
    ${busca}
    ${municipal && H22.mv === 'prefeitos' ? renderPrefeitos(ano) : municipal && H22.mv === 'camaras' ? renderCamaras(ano) : municipal && H22.mv === 'perfil' ? renderPerfil(ano, j) : H22.local ? (municipal ? fichaCidadeMunicipal(ano, H22.local.cd) : '') + renderLocal(H22, el) : `${abstSC(H22, elEstado, ano)}<section class="cartao"><h3>${municipal && !H22.local ? `Mais votados de SC em ${ano} (${esc(el.nome)}) e onde estão em 2026` : prop ? `Eleitos em ${ano} (${eleitos.length}) e onde estão em 2026` : `Principais candidatos de ${ano} e onde estão em 2026`}</h3>
      ${municipal && !H22.local ? '<p class="nota">Escolha um município acima para ver os candidatos dele e os votos por zona, bairro, local e seção.</p>' : ''}
      <ul class="h22-lista">${destaque.map(cartaoCand).join('')}</ul></section>
    ${partidos}
    `}
    <p class="nota centro">Fonte: TSE, Portal de Dados Abertos (votação por candidato/município/zona e por seção eleitoral, ${ano}).</p>
    <p class="centro"><label class="mini-pref"><input type="checkbox" data-pref="2022" checked> Mostrar dados de 2022 no app</label></p>`
}

// 🔎 busca de candidatos do ano: nome, partido ou número, com filtros de cargo, situação (eleitos, suplentes,
// não eleitos) e cidade; cada linha abre a ficha completa do candidato naquela eleição
const sitBusca = (c) => (/^ELEITO/.test(c.sit || '') ? 'eleito' : /SUPLENTE/.test(c.sit || '') ? 'suplente' : 'nao')
function cartaoBuscaCand(ano, j) {
  const el = j.eleicoes.find((e) => e.id === H22.buscaCargo) || j.eleicoes.find((e) => e.id === H22.sel) || j.eleicoes[0]
  const municipal = ehMunicipal(el.cargo)
  const cid = municipal && H22.local && !H22.buscaSC ? H22.local : null
  const palavras = semAcento(H22.busca.trim()).split(/\s+/).filter(Boolean)
  const sit = H22.buscaSit || ''
  const base = cid ? el.candidatos.filter((c) => c.cd === cid.cd) : el.candidatos
  const achados = base.filter((c) => !palavras.length || casa(semAcento(`${c.nome} ${c.nomeCompleto} ${c.partido} ${c.numero}`), palavras))
  const conta = { eleito: 0, suplente: 0, nao: 0 }
  for (const c of achados) conta[sitBusca(c)]++
  // "não eleitos" inclui os suplentes (todos os que não ganharam a vaga)
  conta.naoTodos = conta.nao + conta.suplente
  const lista = achados.filter((c) => !sit || (sit === 'nao' ? sitBusca(c) !== 'eleito' : sitBusca(c) === sit)).sort((a, b) => b.votos - a.votos)
  const max = H22.buscaTodos ? lista.length : 60
  const onde = cid ? cid.nm : 'SC'
  const rotSit = { '': 'Todos', eleito: '✔ Eleitos', nao: '✖ Não eleitos', suplente: 'Só suplentes' }
  H22.csvBusca = {
    nome: `candidatos-${nomeArquivo(ROTULO_ELEICAO[el.id] || el.nome)}-${ano}-${nomeArquivo(onde)}${sit ? `-${sit}` : ''}.csv`,
    cab: ['Candidato', 'Nome completo', 'Número', 'Partido', ...(municipal ? ['Município', 'Posição na cidade'] : ['Posição']), 'Votos', 'Situação'],
    linhas: lista.map((c) => [c.nome, c.nomeCompleto, c.numero, c.partido, ...(municipal ? [NOME_MUN.get(c.cd) || c.cd, c.pos] : [c.pos]), c.votos, c.sit]),
  }
  const linha = (c) => `<li class="h22-cand clicavel" style="${estiloCor(corPartido(c.partido))}" ${attrHist(ano, el.id, c)}>
      <div class="cand-linha"><span class="cand-nome">${esc(c.nome)}</span> ${pill(c.partido)} <span class="mudo">nº ${esc(c.numero)}</span> ${situ2022(c.sit || '')}</div>
      <div class="cand-meta">${fmt.format(c.votos)} votos · ${c.pos}º ${municipal ? `em ${esc(NOME_MUN.get(c.cd) || '')}` : 'em SC'}${c.nomeCompleto && c.nomeCompleto !== c.nome ? ` · ${esc(c.nomeCompleto)}` : ''} · <span class="link-ficha">ver a ficha ›</span></div>
      ${municipal ? linhaPerfil(ano, c.sq) : ''}</li>`
  return `<section class="cartao busca-cand" id="busca-cand"><h3>🔎 Buscar candidato · ${ano}</h3>
      <input id="h22-busca" type="search" placeholder="Nome, partido ou número (eleitos e não eleitos)…" value="${esc(H22.busca)}" autocomplete="off">
      <div class="segmentado" role="group" aria-label="Cargo">${j.eleicoes.map((e) => `<button type="button" data-bc-cargo="${e.id}" aria-pressed="${e === el}">${esc(ROTULO_ELEICAO[e.id] || e.nome)}</button>`).join('')}</div>
      <div class="segmentado" role="group" aria-label="Situação">${Object.entries(rotSit).map(([k, r]) => `<button type="button" data-bc-sit="${k}" aria-pressed="${sit === k}">${r}${k ? ` <small>${fmt.format(k === 'nao' ? conta.naoTodos : conta[k])}</small>` : ''}</button>`).join('')}</div>
      ${municipal && H22.local ? `<div class="atalhos-chips"><button type="button" class="atalho ${cid ? 'ativo' : ''}" data-bc-sc="0">📍 Só ${esc(H22.local.nm)}</button><button type="button" class="atalho ${cid ? '' : 'ativo'}" data-bc-sc="1">🗺️ SC inteira</button></div>` : ''}
      <p class="nota"><strong>${fmt.format(lista.length)}</strong> ${lista.length === 1 ? 'candidato' : 'candidatos'} a ${esc((ROTULO_ELEICAO[el.id] || el.nome).toLowerCase())} em ${esc(onde)}${palavras.length ? ' na busca' : ''} · ${fmt.format(conta.eleito)} eleitos · ${fmt.format(conta.naoTodos)} não eleitos${conta.suplente ? ` (${fmt.format(conta.suplente)} suplentes)` : ''}${lista.length > max ? ` · mostrando ${max}` : ''}.${municipal && !H22.local ? ' Escolha um município acima para ver só os candidatos dele.' : ''}</p>
      <ul class="h22-lista">${lista.slice(0, max).map(linha).join('') || '<li class="nota">Nenhum candidato encontrado.</li>'}</ul>
      ${lista.length > max ? `<button type="button" class="botao secundario" data-bc-todos>Mostrar todos (${fmt.format(lista.length)})</button>` : ''}
      <div class="exportar"><button type="button" class="botao secundario" data-bc-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-bc-xlsx>${icone('baixar')} Excel</button>${botaoLink()}</div>
      <p class="nota">Toque num candidato para abrir a ficha completa dele em ${ano} (votos por zona, bairro, seção e urna, mapa, histórico, comparar e acompanhar). Fonte: TSE.</p>
    </section>`
}

// eleição municipal vista de uma cidade: só os candidatos dela, com os válidos da cidade
function cidadeDe(el, cd) {
  el._cidades ??= new Map()
  if (!el._cidades.has(cd)) {
    const candidatos = el.candidatos.filter((c) => c.cd === cd)
    const vagas = el.cargo === 13 ? candidatos.filter((c) => /^ELEITO/.test(c.sit)).length : 1
    el._cidades.set(cd, { ...el, candidatos, vagas, validos: candidatos.reduce((a, c) => a + c.votos, 0), porNumero: null, _cidades: null })
  }
  return el._cidades.get(cd)
}

/* ---------------- ficha de uma eleição anterior ---------------- */

// A ficha do candidato também abre para as eleições de 2012 a 2024: a "aba" é virtual, h<ano>-<eleição>
// (ex.: h2024-t1-c13), e a abrangência é o município (prefeito e vereador) ou 'sc'.
const ID_HIST = /^h(\d{4})-(t\d-c\d+)$/
const ehAbaHist = (id) => ID_HIST.test(id || '')
function abaHist(id) {
  const m = ID_HIST.exec(id || '')
  if (!m) return null
  const ano = Number(m[1]), el = m[2], cargo = Number(el.split('-c')[1])
  return { id, ano, el, cargo, hist: true, tipo: ehProp(cargo) ? 'prop' : 'maj', rotulo: `${ROTULO_ELEICAO[el] || el} ${ano}`, abrangencias: ['sc'] }
}
export const abaDe = (id) => ABAS.find((a) => a.id === id) || abaHist(id)
const eleicaoHist = (ano, el) => histDe(ano).resumo?.eleicoes.find((e) => e.id === el) || null
const idHist = (ano, el) => `h${ano}-${el}`
// atributos para abrir a ficha de um candidato de uma eleição anterior
const attrHist = (ano, elId, c) => `data-cand="${esc(c.sq)}" data-cand-aba="${esc(idHist(ano, elId))}" data-cand-abr="${esc(c.cd || 'sc')}"`
const nomeAbr = (abr) => (abr === 'sc' || abr === UF ? 'Santa Catarina' : NOME_MUN.get(abr) || NOMES_ABR[abr] || String(abr).toUpperCase())

// a lista da eleição no formato da apuração ao vivo (o que a ficha usa)
const DADOS_HIST = new Map()
function dadosHist(id, abr) {
  const a = abaHist(id)
  const el0 = a && eleicaoHist(a.ano, a.el)
  if (!el0) return null
  const k = `${id}|${abr}`
  if (!DADOS_HIST.has(k)) {
    const mun = ehMunicipal(a.cargo)
    const el = mun ? cidadeDe(el0, abr) : el0
    const candidatos = el.candidatos.map((x) => ({
      sqcand: x.sq, sq: x.sq, numero: String(x.numero), nome: x.nome, nomeCompleto: x.nomeCompleto, partido: x.partido, agremiacao: x.fed || x.partido, fed: x.fed,
      votos: x.votos, percentual: pctDe(x.votos, el.validos), eleito: /^ELEITO/.test(x.sit || ''), situacao: x.sit || '', sit: x.sit, tseDefinido: true, valido: true, vices: [], foto: '', cd: x.cd,
    }))
    DADOS_HIST.set(k, { hist: a, ano: a.ano, el, elEstado: el0, cd: mun ? abr : null, candidatos, vagas: el.vagas || 1, secoes: { percentual: 100 }, final: true, tseDefinido: true, atualizadoEm: 'resultado oficial', votos: { validos: el.validos } })
  }
  return DADOS_HIST.get(k)
}

// participação anterior do candidato, para comparar ("anterior × esta"): a mais recente antes do ano,
// de preferência no mesmo cargo (e, nos cargos municipais, na mesma cidade)
function anteriorDe(c, ano, cargo, cd = null) {
  if (!PREF.mostrar2022 || !c?.nomeCompleto) return null
  const ps = acharAnteriores(c).filter((p) => p.el.ano < ano && p.el.turno === 1)
  const nota = (p) => (p.el.cargo === cargo ? 2 : 0) + (cd && p.c.cd === cd ? 1 : 0)
  return ps.sort((x, y) => nota(y) - nota(x) || y.el.ano - x.el.ano)[0] || null
}

// de onde vêm os votos do candidato na ficha: 2026 (boletins de urna) ou uma eleição anterior (dados abertos)
// { ano, elId, cargo, nr, el (para agregarSecoes), cdFixo (cargos municipais), mun: { validos, meus, todos } | null, erro }
function fonteFicha(det, c, aba, re) {
  const nr = Number(c.numero)
  if (aba?.hist) {
    const M = munAno(aba.ano, aba.el)
    if (!M.valor) M.then(re).catch(() => {})
    const el = eleicaoHist(aba.ano, aba.el) || { id: aba.el, cargo: aba.cargo, anul: new Set() }
    const cdFixo = ehMunicipal(aba.cargo) ? c.cd || det?.abr : null
    return { ano: aba.ano, elId: aba.el, cargo: aba.cargo, nr, el, cdFixo, hist: true, chapeu: `ELEIÇÕES ${aba.ano}`,
      mun: M.valor ? { validos: M.valor.validos, meus: M.valor.cand[c.sqcand] || {}, todos: M.valor.cand } : null, erro: false }
  }
  const elId = eleicaoDoCargo(aba.cargo)
  const M = arquivoAno(`dados2026/municipios-${elId}.json`, re)
  return { ano: 2026, elId, cargo: aba.cargo, nr, el: { id: elId, cargo: aba.cargo, anul: new Set() }, cdFixo: null, hist: false, chapeu: 'APURAÇÃO 2026',
    mun: M.valor ? { validos: M.valor.validos, meus: M.valor.c[nr] || {}, todos: M.valor.c } : null, erro: !!M.erro }
}
// participação anterior usada na comparação da ficha (2026: a de 2022)
function refFicha(c, aba, F) {
  if (!PREF.mostrar2022) return null
  if (!F.hist) {
    if (!H22.resumo) return null
    const parts = achar2022(c).filter((p) => p.el.turno === 1)
    return parts.find((p) => p.el.cargo === aba.cargo) || parts[0] || null
  }
  return anteriorDe(c, F.ano, F.cargo, F.cdFixo)
}

/* ---------------- 2026 por bairro, local e seção (boletins de urna) ---------------- */

// Votos de cada seção do 1º turno de 2026, lidos dos boletins de urna (BU) publicados pelo TSE,
// com o bairro de cada local de votação (cadastro de locais do TSE; em Florianópolis, a lista do TRE-SC).
export const B26 = { sel: 't1-c7', local: null, grupo: 'zona', foco: null, els: new Map() }
const estadoLocal = () => (estado.aba.tipo === 'bai' ? B26 : H22)
export const ROTULO_26 = { 't1-c1': 'Presidente', 't1-c3': 'Governador', 't1-c5': 'Senado', 't1-c6': 'Dep. Federal', 't1-c7': 'Dep. Estadual', 't2-c1': 'Presidente · 2º turno', 't2-c3': 'Governador · 2º turno' }
// eleições com dados por seção já publicados (dados2026/indice.json); o 2º turno entra sozinho quando for gerado
export const INDICE26 = new Set(['t1-c1', 't1-c3', 't1-c5', 't1-c6', 't1-c7'])
export const indice26Pronto = fetch(`dados2026/indice.json?v=${VERSAO}`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => j?.eleicoes?.forEach((id) => INDICE26.add(id)))
  .catch(() => {})
export const eleicoes26 = () => Object.keys(ROTULO_26).filter((id) => INDICE26.has(id))
export const turnoDe = (id) => Number(String(id)[1]) || 1
// eleição por seção para um cargo: a do turno atual, se já publicada; senão a do 1º turno
export const eleicaoDoCargo = (cargo) => (INDICE26.has(`t${TURNO}-c${cargo}`) ? `t${TURNO}-c${cargo}` : `t1-c${cargo}`)
export const NOME_MUN = new Map(MUNICIPIOS_SC.map((m) => [m[0], m[2]]))

// "eleição" de 2026 no formato do explorador, a partir dos candidatos do estado
export function eleicao26(d, cargo, turno = 1) {
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

// candidatos de 2026 de um cargo, no formato do explorador (B26.els), carregando do TSE se preciso
async function carregarEleicao(cargo, signal) {
  await indice26Pronto
  const id = eleicaoDoCargo(cargo)
  if (B26.els.has(id)) return B26.els.get(id)
  const aba = ABAS.find((a) => a.cargo === cargo)
  if (!aba) throw new Error('Cargo inválido')
  const d = await buscar(aba, UF, turnoDe(id), signal)
  const el = eleicao26(d, cargo, turnoDe(id))
  B26.els.set(id, el)
  return el
}

// 🧭 Campanha: conta, equipe, IA e notas (campanha.js)
async function carregarCampanha(ctrl) {
  try {
    await prepararCampanha(ctrl.signal)
  } catch {}
  if (ctrl.signal.aborted) return
  estado.dados = { camp: true }
  renderizar()
  statusEl.textContent = 'Campanha'
  statusEl.className = 'status ok'
}

/* ---------------- anos anteriores nas abas de cargo: as mesmas telas da apuração, com o resultado oficial ---------------- */

// candidatos do cargo no município ou região escolhidos (votos por município de dados<ano>/mun-<eleição>.json)
async function dadosHistMun(base, ano, elId, mun) {
  const M = await munAno(ano, elId)
  const cds = mun.regiao ? mun.membros.map((m) => m.cd) : [mun.cd]
  const soma = (obj) => cds.reduce((a, cd) => a + (obj?.[cd] || 0), 0)
  const validos = soma(M.validos)
  const candidatos = base.candidatos
    .map((c) => ({ ...c, votos: soma(M.cand[c.sqcand]) }))
    .sort((a, b) => b.votos - a.votos)
    .map((c) => ({ ...c, percentual: pctDe(c.votos, validos) }))
  return { ...base, candidatos, votos: { validos } }
}

async function carregarHist(ctrl) {
  const aba = estado.aba, ano = anoAtual()
  try {
    await resumoAno(ano)
  } catch {
    if (ctrl.signal.aborted) return
    estado.dados = null
    conteudo.innerHTML = `<div class="cartao vazio erro"><p>Não consegui carregar os dados de ${ano}.</p></div>`
    statusEl.textContent = 'Erro ao carregar'
    statusEl.className = 'status erro'
    return
  }
  if (ctrl.signal.aborted) return
  // cargos municipais: sempre dentro de uma cidade (Florianópolis se nenhuma foi escolhida)
  if (aba.municipal && (!estado.mun || estado.mun.regiao)) {
    estado.mun = { cd: FLORIPA_CD, nm: 'Florianópolis' }
    gravarLocal(`${PREFIXO}municipio:v1`, JSON.stringify(estado.mun))
  }
  const mun = munAtual()
  let elId = elDoAno(aba.cargo)
  let d = dadosHist(idHist(ano, elId), aba.municipal ? mun.cd : 'sc')
  if ((!d || !d.candidatos.length) && turnoAtual() === 2) {
    estado.turnoHist = 1
    elId = elDoAno(aba.cargo)
    d = dadosHist(idHist(ano, elId), aba.municipal ? mun.cd : 'sc')
  }
  if (!d || !d.candidatos.length) {
    estado.dados = null
    conteudo.innerHTML = cabecalhoAbrangencia() + `<div class="cartao vazio"><p class="vazio-titulo">Sem resultado de ${esc(aba.rotulo)} em ${ano}${aba.municipal && mun ? ` para ${esc(mun.nm)}` : ''}</p><p>${aba.municipal ? 'Escolha outro município.' : 'Essa eleição não está nos dados do app.'}</p></div>`
    statusEl.textContent = `Resultado oficial · TSE ${ano}`
    statusEl.className = 'status ok'
    return
  }
  try {
    if (mun && !aba.municipal) d = await dadosHistMun(d, ano, elId, mun)
  } catch {
    if (ctrl.signal.aborted) return
    d = { ...d, erroMun: true }
  }
  if (ctrl.signal.aborted) return
  const turno = Number(elId[1]) || 1
  d = { ...d, mun: aba.municipal ? null : mun, cargoNome: `${(ROTULO_ELEICAO[elId] || aba.rotulo).replace(/ · 2º turno$/, '')}${turno === 2 ? ' · 2º turno' : ''}`, abrangencia: UF, atualizadoEm: `${ano} (resultado oficial)` }
  estado.anterior = new Map()
  estado.dados = d
  renderizar()
  statusEl.textContent = `Resultado oficial · TSE ${ano}`
  statusEl.className = 'status ok'
}

// 1º/2º turno nos anos anteriores (governador e prefeito, quando houve)
function seletorTurnoHist() {
  const aba = estado.aba
  if (ehAoVivo() || !(aba.cargo === 3 || aba.cargo === 11)) return ''
  const el2 = eleicaoHist(anoAtual(), `t2-c${aba.cargo}`)
  const tem2 = !!el2 && (!aba.municipal || cidadeDe(el2, estado.mun?.cd || FLORIPA_CD).candidatos.length > 0)
  if (!tem2) return ''
  return `<div class="segmentado turnos" role="group" aria-label="Turno">${[1, 2].map((t) => `<button type="button" data-turno-hist="${t}" aria-pressed="${turnoAtual() === t}">${t}º turno</button>`).join('')}</div>`
}

/* ---------------- Meu território: os votos "entregues" nas escolas e seções de uma liderança ---------------- */

// itens: { "cd|z-loc": [] (local inteiro) ou ["z-s", …] (só essas seções) } · ref: candidato municipal de comparação
const TERR = (() => {
  try {
    const t = JSON.parse(lerLocal('territorio:v1', 'null'))
    if (t?.itens) return { cdEdit: null, buscaMun: '', buscaRef: '', abertos: new Set(), ...t }
  } catch {}
  return { nome: 'Meu território', itens: {}, ref: null, cdEdit: null, buscaMun: '', buscaRef: '', abertos: new Set() }
})()
// semEnviar: veio do servidor (campanha.js), não precisa mandar de volta
const salvarTerr = (semEnviar = false) => {
  gravarLocal('territorio:v1', JSON.stringify({ nome: TERR.nome, itens: TERR.itens, ref: TERR.ref }))
  if (!semEnviar) aoSalvarTerritorio()
}
const terrCds = (itens = TERR.itens) => [...new Set(Object.keys(itens).map((k) => k.split('|')[0]))]

// seções (z-s) do território num arquivo de seções do município cd
function secoesDoTerr(arq, cd, itens = TERR.itens) {
  const out = []
  for (const [zs, loc] of Object.entries(arq.secoes)) {
    const it = itens[`${cd}|${loc}`]
    if (it && (!it.length || it.includes(zs))) out.push([zs, loc])
  }
  return out
}

// soma uma eleição nas seções do território, por local; foco = número do candidato
// itens: o território (o da pessoa, ou o de um membro da equipe em campanha.js)
function somaTerr(ano, elId, cargo, foco, anul = new Set(), re, itens = TERR.itens) {
  const porLocal = new Map(), total = new Map()
  let validos = 0, faltam = 0
  for (const cd of terrCds(itens)) {
    const arq26 = secoesAno(2026, cd, re)
    const arq = ano === 2026 ? arq26 : secoesAno(ano, cd, re)
    if (!arq26 || !arq) {
      if (!erroSecoes(ano, cd)) faltam++
      continue
    }
    for (const [zs, loc] of secoesDoTerr(arq26, cd, itens)) {
      const arr = arq.votos[elId]?.[zs]
      if (!arr) continue
      const k = `${cd}|${loc}`
      const g = porLocal.get(k) || { cd, loc, nome: tituloLocal((arq26.locais[loc] || [loc])[0]), bairro: bairroDoLocal(arq26, loc), foco: 0, validos: 0, secoes: 0 }
      g.secoes++
      for (let i = 0; i < arr.length; i += 2) {
        const nr = arr[i], v = arr[i + 1]
        if (nr === 95 || nr === 96 || nr === 97 || anul.has(nr)) continue
        g.validos += v
        validos += v
        if (nr === foco) g.foco += v
        if (!ehProp(cargo) || nr > 99) total.set(nr, (total.get(nr) || 0) + v)
      }
      porLocal.set(k, g)
    }
  }
  const focoTot = [...porLocal.values()].reduce((a, g) => a + g.foco, 0)
  const rank = [...total.entries()].sort((a, b) => b[1] - a[1])
  return { porLocal, focoTot, validos, pos: focoTot ? rank.findIndex(([nr]) => nr === foco) + 1 : 0, n: rank.length, faltam, rank }
}

function renderTerritorio(el) {
  const re = () => estado.aba.tipo === 'bai' && renderizar()
  const nItens = Object.keys(TERR.itens).length
  const cds = terrCds()
  // editor: escolher município e marcar escolas (locais) ou seções
  const termo = semAcento(TERR.buscaMun.trim())
  const achados = termo ? MUNICIPIOS_SC.filter((m) => semAcento(m[2]).includes(termo)).slice(0, 10) : []
  const cdE = TERR.cdEdit
  let lista = ''
  if (cdE) {
    const arq = secoesAno(2026, cdE, re)
    if (!arq) lista = `<p class="nota">${erroSecoes(2026, cdE) ? 'Os boletins deste município ainda não estão no app.' : 'Carregando os locais de votação…'}</p>`
    else {
      const porBairro = new Map()
      const secsDe = new Map()
      for (const [zs, loc] of Object.entries(arq.secoes)) secsDe.set(loc, [...(secsDe.get(loc) || []), zs])
      for (const loc of secsDe.keys()) {
        const b = bairroDoLocal(arq, loc)
        porBairro.set(b, [...(porBairro.get(b) || []), loc])
      }
      lista = [...porBairro.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([b, locs]) => `<div class="terr-bairro"><span class="atalhos-rot">${esc(b)}</span>${locs
        .map((loc) => {
          const k = `${cdE}|${loc}`
          const it = TERR.itens[k]
          const secs = secsDe.get(loc).sort((x, y) => Number(x.split('-')[1]) - Number(y.split('-')[1]))
          const parcial = it?.length ? ` (${it.length} de ${secs.length} seções)` : ''
          const aberto = TERR.abertos.has(k)
          return `<div class="terr-local ${it ? 'marcado' : ''}"><button type="button" class="terr-marca" data-terr-local="${esc(k)}" aria-pressed="${!!it}">${it ? '☑' : '☐'} ${esc(tituloLocal((arq.locais[loc] || [loc])[0]))}<small>${secs.length} seções${parcial}</small></button>
            <button type="button" class="link-zonas leve" data-terr-abrir="${esc(k)}" aria-expanded="${aberto}">${aberto ? 'fechar' : 'seções'}</button>
            ${aberto ? `<div class="atalhos-chips terr-secoes">${secs.map((zs) => { const on = it && (!it.length || it.includes(zs)); return `<button type="button" class="atalho ${on ? 'ativo' : ''}" data-terr-secao="${esc(k)}|${esc(zs)}">${on ? '✓ ' : ''}${Number(zs.split('-')[0])}ª/${zs.split('-')[1]}</button>` }).join('')}</div>` : ''}</div>`
        })
        .join('')}</div>`).join('')
    }
  }
  const editor = `<section class="cartao terr-editor"><h3>📍 ${esc(TERR.nome)} <span class="mudo">· ${nItens} ${nItens === 1 ? 'local' : 'locais'}${cds.length > 1 ? ` em ${cds.length} municípios` : cds.length ? ` · ${esc(NOME_MUN.get(cds[0]) || '')}` : ''}</span></h3>
      <p class="nota">Marque as escolas (locais de votação) ou as seções onde você trabalhou. Fica salvo neste aparelho.</p>
      <input id="terr-nome" type="text" maxlength="40" value="${esc(TERR.nome)}" aria-label="Nome do território">
      <div class="atalhos-chips">${cds.map((cd) => `<button type="button" class="atalho ${cd === cdE ? 'ativo' : ''}" data-terr-cd="${cd}">${esc(NOME_MUN.get(cd) || cd)}</button>`).join('')}</div>
      <input id="terr-mun" type="search" autocomplete="off" placeholder="🔎 Escolher município para marcar escolas…" value="${esc(TERR.buscaMun)}">
      ${termo ? `<div class="atalhos-chips">${achados.map((m) => `<button type="button" class="atalho" data-terr-cd="${m[0]}">${esc(m[2])}</button>`).join('') || '<span class="nota">Nenhum município encontrado.</span>'}</div>` : ''}
      ${cdE ? `<div class="terr-lista"><div class="terr-lista-topo"><strong>Escolas de ${esc(NOME_MUN.get(cdE) || cdE)}</strong><button type="button" class="botao" data-terr-cd="">✓ Pronto</button></div>${lista}<button type="button" class="botao" data-terr-cd="">✓ Pronto</button></div>` : ''}
      ${nItens ? '<button type="button" class="botao secundario" data-terr-limpar>Limpar território</button>' : ''}
    </section>`
  if (!nItens) return editor
  const c = el.porNumero?.get(String(B26.foco)) || el.candidatos.find((x) => Number(x.numero) === B26.foco)
  if (!c) return `${editor}<div class="cartao vazio">Escolha um candidato acima (seus ❤️ ou a busca) para ver os votos dele no seu território.</div>`
  const nr = Number(c.numero)
  const T = somaTerr(2026, el.id, el.cargo, nr, el.anul, re)
  if (T.faltam && !T.porLocal.size) return `${editor}${esqueleto('Carregando as seções do território…')}`
  // 2022: mesmo candidato, nas mesmas seções
  if (PREF.mostrar2022 && !H22.resumo) resumo2022().then(re).catch(() => {})
  const p22 = PREF.mostrar2022 && H22.resumo ? achar2022(c).filter((p) => p.el.turno === 1).sort((x, y) => (y.el.cargo === el.cargo) - (x.el.cargo === el.cargo))[0] : null
  const T22 = p22 ? somaTerr(2022, p22.el.id, p22.el.cargo, Number(p22.c.numero), p22.el.anul, re) : null
  // referência municipal (ex.: o vereador que trabalhou essas seções em 2024)
  const ref = TERR.ref
  const TR = ref ? somaTerr(ref.ano, ref.id, ref.cargo, Number(ref.nr), new Set(), re) : null
  if (ref && !histDe(ref.ano).resumo) resumoAno(ref.ano).then(re).catch(() => {})
  const cor = corPartido(c.partido)
  const locais = [...T.porLocal.values()].sort((a, b) => b.foco - a.foco)
  const de22 = (g) => T22?.porLocal.get(`${g.cd}|${g.loc}`)?.foco ?? 0
  const deRef = (g) => TR?.porLocal.get(`${g.cd}|${g.loc}`)?.foco ?? 0
  const pctSC = pctDe(T.focoTot, c.votos)
  const resumo = `<section class="cartao terr-res" style="${estiloCor(cor)}"><h3>${esc(c.nome)} no seu território</h3>
      <div class="fav-nums">
        <div><span class="fav-rot">Votos</span><strong>${fmt.format(T.focoTot)}</strong>${T22 ? `<span class="mudo">2022: ${fmt.format(T22.focoTot)}</span>` : ''}</div>
        <div><span class="fav-rot">% dos válidos</span><strong>${fmtPct.format(pctDe(T.focoTot, T.validos))}%</strong><span class="mudo">${fmt.format(T.validos)} válidos</span></div>
        <div><span class="fav-rot">Posição</span><strong>${T.pos ? `${T.pos}º` : '–'}</strong><span class="mudo">de ${T.n}</span></div>
      </div>
      <p class="nota">${fmtPct.format(pctSC)}% de todos os votos de ${esc(c.nome)} em SC vieram daqui · ${locais.length} locais, ${locais.reduce((a, g) => a + g.secoes, 0)} seções${T22 && T22.focoTot ? ` · 2022 nas mesmas seções: ${fmt.format(T22.focoTot)} (${esc(ROTULO_ELEICAO[p22.el.id] || '')})` : ''}</p>
      ${T.faltam ? `<p class="nota">Carregando mais ${T.faltam} município(s)…</p>` : ''}
      ${T22 ? listaComparada(locais.map((g) => ({ nome: g.nome, sub: g.bairro, v: g.foco, v22: de22(g), meta: `${fmtPct.format(pctDe(g.foco, g.validos))}% dos votos do local · ${g.secoes} seções` })), cor)
        : `<div class="cmp-lista">${locais.map((g) => `<div class="cmp-linha"><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(g.nome)}</strong> <span class="mudo">· ${esc(g.bairro)}</span></div><strong class="cmp-total">${fmt.format(g.foco)}</strong></div><div class="cand-meta">${fmtPct.format(pctDe(g.foco, g.validos))}% dos votos do local · ${g.secoes} seções</div></div>`).join('')}</div>`}
      <div class="exportar">${botaoCard('territorio', cardTerritorio(c, el, T, T22, TR, locais))}<button type="button" class="botao secundario" data-terr-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-terr-xlsx>${icone('baixar')} Excel</button></div>
    </section>`
  // comparação com um candidato municipal (vereador/prefeito) nas mesmas seções
  const cidades = cds.filter((cd) => cd)
  const anoRef = TERR.anoRef || 2024
  const R = histDe(anoRef).resumo
  if (!R) resumoAno(anoRef).then(re).catch(() => {})
  const tr = semAcento(TERR.buscaRef.trim())
  const candsRef = R && tr.length >= 2 ? R.eleicoes.filter((e) => ehMunicipal(e.cargo)).flatMap((e) => cidades.flatMap((cd) => cidadeDe(e, cd).candidatos.map((x) => ({ e, x })))).filter(({ x }) => semAcento(`${x.nome} ${x.nomeCompleto} ${x.numero}`).includes(tr)).slice(0, 12) : []
  const refCard = `<section class="cartao"><h3>🤝 Comparar com os seus votos</h3>
      <p class="nota">Vereador ou candidato a prefeito? Escolha a sua candidatura (2024 ou 2020) e veja, nas mesmas seções, quantos votos você teve e quantos ${esc(c.nome)} teve.</p>
      <div class="segmentado" role="group">${[2024, 2020, 2016].map((a) => `<button type="button" data-terr-anoref="${a}" aria-pressed="${a === anoRef}">${a}</button>`).join('')}</div>
      <input id="terr-ref-busca" type="search" autocomplete="off" placeholder="🔎 Seu nome ou número em ${anoRef}…" value="${esc(TERR.buscaRef)}">
      ${candsRef.length ? `<div class="atalhos-chips">${candsRef.map(({ e, x }) => `<button type="button" class="atalho" data-terr-ref="${anoRef}|${e.id}|${e.cargo}|${x.numero}|${esc(x.nome)}|${x.cd}" style="${estiloCor(corPartido(x.partido))}">${esc(x.nome)} <small>${esc(ROTULO_ELEICAO[e.id] || '')} · ${esc(NOME_MUN.get(x.cd) || '')}</small></button>`).join('')}</div>` : tr.length >= 2 && R ? '<p class="nota">Ninguém com esse nome nos municípios do território.</p>' : ''}
      ${ref && TR ? `<div class="terr-ref"><p><strong>${esc(ref.nome)}</strong> (${esc(ROTULO_ELEICAO[ref.id] || '')} ${ref.ano}): <strong>${fmt.format(TR.focoTot)}</strong> votos nessas seções × <strong>${esc(c.nome)}</strong> (2026): <strong>${fmt.format(T.focoTot)}</strong> votos${TR.focoTot ? ` · ${fmtDec(T.focoTot / TR.focoTot)}× os seus votos` : ''}. <button type="button" class="link-zonas leve" data-terr-ref-limpar>✕</button></p>
        ${listaDuelo(locais.map((g) => ({ nome: g.nome, sub: g.bairro, a: deRef(g), b: g.foco, valA: 0 })).sort((x, y) => y.a + y.b - (x.a + x.b)), { nome: `${ref.nome} ${ref.ano}`, cor: '#6b7570' }, { nome: `${c.nome} 2026`, cor })}</div>` : ''}
    </section>`
  TERR.csv = { nome: `territorio-${nomeArquivo(TERR.nome)}-${nomeArquivo(c.nome)}.csv`, cab: ['Local', 'Bairro', 'Município', 'Seções', `${c.nome} 2026`, '% do local', ...(T22 ? ['2022'] : []), ...(TR ? [`${ref.nome} ${ref.ano}`] : [])],
    linhas: locais.map((g) => [g.nome, g.bairro, NOME_MUN.get(g.cd) || g.cd, g.secoes, g.foco, pctDe(g.foco, g.validos), ...(T22 ? [de22(g)] : []), ...(TR ? [deRef(g)] : [])]) }
  return editor + resumo + refCard
}

function cardTerritorio(c, el, T, T22, TR, locais) {
  const max = Math.max(1, ...locais.slice(0, 6).map((g) => Math.max(g.foco, T22?.porLocal.get(`${g.cd}|${g.loc}`)?.foco || 0)))
  return {
    turno: turnoDe(el.id), foto: c.foto, nome: c.nome, cor: corPartido(c.partido), sub: `${c.partido} · nº ${c.numero} · ${ROTULO_26[el.id] || ''}`,
    titulo: `${TERR.nome}`, subtitulo: `${locais.length} locais de votação · ${fmtPct.format(pctDe(T.focoTot, T.validos))}% dos válidos${T.pos ? ` · ${T.pos}º lugar` : ''}`,
    tiles: [{ rot: 'Votos entregues', valor: fmt.format(T.focoTot), sub: `${fmtPct.format(pctDe(T.focoTot, T.validos))}% dos válidos${T.pos ? ` · ${T.pos}º lugar` : ''}`, cor: corPartido(c.partido) },
      ...(TR ? [{ rot: `${TERR.ref.nome} · ${TERR.ref.ano}`, valor: fmt.format(TR.focoTot), sub: 'nas mesmas seções', cor: '#6b7570' }] : T22 ? [{ rot: 'Em 2022 (mesmas seções)', valor: fmt.format(T22.focoTot), sub: variacao(T.focoTot, T22.focoTot)?.txt || '', cor: '#a5aca8' }] : [])],
    total: { ...totalCard('Votos entregues no território', T.focoTot, T22 ? T22.focoTot : null), quem: c.nome },
    linhas: locais.slice(0, 6).map((g) => {
      const v22 = T22?.porLocal.get(`${g.cd}|${g.loc}`)?.foco
      return T22 ? { nome: g.nome, extra: g.bairro, par: { v22: v22 || 0, v26: g.foco, max }, dir2: variacao(g.foco, v22 || 0)?.txt || '', corDir2: COR_VAR[variacao(g.foco, v22 || 0)?.cls] } : { nome: g.nome, extra: g.bairro, valor: fmt.format(g.foco), dir2: `${fmtPct.format(pctDe(g.foco, g.validos))}%`, frac: g.foco / max, corBarra: corPartido(c.partido) }
    }),
    rodape: `Entreguei ${fmt.format(T.focoTot)} votos para ${c.nome}`,
  }
}

function tratarTerritorio(h) {
  const b = (sel) => h(sel)
  let x
  if ((x = b('[data-terr-cd]'))) return ((TERR.cdEdit = x.dataset.terrCd || null), (TERR.buscaMun = ''), renderizar(), true)
  if ((x = b('[data-terr-local]'))) {
    const k = x.dataset.terrLocal
    k in TERR.itens ? delete TERR.itens[k] : (TERR.itens[k] = [])
    return (salvarTerr(), renderizar(), true)
  }
  if ((x = b('[data-terr-abrir]'))) {
    const k = x.dataset.terrAbrir
    TERR.abertos.has(k) ? TERR.abertos.delete(k) : TERR.abertos.add(k)
    return (renderizar(), true)
  }
  if ((x = b('[data-terr-secao]'))) {
    const [cd, loc, zs] = x.dataset.terrSecao.split('|')
    const k = `${cd}|${loc}`
    const arq = secoesAno(2026, cd)
    const todas = arq ? Object.entries(arq.secoes).filter(([, l]) => l === loc).map(([s]) => s) : []
    let sel = k in TERR.itens ? (TERR.itens[k].length ? [...TERR.itens[k]] : [...todas]) : []
    sel = sel.includes(zs) ? sel.filter((s) => s !== zs) : [...sel, zs]
    if (!sel.length) delete TERR.itens[k]
    else TERR.itens[k] = sel.length === todas.length ? [] : sel
    return (salvarTerr(), renderizar(), true)
  }
  if (b('[data-terr-limpar]')) return ((TERR.itens = {}), (TERR.ref = null), salvarTerr(), renderizar(), true)
  if ((x = b('[data-terr-anoref]'))) return ((TERR.anoRef = Number(x.dataset.terrAnoref)), (TERR.buscaRef = ''), renderizar(), true)
  if ((x = b('[data-terr-ref]'))) {
    const [ano, id, cargo, nr, nome, cd] = x.dataset.terrRef.split('|')
    TERR.ref = { ano: Number(ano), id, cargo: Number(cargo), nr, nome, cd }
    TERR.buscaRef = ''
    return (salvarTerr(), renderizar(), true)
  }
  if (b('[data-terr-ref-limpar]')) return ((TERR.ref = null), salvarTerr(), renderizar(), true)
  if (b('[data-terr-csv]') && TERR.csv) return (baixarCSV(TERR.csv), true)
  if (b('[data-terr-xlsx]') && TERR.csv) return (baixarExcel(TERR.csv.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Território', ...TERR.csv }], b('[data-terr-xlsx]')), true)
  return false
}

function inputTerritorio(alvo) {
  if (alvo.id === 'terr-mun') TERR.buscaMun = alvo.value
  if (alvo.id === 'terr-ref-busca') TERR.buscaRef = alvo.value
  if (alvo.id === 'terr-nome') {
    TERR.nome = alvo.value.trim() || 'Meu território'
    salvarTerr()
    return
  }
  renderizar()
}

/* ---------------- leitura do QR code do boletim de urna (apuração no próprio aparelho) ---------------- */
function renderBairros26() {
  if (DEMO) return '<div class="cartao vazio">Os bairros usam os boletins de urna reais do TSE e não aparecem no modo demonstração.</div>'
  const el = B26.els.get(B26.sel)
  const pills = `<div class="segmentado h22-pills" role="group">${eleicoes26()
    .map((id) => `<button type="button" data-h22="${id}" aria-pressed="${id === B26.sel}">${ROTULO_26[id]}</button>`)
    .join('')}</div>`
  return `<section class="cartao resumo">
      <div class="resumo-titulo"><h2>Bairros, locais e seções · 2026</h2><span class="selo final">Boletins de urna</span></div>
      ${B26.modo === 'qr' ? '' : pills}
      <div class="segmentado b26-modo" role="group" aria-label="Modo"><button type="button" data-b26-modo="explorar" aria-pressed="${B26.modo !== 'territorio'}">Explorar</button><button type="button" data-b26-modo="territorio" aria-pressed="${B26.modo === 'territorio'}">📍 Meu território</button><button type="button" data-b26-modo="qr" aria-pressed="${B26.modo === 'qr'}">📷 Ler boletim</button></div>
      ${el && B26.modo !== 'qr' ? seletorCandidatoB26(el) : ''}
      ${B26.modo === 'territorio' || B26.modo === 'qr' ? '' : seletorLocal(B26)}
      ${B26.modo === 'qr' ? '' : `<p class="nota">Votos de cada seção eleitoral do ${turnoDe(B26.sel)}º turno, lidos dos boletins de urna publicados pelo TSE e somados pelo bairro do local de votação. Escolha um município para ver por zona, bairro, local e seção.${TURNO === 2 && !INDICE26.has('t2-c1') && !INDICE26.has('t2-c3') ? ' <strong>Os boletins do 2º turno entram aqui assim que forem processados.</strong>' : ''}</p>`}
    </section>
    ${B26.modo === 'qr' ? renderApuracaoQR() : !el ? (B26.erro ? '<div class="cartao vazio">Não consegui carregar os candidatos agora.</div>' : esqueleto('Carregando os candidatos…')) : B26.modo === 'territorio' ? renderTerritorio(el) : B26.local ? renderLocal(B26, el) : (B26.foco != null ? bairrosDoCandidatoSC(el) : fortesPorBairro(el)) + abstSC(B26, el, 2026)}`
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

/* ---------------- análise automática do desempenho (regras, a partir dos números do TSE) ---------------- */

// devolve as frases da análise (texto simples) ou null enquanto os arquivos carregam
function analiseAutomatica(det, c, aba, d, re) {
  if (det.hist) return analiseHist(det, c, aba, d, re)
  if (det.abr !== UF || !aba?.cargo || DEMO) return { frases: [] }
  const elId = eleicaoDoCargo(aba.cargo)
  const M = arquivoAno(`dados2026/municipios-${elId}.json`, re)
  const Bx = arquivoAno(`dados2026/bairros-${elId}.json`, re)
  if (!M.valor || !Bx.valor) return M.erro ? { frases: [] } : null
  const nr = Number(c.numero)
  const meus = M.valor.c[nr] || {}
  const tot = Object.values(meus).reduce((a, v) => a + v, 0)
  if (!tot) return { frases: [] }
  const F = []
  const nomeM = (cd) => NOME_MUN.get(cd) || cd
  const posEm = (cd) => {
    const v = meus[cd] || 0
    let p = 1
    for (const o of Object.values(M.valor.c)) if ((o[cd] || 0) > v) p++
    return p
  }
  // 1) concentração e redutos
  const ord = Object.entries(meus).sort((a, b) => b[1] - a[1])
  const top5 = ord.slice(0, 5)
  const pTop5 = pctDe(top5.reduce((a, [, v]) => a + v, 0), tot)
  const perfil = pTop5 >= 60 ? 'muito concentrada' : pTop5 >= 40 ? 'concentrada' : pTop5 <= 25 ? 'bem espalhada pelo estado' : 'espalhada'
  F.push(`Votação ${perfil}: teve votos em ${fmt.format(ord.length)} dos ${MUNICIPIOS_SC.length} municípios, e os 5 maiores redutos (${top5.map(([cd]) => nomeM(cd)).join(', ')}) somam ${fmtPct.format(pTop5)}% dos votos.`)
  const [cd1, v1] = ord[0]
  const p1 = posEm(cd1)
  F.push(`Maior reduto: ${nomeM(cd1)}, com ${fmt.format(v1)} votos (${fmtPct.format(pctDe(v1, M.valor.validos[cd1]))}% dos válidos da cidade, ${p1}º lugar ali).`)
  const lideres = Object.keys(meus).filter((cd) => posEm(cd) === 1)
  if (lideres.length) F.push(`Foi o mais votado do cargo em ${fmt.format(lideres.length)} ${lideres.length === 1 ? 'município' : 'municípios'}${lideres.length <= 4 ? ` (${lideres.map(nomeM).join(', ')})` : ''}.`)
  // 2) peso relativo: onde a fatia do eleitorado é maior (cidades com pelo menos 1.000 válidos)
  const peso = ord.filter(([cd]) => (M.valor.validos[cd] || 0) >= 1000).map(([cd, v]) => [cd, pctDe(v, M.valor.validos[cd])]).sort((a, b) => b[1] - a[1])
  if (peso.length && peso[0][0] !== cd1) F.push(`Onde tem mais peso: ${nomeM(peso[0][0])}, com ${fmtPct.format(peso[0][1])}% dos votos válidos da cidade.`)
  // 3) associações de municípios
  const assoc = new Map()
  for (const [cd, val] of Object.entries(M.valor.validos)) {
    const sg = ASSOCIACAO_MUN[cd]
    if (!sg) continue
    const x = assoc.get(sg) || { v: 0, val: 0 }
    x.v += meus[cd] || 0
    x.val += val
    assoc.set(sg, x)
  }
  const ass = [...assoc.entries()].map(([sg, x]) => [sg, pctDe(x.v, x.val), x.v]).sort((a, b) => b[1] - a[1])
  if (ass.length > 2) F.push(`Por associação de municípios, é mais forte na ${ass[0][0]} (${fmtPct.format(ass[0][1])}% dos válidos) e mais fraco na ${ass[ass.length - 1][0]} (${fmtPct.format(ass[ass.length - 1][1])}%).`)
  // 4) bairros
  const xb = Bx.valor.c[nr]
  if (xb?.v?.length) {
    const [bi, vb] = xb.v[0]
    const [cdb, nomeB] = Bx.valor.b[bi]
    F.push(`No mapa de bairros, o mais forte é ${nomeB} (${nomeM(cdb)}), com ${fmt.format(vb)} votos; teve votos em ${fmt.format(xb.n)} bairros de SC.`)
  }
  // 5) comparação com 2022 e "para quem perdeu"
  const p22 = PREF.mostrar2022 && H22.resumo ? achar2022(c).filter((p) => p.el.turno === 1).sort((x, y) => (y.el.cargo === aba.cargo) - (x.el.cargo === aba.cargo))[0] : null
  if (p22) {
    const m22 = mun2022(p22.el.id)
    if (!m22.valor) {
      m22.then(re).catch(() => {})
      return null
    }
    const v22 = m22.valor.cand[p22.c.sq] || {}
    const cds = new Set([...Object.keys(meus), ...Object.keys(v22)])
    const dif = [...cds].map((cd) => [cd, (meus[cd] || 0) - (v22[cd] || 0), v22[cd] || 0])
    const sobe = dif.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]), cai = dif.filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1])
    const tot22 = Object.values(v22).reduce((a, v) => a + v, 0)
    const dT = tot - tot22
    const evol = !tot22 ? 'é a primeira comparação possível' : dT >= 0 ? `cresceu ${fmtPct.format((100 * dT) / tot22)}% (+${fmt.format(dT)} votos)` : `caiu ${fmtPct.format((-100 * dT) / tot22)}% (${fmt.format(dT)} votos)`
    F.push(`Em relação a 2022 (${ROTULO_ELEICAO[p22.el.id] || p22.el.nome}, ${fmt.format(tot22)} votos), ${evol}: subiu em ${fmt.format(sobe.length)} municípios e caiu em ${fmt.format(cai.length)}.`)
    if (sobe.length) F.push(`Maior crescimento: ${nomeM(sobe[0][0])} (+${fmt.format(sobe[0][1])} votos${sobe[0][2] >= 20 ? `, +${fmtPct.format((100 * sobe[0][1]) / sobe[0][2])}%` : ''}).`)
    if (cai.length) {
      const [cdq, dq] = cai[0]
      let quem = ''
      // quem mais ganhou votos ali desde 2022, entre os candidatos do mesmo cargo (2026 × a própria votação de 2022)
      if (p22.el.cargo === aba.cargo && d?.candidatos) {
        let melhor = null
        for (const o of d.candidatos) {
          if (o === c || !o.valido) continue
          const agora = M.valor.c[Number(o.numero)]?.[cdq] || 0
          if (!agora) continue
          const o22 = achar2022(o).find((p) => p.el.id === p22.el.id)
          const antes = o22 ? m22.valor.cand[o22.c.sq]?.[cdq] || 0 : 0
          if (!melhor || agora - antes > melhor.g) melhor = { o, g: agora - antes, novo: !o22 }
        }
        if (melhor?.g > 0) quem = ` Lá, quem mais ganhou votos desde 2022 foi ${melhor.o.nome} (${melhor.o.partido}, +${fmt.format(melhor.g)}${melhor.novo ? ', que não disputou esse cargo em 2022' : ''}).`
      }
      F.push(`Maior queda: ${nomeM(cdq)} (${fmt.format(dq)} votos).${quem}`)
    }
  }
  return { frases: F }
}

// análise de uma eleição anterior: em SC (gerais), pelos municípios; na cidade (prefeito e vereador), pelos
// bairros, zonas e seções; e a comparação com a participação anterior do candidato
function analiseHist(det, c, aba, d, re) {
  const F = fonteFicha(det, c, aba, re)
  if (!F.mun) return F.erro ? { frases: [] } : null
  const p22 = refFicha(c, aba, F)
  const A0 = p22?.el.ano
  const frases = []
  const nomeM = (cd) => NOME_MUN.get(cd) || cd
  if (!F.cdFixo) {
    const meus = F.mun.meus
    const tot = Object.values(meus).reduce((a, v) => a + v, 0)
    if (!tot) return { frases: [] }
    const posEm = (cd) => 1 + Object.values(F.mun.todos).filter((o) => (o[cd] || 0) > (meus[cd] || 0)).length
    const ord = Object.entries(meus).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const top5 = ord.slice(0, 5)
    const pTop5 = pctDe(top5.reduce((a, [, v]) => a + v, 0), tot)
    const perfil = pTop5 >= 60 ? 'muito concentrada' : pTop5 >= 40 ? 'concentrada' : pTop5 <= 25 ? 'bem espalhada pelo estado' : 'espalhada'
    frases.push(`Votação ${perfil}: teve votos em ${fmt.format(ord.length)} dos ${MUNICIPIOS_SC.length} municípios, e os 5 maiores redutos (${top5.map(([cd]) => nomeM(cd)).join(', ')}) somam ${fmtPct.format(pTop5)}% dos votos.`)
    const [cd1, v1] = ord[0]
    frases.push(`Maior reduto: ${nomeM(cd1)}, com ${fmt.format(v1)} votos (${fmtPct.format(pctDe(v1, F.mun.validos[cd1]))}% dos válidos da cidade, ${posEm(cd1)}º lugar ali).`)
    const lideres = ord.filter(([cd]) => posEm(cd) === 1).map(([cd]) => cd)
    if (lideres.length) frases.push(`Foi o mais votado do cargo em ${fmt.format(lideres.length)} ${lideres.length === 1 ? 'município' : 'municípios'}${lideres.length <= 4 ? ` (${lideres.map(nomeM).join(', ')})` : ''}.`)
    const peso = ord.filter(([cd]) => (F.mun.validos[cd] || 0) >= 1000).map(([cd, v]) => [cd, pctDe(v, F.mun.validos[cd])]).sort((a, b) => b[1] - a[1])
    if (peso.length && peso[0][0] !== cd1) frases.push(`Onde teve mais peso: ${nomeM(peso[0][0])}, com ${fmtPct.format(peso[0][1])}% dos votos válidos da cidade.`)
    if (p22) {
      const m22 = munAno(p22.el.ano, p22.el.id)
      if (!m22.valor) return (m22.then(re).catch(() => {}), null)
      const v22 = m22.valor.cand[p22.c.sq] || {}
      const tot22 = Object.values(v22).reduce((a, v) => a + v, 0)
      const dif = [...new Set([...Object.keys(meus), ...Object.keys(v22)])].map((cd) => [cd, (meus[cd] || 0) - (v22[cd] || 0), v22[cd] || 0])
      const sobe = dif.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]), cai = dif.filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1])
      const dT = tot - tot22
      frases.push(`Em relação a ${A0} (${ROTULO_ELEICAO[p22.el.id] || p22.el.nome}, ${fmt.format(tot22)} votos), ${dT >= 0 ? `cresceu ${fmtPct.format(pctDe(dT, tot22))}% (+${fmt.format(dT)} votos)` : `caiu ${fmtPct.format(pctDe(-dT, tot22))}% (${fmt.format(dT)} votos)`}: subiu em ${fmt.format(sobe.length)} municípios e caiu em ${fmt.format(cai.length)}.`)
      if (sobe.length) frases.push(`Maior crescimento: ${nomeM(sobe[0][0])} (+${fmt.format(sobe[0][1])} votos).`)
      if (cai.length) frases.push(`Maior queda: ${nomeM(cai[0][0])} (${fmt.format(cai[0][1])} votos).`)
    }
    return { frases }
  }
  // prefeito e vereador: dentro da cidade
  const cd = F.cdFixo
  const arq = secoesAno(F.ano, cd, re)
  if (!arq) return erroSecoes(F.ano, cd) ? { frases: [] } : null
  const ag = (grupo, a = arq, el = F.el, nr = F.nr) => agregarSecoes(a, el, {}, grupo, nr).grupos
  const bs = ag('bairro').filter((g) => g.foco > 0).sort((a, b) => b.foco - a.foco)
  const tot = bs.reduce((a, g) => a + g.foco, 0)
  if (!tot) return { frases: [] }
  const nB = ag('bairro').length
  const top3 = bs.slice(0, 3)
  const pTop = pctDe(top3.reduce((a, g) => a + g.foco, 0), tot)
  frases.push(`Teve votos em ${fmt.format(bs.length)} de ${fmt.format(nB)} bairros de ${nomeM(cd)}; os 3 mais fortes (${top3.map((g) => g.chave).join(', ')}) somam ${fmtPct.format(pTop)}% dos votos — votação ${pTop >= 50 ? 'concentrada' : pTop <= 25 ? 'bem espalhada pela cidade' : 'espalhada'}.`)
  const b1 = bs[0], pos1 = posicaoNoGrupo(b1, F.nr)
  frases.push(`Bairro mais forte: ${b1.chave}, com ${fmt.format(b1.foco)} votos (${fmtPct.format(pctDe(b1.foco, b1.validos))}% dos válidos do bairro${pos1 ? `, ${pos1.p}º lugar ali` : ''}).`)
  const peso = bs.filter((g) => g.validos >= 300).sort((a, b) => b.foco / b.validos - a.foco / a.validos)
  if (peso.length && peso[0] !== b1) frases.push(`Onde teve mais peso: ${peso[0].chave}, com ${fmtPct.format(pctDe(peso[0].foco, peso[0].validos))}% dos votos válidos do bairro.`)
  const lideres = bs.filter((g) => posicaoNoGrupo(g, F.nr)?.p === 1)
  if (lideres.length) frases.push(`Foi o mais votado do cargo em ${fmt.format(lideres.length)} ${lideres.length === 1 ? 'bairro' : 'bairros'}${lideres.length <= 4 ? ` (${lideres.map((g) => g.chave).join(', ')})` : ''}.`)
  const zs = ag('zona').filter((g) => g.foco > 0).sort((a, b) => b.foco - a.foco)
  if (zs.length > 1) frases.push(`Por zona eleitoral, ${fmt.format(zs[0].foco)} votos (${fmtPct.format(pctDe(zs[0].foco, tot))}% do total) vieram da ${Number(zs[0].chave)}ª zona.`)
  const secs = ag('secao')
  const sComVoto = secs.filter((g) => g.foco > 0)
  const s1 = sComVoto.filter((g) => posicaoNoGrupo(g, F.nr)?.p === 1).length
  frases.push(`Teve voto em ${fmt.format(sComVoto.length)} de ${fmt.format(secs.length)} urnas da cidade${s1 ? ` e foi o 1º colocado em ${fmt.format(s1)}` : ''}.`)
  if (p22 && (!ehMunicipal(p22.el.cargo) || p22.c.cd === cd)) {
    const a0 = secoesAno(A0, cd, re)
    if (!a0) return erroSecoes(A0, cd) ? { frases } : null
    const antes = new Map(ag('bairro', a0, p22.el, Number(p22.c.numero)).map((g) => [g.chave, g.foco]))
    const tot0 = [...antes.values()].reduce((a, v) => a + v, 0)
    const ks = new Set([...bs.map((g) => g.chave), ...[...antes.keys()].filter((k) => antes.get(k) > 0)])
    const agora = new Map(bs.map((g) => [g.chave, g.foco]))
    const dif = [...ks].map((k) => [k, (agora.get(k) || 0) - (antes.get(k) || 0)])
    const sobe = dif.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]), cai = dif.filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1])
    const dT = tot - tot0
    frases.push(`Em relação a ${A0} (${ROTULO_ELEICAO[p22.el.id] || p22.el.nome}, ${fmt.format(tot0)} votos em ${nomeM(cd)}), ${dT >= 0 ? `cresceu ${fmtPct.format(pctDe(dT, tot0))}% (+${fmt.format(dT)} votos)` : `caiu ${fmtPct.format(pctDe(-dT, tot0))}% (${fmt.format(dT)} votos)`}: subiu em ${fmt.format(sobe.length)} bairros e caiu em ${fmt.format(cai.length)}.`)
    if (sobe.length) frases.push(`Maior crescimento: ${sobe[0][0]} (+${fmt.format(sobe[0][1])} votos).`)
    if (cai.length) frases.push(`Maior queda: ${cai[0][0]} (${fmt.format(cai[0][1])} votos).`)
  }
  return { frases }
}

function secaoAnalise(det, c, aba, d) {
  const re = () => estado.detalhe === det && renderDetalhe()
  const A = analiseAutomatica(det, c, aba, d, re)
  if (A && !A.frases.length) return ''
  det.analise = A ? { frases: A.frases, card: cardAnalise(c, aba, A.frases) } : null
  return `<section class="cartao analise"><h3>🧠 Análise do desempenho</h3>
    ${A ? `<ul class="analise-lista">${A.frases.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <p class="nota">${det.hist ? `Gerada automaticamente a partir dos números oficiais do TSE (votação por seção de ${aba.ano} e a participação anterior do candidato, ligada pelo nome completo).` : 'Gerada automaticamente a partir dos números oficiais do TSE (boletins de urna de 2026 e resultado de 2022). "Quem mais ganhou votos" indica tendência, não transferência comprovada.'}</p>
      <div class="exportar">${botaoCard('analise', det.analise.card, `${icone('compartilhar')} Compartilhar análise`, 'botao secundario')}</div>` : '<p class="nota">Preparando a análise…</p>'}
  </section>`
}

function cardAnalise(c, aba, frases) {
  return { turno: 1, foto: c.foto, nome: c.nome, cor: corPartido(c.partido), sub: `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ SC$/, '')}`,
    titulo: 'Análise do desempenho', subtitulo: 'Gerada a partir dos números oficiais do TSE', texto: frases }
}

/* ---------------- metas de votos por território (salvas no aparelho) ---------------- */

const salvarMetas = (M) => gravarLocal(`metas:v1:${M.sq}`, JSON.stringify(M.dados))
function lerMetas(sq) {
  try {
    return JSON.parse(lerLocal(`metas:v1:${sq}`, '{}')) || {}
  } catch {
    return {}
  }
}

// linhas do nível: chave, nome, votos 2026 e de 2022 (quando houver)
function baseMetas(det, c, aba, nivel, re) {
  const F = fonteFicha(det, c, aba, re)
  const nr = F.nr
  let p22 = refFicha(c, aba, F)
  if (p22 && F.cdFixo && ehMunicipal(p22.el.cargo) && p22.c.cd !== F.cdFixo) p22 = null
  const A0 = p22?.el.ano || 2022
  if (nivel === 'mun' || nivel === 'assoc') {
    const M = F.mun ? { valor: { validos: F.mun.validos } } : { erro: F.erro }
    const m22 = p22 ? munAno(p22.el.ano, p22.el.id) : null
    if (m22 && !m22.valor) m22.then(re).catch(() => {})
    if (!M.valor || (m22 && !m22.valor)) return null
    const meus = F.mun.meus, v22 = m22?.valor.cand[p22.c.sq] || {}
    const g = new Map()
    for (const cd of Object.keys(M.valor.validos)) {
      const k = nivel === 'mun' ? cd : ASSOCIACAO_MUN[cd]
      if (!k) continue
      const x = g.get(k) || { k, nome: nivel === 'mun' ? NOME_MUN.get(cd) || cd : `${k} · ${ASSOCIACOES[k] || ''}`, v: 0, v22: 0 }
      x.v += meus[cd] || 0
      x.v22 += v22[cd] || 0
      g.set(k, x)
    }
    return { linhas: [...g.values()], tem22: !!p22, A0, A1: F.ano }
  }
  // bairros do lugar escolhido no cartão "Onde foi mais votado"
  const L = det.bai?.mun
  if (!L) return { linhas: [], tem22: false, A0, A1: F.ano }
  const g = new Map()
  for (const cd of L.cds) {
    const arq = secoesAno(F.ano, cd, re)
    if (!arq) return null
    for (const x of agregarSecoes(arq, F.el, {}, 'bairro', nr).grupos) {
      const k = `${cd}|${x.chave}`
      g.set(k, { k, nome: L.cds.length > 1 ? `${x.chave} · ${NOME_MUN.get(cd)}` : x.chave, v: x.foco, v22: 0 })
    }
    if (p22) {
      const a22 = secoesAno(A0, cd, re)
      if (!a22) return null
      for (const x of agregarSecoes(a22, p22.el, {}, 'bairro', Number(p22.c.numero)).grupos) {
        const k = `${cd}|${x.chave}`
        const y = g.get(k) || { k, nome: L.cds.length > 1 ? `${x.chave} · ${NOME_MUN.get(cd)}` : x.chave, v: 0, v22: 0 }
        y.v22 = x.foco
        g.set(k, y)
      }
    }
  }
  return { linhas: [...g.values()], tem22: !!p22, A0, A1: F.ano }
}

const COR_META = (p) => (p >= 100 ? '#0b7a45' : p >= 70 ? '#e08600' : '#c62828')

function secaoMetas(det, c, aba) {
  if ((det.abr !== UF && !det.hist) || !aba?.cargo || DEMO) return ''
  const re = () => estado.detalhe === det && renderDetalhe()
  const municipal = det.hist && ehMunicipal(aba.cargo)
  const M = (det.metas ??= { sq: c.sqcand, nivel: municipal ? 'bairro' : 'mun', dados: lerMetas(c.sqcand), pct: 10, todos: false })
  const niveis = [...(municipal ? [] : [['mun', 'Municípios'], ['assoc', 'Associações']]), ...(det.bai?.mun ? [['bairro', `Bairros · ${det.bai.mun.nm}`]] : [])]
  if (!niveis.length) return ''
  if (!niveis.some(([k]) => k === M.nivel)) M.nivel = niveis[0][0]
  const base = baseMetas(det, c, aba, M.nivel, re)
  const metas = M.dados[M.nivel] || {}
  const topo = `<div class="segmentado" role="group" aria-label="Nível das metas">${niveis.map(([k, t]) => `<button type="button" data-meta-nivel="${k}" aria-pressed="${M.nivel === k}">${esc(t)}</button>`).join('')}</div>`
  if (!base) return `<section class="cartao metas"><h3>🎯 Metas de votos</h3>${topo}<p class="nota">Carregando…</p></section>`
  const ls = base.linhas.map((x) => ({ ...x, meta: metas[x.k] || 0 }))
  const comMeta = ls.filter((x) => x.meta > 0)
  const vis = (M.todos ? ls : [...comMeta, ...ls.filter((x) => !x.meta).sort((a, b) => b.v - a.v).slice(0, Math.max(0, 15 - comMeta.length))]).sort((a, b) => (b.meta > 0) - (a.meta > 0) || b.meta - a.meta || b.v - a.v)
  const somaMeta = comMeta.reduce((a, x) => a + x.meta, 0), somaRes = comMeta.reduce((a, x) => a + x.v, 0)
  const pTot = somaMeta ? (100 * somaRes) / somaMeta : 0
  const linha = (x) => {
    const p = x.meta ? (100 * x.v) / x.meta : 0
    return `<div class="meta-linha"><div class="meta-topo"><strong>${esc(x.nome)}</strong>${x.meta ? `<span class="meta-pct" style="color:${COR_META(p)}">${fmtPct.format(p)}%</span>` : ''}</div>
      <div class="meta-campos"><label>Meta <input type="text" inputmode="numeric" class="meta-inp" data-meta-k="${esc(x.k)}" value="${x.meta ? fmt.format(x.meta) : ''}" placeholder="—"></label>
        <span>${base.A1}: <strong>${fmt.format(x.v)}</strong></span>${base.tem22 ? `<span class="mudo">${base.A0}: ${fmt.format(x.v22)}</span>` : ''}</div>
      ${x.meta ? `<div class="barra fina"><span style="width:${Math.min(100, p)}%;background:${COR_META(p)}"></span></div>` : ''}</div>`
  }
  M.export = {
    csv: { nome: `metas-${nomeArquivo(c.nome)}-${M.nivel}.csv`, cab: [niveis.find(([k]) => k === M.nivel)[1], 'Meta', `Resultado ${base.A1}`, 'Atingimento %', ...(base.tem22 ? [String(base.A0)] : [])],
      linhas: comMeta.sort((a, b) => b.meta - a.meta).map((x) => [x.nome, x.meta, x.v, (100 * x.v) / x.meta, ...(base.tem22 ? [x.v22] : [])]) },
    card: comMeta.length ? { turno: 1, foto: c.foto, nome: c.nome, cor: corPartido(c.partido), sub: `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ SC$/, '')}`,
      titulo: `Meta × resultado · ${niveis.find(([k]) => k === M.nivel)[1]}`, subtitulo: `${comMeta.length} lugares com meta · ${fmtPct.format(pTot)}% da meta atingida`,
      tiles: [{ rot: 'Meta', valor: fmt.format(somaMeta), cor: '#6b7570' }, { rot: 'Resultado', valor: fmt.format(somaRes), sub: `${fmtPct.format(pTot)}% da meta`, corSub: COR_META(pTot), cor: corPartido(c.partido) }],
      linhas: comMeta.sort((a, b) => b.meta - a.meta).slice(0, 5).map((x) => {
        const p = (100 * x.v) / x.meta
        return { nome: x.nome, par: { max: Math.max(1, ...comMeta.slice(0, 5).flatMap((y) => [y.meta, y.v])), barras: [{ rot: 'Meta', v: x.meta, cor: '#a5aca8' }, { rot: 'Resultado', v: x.v, cor: COR_META(p) }] }, dir2: `${fmtPct.format(p)}%`, corDir2: COR_META(p) }
      }) } : null,
  }
  return `<section class="cartao metas"><h3>🎯 Metas de votos</h3>
    <p class="nota">${det.hist ? `Defina uma meta para cada lugar (ex.: a próxima eleição) e compare com o resultado de ${aba.ano}.` : 'Defina uma meta para cada lugar e acompanhe meta × resultado.'} Fica salvo neste aparelho.</p>
    ${topo}
    <div class="meta-auto"><span>Preencher com</span><select id="meta-base" aria-label="Base">${base.tem22 ? `<option value="22">${base.A0}</option>` : ''}<option value="26">${base.A1}</option></select><span>+</span><input id="meta-pct" type="number" value="${M.pct}" step="5" aria-label="Percentual"><span>%</span><button type="button" class="botao secundario" data-meta-auto>Preencher</button>${comMeta.length ? '<button type="button" class="link-zonas leve" data-meta-limpar>Limpar metas</button>' : ''}</div>
    ${comMeta.length ? `<div class="meta-total"><span>Total: <strong>${fmt.format(somaRes)}</strong> de <strong>${fmt.format(somaMeta)}</strong></span><span class="meta-pct" style="color:${COR_META(pTot)}">${fmtPct.format(pTot)}%</span><div class="barra"><span style="width:${Math.min(100, pTot)}%;background:${COR_META(pTot)}"></span></div></div>` : ''}
    <div class="meta-lista">${vis.map(linha).join('')}</div>
    ${!M.todos && ls.length > vis.length ? `<button type="button" class="botao secundario" data-meta-todos>Mostrar todos (${fmt.format(ls.length)})</button>` : ''}
    ${M.export.card ? `<div class="exportar">${botaoCard('metas', M.export.card)}<button type="button" class="botao secundario" data-meta-xlsx>${icone('baixar')} Excel</button></div>` : ''}
  </section>`
}

function tratarMetas(ev) {
  const det = estado.detalhe
  const M = det.metas
  const h = (s) => ev.target.closest(s)
  if (h('[data-meta-nivel]')) return ((M.nivel = h('[data-meta-nivel]').dataset.metaNivel), (M.todos = false), renderDetalhe(), true)
  if (h('[data-meta-todos]')) return ((M.todos = true), renderDetalhe(), true)
  if (h('[data-meta-limpar]')) return ((M.dados[M.nivel] = {}), salvarMetas(M), renderDetalhe(), true)
  if (h('[data-meta-xlsx]') && M.export) return (baixarExcel(M.export.csv.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Metas', ...M.export.csv }], h('[data-meta-xlsx]')), true)
  if (h('[data-meta-auto]')) {
    const d = dadosDetalhe()
    const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
    const aba = abaDe(det.aba)
    const base = c && baseMetas(det, c, aba, M.nivel, () => {})
    if (!base) return true
    const pct = Number(document.getElementById('meta-pct')?.value) || 0
    const de22 = document.getElementById('meta-base')?.value === '22'
    M.pct = pct
    const t = (M.dados[M.nivel] = {})
    for (const x of base.linhas) {
      const v = Math.round((de22 ? x.v22 : x.v) * (1 + pct / 100))
      if (v > 0) t[x.k] = v
    }
    salvarMetas(M)
    renderDetalhe()
    return true
  }
  return false
}

/* ---------------- mapa de votos aberto (ficha e comparação) ---------------- */

const MAPAS = new Map() // id → pontos { lat, lon, tam, cor, html }
function coordsLocais(re) {
  const a = arquivoAno('dados2026/locais-mapa.json', re)
  if (a.valor && !a.valor._mun) {
    a.valor._mun = {}
    for (const [cd, ls] of Object.entries(a.valor)) {
      if (cd === '_mun') continue
      const v = Object.values(ls)
      a.valor._mun[cd] = [v.reduce((t, x) => t + x[0], 0) / v.length, v.reduce((t, x) => t + x[1], 0) / v.length]
    }
  }
  return a
}

// mapa da ficha: municípios (SC) ou locais de votação (lugar escolhido no cartão "Onde foi mais votado")
/* ---------------- urna por urna (ficha) ---------------- */

// Todas as seções (urnas) de SC onde o candidato teve voto: lê os arquivos de seções dos municípios em que
// ele aparece (dados2026/municipios-<eleição>.json) e lista seção a seção, com local, bairro, % e posição.
const URNAS = new Map()
const URNAS_CAR = new Map() // carrosséis das urnas de uma zona ou de um bairro (cartão Onde foi mais votado)
// o Instagram aceita até 20 imagens por publicação: acima disso, um botão por parte (cada uma um post)
const POR_POST = 20
function botoesPartes(chave, n, classe = 'link-zonas zona-bairros-bt') {
  if (n <= POR_POST) return `<button type="button" class="${classe}" data-urnas-car="${esc(chave)}">${icone('carrossel')} Carrossel com todas (${n} imagens)</button>`
  const partes = Math.ceil(n / POR_POST)
  return Array.from({ length: partes }, (_, i) => `<button type="button" class="${classe}" data-urnas-parte="${esc(chave)}" data-parte="${i}">${icone('carrossel')} Carrossel parte ${i + 1} de ${partes} (imagens ${i * POR_POST + 1}–${Math.min(n, (i + 1) * POR_POST)})</button>`).join('')
} // `${eleição}|${número}` → { total, feitos, linhas, secoes, carregando }
function carregarUrnas(k, F, cds, re) {
  const { elId, nr, ano } = F
  const U = { total: cds.length, feitos: 0, linhas: [], secoes: 0, carregando: true, ctrl: new AbortController() }
  URNAS.set(k, U)
  const prop = [6, 7, 13].includes(Number(elId.split('-c')[1]))
  const turno = turnoDe(elId)
  let ultimo = 0
  emLotes(cds, 6, async (cd) => {
    try {
      const arq = await arquivoAno(`dados${ano}/secoes/${cd}.json`, () => {})
      arq.cd = cd
      const ap = arq.ap?.[`t${turno}`] || {}
      // votos anulados (candidatos sem registro válido) contam como nulos
      const anul = F.el.anulMun?.get(cd) || F.el.anul || new Set()
      for (const [zs, arr] of Object.entries(arq.votos[elId] || {})) {
        U.secoes++
        let v = 0, val = 0, br = 0, nu = 0
        const nominais = []
        for (let i = 0; i < arr.length; i += 2) {
          const n = arr[i], q = arr[i + 1]
          if (n === 95) { br += q; continue }
          if (n === 96 || n === 97 || anul.has(n)) { nu += q; continue }
          val += q
          if (n === nr) v = q
          if (!prop || n > 99) nominais.push(q)
        }
        if (!v) continue
        const loc = arq.secoes[zs]
        const [nomeLoc, end] = arq.locais[loc] || ['', '']
        U.linhas.push({ cd, zs, z: Number(zs.split('-')[0]), s: Number(zs.split('-')[1]), loc, local: tituloLocal(nomeLoc || `Local ${loc}`), end, bairro: bairroDoLocal(arq, loc), v, val, pos: 1 + nominais.filter((q) => q > v).length, n: nominais.length, ap: ap[zs] || null })
      }
    } catch {}
    U.feitos++
    if (Date.now() - ultimo > 700) ((ultimo = Date.now()), re())
  }, U.ctrl.signal).finally(() => {
    U.carregando = false
    re()
  })
}

// municípios onde o candidato teve voto (mais votos primeiro) e a chave do cache de urnas
function cdsUrnas(F, c) {
  const meus = F.mun?.meus || {}
  const cds = F.cdFixo ? [F.cdFixo] : Object.keys(meus).filter((cd) => meus[cd] > 0).sort((a, b) => meus[b] - meus[a])
  return { cds, k: F.hist ? `${F.ano}|${F.elId}|${c.sqcand}` : `${F.elId}|${F.nr}` }
}
function secaoUrnas(det, c, aba) {
  if ((det.abr !== UF && !det.hist) || !aba?.cargo || DEMO) return ''
  const re = () => estado.detalhe === det && renderDetalhe()
  const F = fonteFicha(det, c, aba, re)
  const elId = F.elId
  if (!F.mun) return F.erro ? '' : `<section class="cartao urnas"><h3>🗳️ Urna por urna</h3><p class="nota">Carregando…</p></section>`
  const { cds, k } = cdsUrnas(F, c)
  if (!cds.length) return ''
  const U = URNAS.get(k)
  const E = (det.urnas ??= { ord: 'v', busca: '', todos: false, vis: 'urnas', zona: null, ordZ: 'v' })
  const cor = corPartido(c.partido)
  const ondeUF = F.cdFixo ? NOME_MUN.get(F.cdFixo) || '' : 'SC'
  const chapeu = F.hist ? `ELEIÇÕES ${F.ano}` : 'APURAÇÃO 2026'
  const rotEl = F.hist ? `${aba.rotulo}${F.cdFixo ? ` · ${ondeUF}` : ''}` : ROTULO_26[elId] || ''
  if (!U) {
    if (cds.length <= 20 || E.zona != null) carregarUrnas(k, F, cds, re)
    else
      return `<section class="cartao urnas" style="${estiloCor(cor)}"><h3>🗳️ Urna por urna</h3>
        <p>Todas as seções eleitorais (urnas) onde <strong>${esc(c.nome)}</strong> teve voto em ${esc(ondeUF)}, com o local de votação, o bairro, os votos, o % na urna e a posição.</p>
        <button type="button" class="botao" data-urnas-carregar>🗳️ Ver as urnas dos ${fmt.format(cds.length)} municípios</button>
        <p class="nota">Lê os boletins de urna dos ${fmt.format(cds.length)} municípios onde teve voto (pode levar alguns segundos).</p></section>`
  }
  const V = URNAS.get(k)
  // zonas: uma zona eleitoral pode abranger várias cidades
  const zonas = new Map()
  for (const u of V.linhas) {
    const z = zonas.get(u.z) || { z: u.z, v: 0, val: 0, n: 0, primeiro: 0, cds: new Set(), melhor: null }
    z.v += u.v
    z.val += u.val
    z.n++
    z.primeiro += u.pos === 1 ? 1 : 0
    z.cds.add(u.cd)
    if (!z.melhor || u.v > z.melhor.v) z.melhor = u
    zonas.set(u.z, z)
  }
  if (E.zona != null && !zonas.has(E.zona) && !V.carregando) E.zona = null
  const termoBruto = E.busca.trim()
  // "12", "12ª" ou "12ª zona": filtro exato pela zona
  const mz = termoBruto.match(/^(\d+)\s*(ª|a)?\s*(zona)?$/i)
  const zonaFiltro = E.zona ?? (mz ? Number(mz[1]) : null)
  const termo = mz ? '' : semAcento(termoBruto)
  // 🔒 público de cada seção (faixa etária que predomina)
  const I = idadeSecoes(F.ano, re)
  if (I) for (const u of V.linhas) u.ida ??= perfilSecao(I, u.cd, u.zs)
  if (!I && (E.ord === 'j' || E.ord === 'i')) E.ord = 'v'
  let ls = V.linhas
  if (zonaFiltro != null) ls = ls.filter((u) => u.z === zonaFiltro)
  if (I && E.faixa != null) ls = ls.filter((u) => u.ida?.top === E.faixa)
  if (termo) ls = ls.filter((u) => semAcento(`${NOME_MUN.get(u.cd) || ''} ${u.bairro} ${u.local} ${u.z}ª zona seção ${u.s}`).includes(termo))
  const ord = { j: (a, b) => (b.ida?.j || 0) - (a.ida?.j || 0) || b.v - a.v, i: (a, b) => (b.ida?.i || 0) - (a.ida?.i || 0) || b.v - a.v, v: (a, b) => b.v - a.v, p: (a, b) => b.v / b.val - a.v / a.val || b.v - a.v, s: (a, b) => (zonaFiltro != null ? 0 : (NOME_MUN.get(a.cd) || '').localeCompare(NOME_MUN.get(b.cd) || '', 'pt-BR')) || a.z - b.z || a.s - b.s }
  ls = [...ls].sort(ord[E.ord] || ord.v)
  const soma = ls.reduce((a, u) => a + u.v, 0)
  const primeiro = V.linhas.filter((u) => u.pos === 1).length
  const max = E.todos ? ls.length : 50
  const prog = V.carregando ? `<div class="progresso mini"><div class="progresso-barra" style="width:${(100 * V.feitos) / V.total}%"></div></div><p class="nota">Lendo os boletins: ${V.feitos} de ${V.total} municípios…</p>` : ''
  const nomeArq = `${nomeArquivo(c.nome)}-urna-por-urna-${nomeArquivo(rotEl || elId)}${zonaFiltro != null ? `-zona-${zonaFiltro}` : ''}`
  const ordZ = { v: (a, b) => b.v - a.v, p: (a, b) => b.v / b.val - a.v / a.val || b.v - a.v, z: (a, b) => a.z - b.z }
  const lz = [...zonas.values()].sort(ordZ[E.ordZ] || ordZ.v)
  const cidadesZ = (z) => [...z.cds].map((cd) => NOME_MUN.get(cd) || cd).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  det.urnasZonas = { cab: ['Zona', 'Municípios', 'Votos', 'Urnas com voto', '% nas urnas da zona', '1º lugar em', 'Melhor seção', 'Votos na melhor seção'], linhas: lz.map((z) => [z.z, cidadesZ(z).join(', '), z.v, z.n, pctDe(z.v, z.val), z.primeiro, `Seção ${z.melhor.s} · ${NOME_MUN.get(z.melhor.cd) || ''}`, z.melhor.v]) }
  det.urnasExport = {
    nome: `${nomeArq}.csv`,
    cab: ['Município', 'Zona', 'Seção', 'Local de votação', 'Endereço', 'Bairro', 'Votos', 'Votos válidos na urna', '% na urna', 'Posição na urna', 'Candidatos com voto', 'Aptos', 'Comparecimento', ...(I ? CAB_IDADE : [])],
    linhas: ls.map((u) => [NOME_MUN.get(u.cd) || u.cd, u.z, u.s, u.local, u.end, u.bairro, u.v, u.val, pctDe(u.v, u.val), u.pos, u.n, u.ap ? u.ap[0] : '', u.ap ? u.ap[1] : '', ...(I ? colsIdade(u.ida) : [])]),
  }
  const top = [...(zonaFiltro != null ? ls : V.linhas)].sort(ord.v).slice(0, 8)
  const cardZonas = {
    chapeu: `${chapeu} · VOTOS POR ZONA`, foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotEl}`,
    titulo: 'Zonas eleitorais com mais votos', subtitulo: `${fmt.format(zonas.size)} zonas com voto`,
    total: { rot: `Votos nas urnas de ${ondeUF}`, valor: `${fmt.format(V.linhas.reduce((a, u) => a + u.v, 0))} votos`, sub: `em ${fmt.format(zonas.size)} zonas` },
    linhas: [...zonas.values()].sort(ordZ.v).slice(0, 8).map((z) => ({ nome: `${z.z}ª zona`, extra: cidadesZ(z).slice(0, 3).join(', ') + (z.cds.size > 3 ? ` +${z.cds.size - 3}` : ''), valor: fmt.format(z.v), dir2: `${fmtPct.format(pctDe(z.v, z.val))}% · ${z.n} urnas`, frac: z.v / (Math.max(...[...zonas.values()].map((x) => x.v)) || 1), corBarra: cor })),
  }
  const card = {
    chapeu: `${chapeu} · URNA POR URNA`, foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotEl}`,
    titulo: zonaFiltro != null ? `Urnas com mais votos · ${zonaFiltro}ª zona` : 'Urnas com mais votos', subtitulo: zonaFiltro != null ? `${fmt.format(ls.length)} urnas com voto na zona · ${cidadesZ(zonas.get(zonaFiltro) || { cds: new Set() }).join(', ')}` : `${fmt.format(V.linhas.length)} urnas com voto · 1º lugar em ${fmt.format(primeiro)}`,
    total: zonaFiltro != null ? { rot: `Votos na ${zonaFiltro}ª zona`, valor: `${fmt.format(soma)} votos`, sub: `em ${fmt.format(ls.length)} seções` } : { rot: `Votos nas urnas de ${ondeUF}`, valor: `${fmt.format(V.linhas.reduce((a, u) => a + u.v, 0))} votos`, sub: `em ${fmt.format(V.linhas.length)} seções` },
    linhas: top.map((u) => ({ nome: `Seção ${u.s} · ${u.z}ª zona`, extra: `${u.local} · ${u.bairro} · ${NOME_MUN.get(u.cd) || ''}${u.ida ? ` · 👥 ${FAIXA_CURTA[u.ida.top]}` : ''}`, valor: fmt.format(u.v), dir2: `${fmtPct.format(pctDe(u.v, u.val))}% · ${u.pos}º`, frac: u.v / (top[0]?.v || 1), corBarra: cor })),
  }
  return `<section class="cartao urnas" style="${estiloCor(cor)}"><h3>🗳️ Urna por urna</h3>
    ${prog}
    <div class="calc-num">
      <div><span>Urnas com voto</span><strong>${fmt.format(V.linhas.length)}</strong><small>de ${fmt.format(V.secoes)} nos ${fmt.format(V.feitos)} municípios</small></div>
      <div><span>1º lugar na urna</span><strong>${fmt.format(primeiro)}</strong><small>urnas</small></div>
      <div><span>Maior votação</span><strong>${fmt.format(top[0]?.v || 0)}</strong><small>${top[0] ? `seção ${top[0].s} · ${esc(NOME_MUN.get(top[0].cd) || '')}` : ''}</small></div>
    </div>
    <div class="segmentado urnas-vis" role="group" aria-label="Ver"><button type="button" data-urnas-vis="urnas" aria-pressed="${E.vis !== 'zonas'}">Todas as urnas</button><button type="button" data-urnas-vis="zonas" aria-pressed="${E.vis === 'zonas'}">Por zona (${fmt.format(zonas.size)})</button>
      <select id="urnas-zona" aria-label="Ir para a zona"><option value="">Zona…</option>${[...zonas.keys()].sort((a, b) => a - b).map((zz) => `<option value="${zz}" ${zz === zonaFiltro ? 'selected' : ''}>${zz}ª zona</option>`).join('')}</select></div>
    ${E.vis === 'zonas'
      ? `<div class="segmentado" role="group" aria-label="Ordenar zonas"><button type="button" data-urnas-ordz="v" aria-pressed="${E.ordZ === 'v'}">Mais votos</button><button type="button" data-urnas-ordz="p" aria-pressed="${E.ordZ === 'p'}">Maior %</button><button type="button" data-urnas-ordz="z" aria-pressed="${E.ordZ === 'z'}">Nº da zona</button></div>
    <p class="nota"><strong>${fmt.format(lz.length)}</strong> zonas eleitorais com voto. Toque numa zona para ver os votos em cada seção dela.</p>
    <table class="tabela urnas-tab zonas-tab"><thead><tr><th>Zona</th><th class="dir">Votos</th></tr></thead><tbody>${lz
      .map((zz) => `<tr class="clicavel" data-urnas-zona="${zz.z}"><td><strong>${zz.z}ª zona</strong> <span class="mudo">· ${zz.n} urnas com voto${zz.primeiro ? ` · 1º em ${zz.primeiro}` : ''}</span>
          <div class="cand-meta">${esc(cidadesZ(zz).join(', '))}</div>
          <div class="cand-meta">Melhor: seção ${zz.melhor.s} (${esc(NOME_MUN.get(zz.melhor.cd) || '')}) · ${fmt.format(zz.melhor.v)} votos</div></td>
        <td class="dir"><strong>${fmt.format(zz.v)}</strong><div class="cand-meta">${fmtPct.format(pctDe(zz.v, zz.val))}%</div></td></tr>`)
      .join('')}</tbody></table>`
      : `${zonaFiltro != null && zonas.get(zonaFiltro) ? (() => { const zz = zonas.get(zonaFiltro); return `<div class="urnas-zona-res"><button type="button" class="atalho ativo" data-urnas-zona="">📍 ${zonaFiltro}ª zona ✕</button>
      <span><strong>${fmt.format(zz.v)}</strong> votos · ${fmt.format(zz.n)} urnas · ${fmtPct.format(pctDe(zz.v, zz.val))}% · ${esc(cidadesZ(zz).join(', '))}</span></div>` })() : ''}
    <input id="urnas-busca" type="search" autocomplete="off" placeholder="🔎 Filtrar por município, bairro, escola, zona ou seção…" value="${esc(E.busca)}">
    <div class="segmentado" role="group" aria-label="Ordenar"><button type="button" data-urnas-ord="v" aria-pressed="${E.ord === 'v'}">Mais votos</button><button type="button" data-urnas-ord="p" aria-pressed="${E.ord === 'p'}">Maior % na urna</button><button type="button" data-urnas-ord="s" aria-pressed="${E.ord === 's'}">Município, zona e seção</button>${I ? `<button type="button" data-urnas-ord="j" aria-pressed="${E.ord === 'j'}">👥 Mais jovens</button><button type="button" data-urnas-ord="i" aria-pressed="${E.ord === 'i'}">👥 Mais idosos</button>` : ''}</div>
    ${I ? `<select id="urnas-faixa" aria-label="Faixa etária que predomina na seção"><option value="">👥 Faixa que predomina na seção: todas</option>${FAIXA_CURTA.map((f, k) => `<option value="${k}" ${E.faixa === k ? 'selected' : ''}>Predomina ${f} anos (${fmt.format(V.linhas.filter((u) => u.ida?.top === k).length)} urnas)</option>`).join('')}</select>` : PRO.chave || DEMO ? '' : '<p class="nota">🔒 <button type="button" class="link-zonas leve" data-pro-abrir>Entre na área protegida</button> para ver a faixa etária que predomina em cada seção.</p>'}
    <p class="nota"><strong>${fmt.format(ls.length)}</strong> urnas${termo ? ' no filtro' : ''} · <strong>${fmt.format(soma)}</strong> votos${ls.length > max ? ` · mostrando ${max}` : ''}.</p>
    <table class="tabela urnas-tab"><thead><tr><th>Urna (seção)</th><th class="dir">Votos</th></tr></thead><tbody>${ls
      .slice(0, max)
      .map((u) => `<tr class="clicavel" data-urnas-ir="${esc(u.cd)}|${esc(u.zs)}|${esc(u.loc)}"><td><strong>Seção ${u.s}</strong> <span class="mudo">· ${u.z}ª zona · ${esc(NOME_MUN.get(u.cd) || u.cd)}</span>
          <div class="cand-meta">${esc(u.local)} · ${esc(u.bairro)}</div>${txtIdadeSecao(u.ida)}</td>
        <td class="dir"><strong>${fmt.format(u.v)}</strong><div class="cand-meta">${fmtPct.format(pctDe(u.v, u.val))}% · ${u.pos}º de ${u.n}</div></td></tr>`)
      .join('')}</tbody></table>
    ${ls.length > max ? `<button type="button" class="botao secundario" data-urnas-todos>Mostrar todas as ${fmt.format(ls.length)} urnas</button>` : ''}`}
    <div class="exportar">${V.carregando ? '' : botaoCard(E.vis === 'zonas' ? 'urnas-zonas' : 'urnas', E.vis === 'zonas' ? cardZonas : card)}<button type="button" class="botao secundario" data-urnas-csv ${V.carregando ? 'disabled' : ''}>${icone('baixar')} Baixar planilha (CSV)</button><button type="button" class="botao secundario" data-urnas-xlsx ${V.carregando ? 'disabled' : ''}>${icone('baixar')} Excel</button></div>
    <p class="nota">Votos de ${esc(c.nome)} em cada seção eleitoral (${F.hist ? `TSE, votação por seção de ${F.ano}` : 'boletins de urna do TSE'}, ${turnoDe(elId)}º turno). "% na urna" = votos ÷ votos válidos da seção; posição entre os candidatos que tiveram voto ali. Toque numa urna para abri-la no explorador ${F.hist ? 'do 📅 Histórico' : 'da aba Bairros'}.${I ? ` 👥 Público de cada seção: eleitorado da seção por faixa etária (TSE, perfil do eleitorado por seção, ${F.ano}); "predomina" é a faixa com mais eleitores, e as faixas têm tamanhos diferentes (18–24 tem 7 idades; 45–59, 15).` : ''}</p>
  </section>`
}
function tratarUrnas(ev, det) {
  const h = (sel) => ev.target.closest(sel)
  if (h('[data-urnas-carregar]')) {
    const aba = abaDe(det.aba)
    const c = dadosDetalhe()?.candidatos.find((x) => x.sqcand === det.sqcand)
    if (!c || !aba) return true
    const re = () => estado.detalhe === det && renderDetalhe()
    const F = fonteFicha(det, c, aba, re)
    if (!F.mun) return true
    const { cds, k } = cdsUrnas(F, c)
    carregarUrnas(k, F, cds, re)
    renderDetalhe()
    return true
  }
  const E = det.urnas
  if (!E) return false
  const vz = h('[data-urnas-vis]')
  if (vz) return ((E.vis = vz.dataset.urnasVis), renderDetalhe(), true)
  const oz = h('[data-urnas-ordz]')
  if (oz) return ((E.ordZ = oz.dataset.urnasOrdz), renderDetalhe(), true)
  const zb = h('[data-urnas-zona]')
  if (zb) {
    E.zona = zb.dataset.urnasZona === '' ? null : Number(zb.dataset.urnasZona)
    E.vis = 'urnas'
    E.todos = false
    E.busca = ''
    renderDetalhe()
    detalheEl.querySelector('.cartao.urnas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }
  const o = h('[data-urnas-ord]')
  if (o) return ((E.ord = o.dataset.urnasOrd), renderDetalhe(), true)
  if (h('[data-urnas-todos]')) return ((E.todos = true), renderDetalhe(), true)
  if (h('[data-urnas-csv]') && det.urnasExport) return (baixarCSV(det.urnasExport), true)
  if (h('[data-urnas-xlsx]') && det.urnasExport) return (baixarExcel(det.urnasExport.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Urnas', ...det.urnasExport }, ...(det.urnasZonas ? [{ aba: 'Zonas', ...det.urnasZonas }] : [])], h('[data-urnas-xlsx]')), true)
  const ir = h('[data-urnas-ir]')
  if (ir) {
    const [cd, zs, loc] = ir.dataset.urnasIr.split('|')
    const aba = abaDe(det.aba)
    const c = dadosDetalhe()?.candidatos.find((x) => x.sqcand === det.sqcand)
    location.hash = aba.hist
      ? hashDe('h2022', { ano: aba.ano, e: aba.el, m: cd, z: zs.split('-')[0], lv: loc, s: zs, f: c?.numero })
      : hashDe('bairros', { e: eleicaoDoCargo(aba.cargo), m: cd, z: zs.split('-')[0], lv: loc, s: zs, f: c?.numero })
    return true
  }
  return false
}

// posição de um local de votação de outro ano: os códigos mudam entre eleições, então liga pelo nome do
// local no cadastro de 2026 (dados2026/secoes/<cd>.json) às coordenadas de dados2026/locais-mapa.json
function coordsPorNome(C, cd, re) {
  const a26 = secoesAno(2026, cd, re)
  if (!a26) return null
  a26._porNome ??= new Map(Object.entries(a26.locais).filter(([k]) => C.valor[cd]?.[k]).map(([k, l]) => [semAcento(l[0] || ''), C.valor[cd][k]]))
  return a26._porNome
}
function secaoMapaFicha(det, c, aba) {
  if ((det.abr !== UF && !det.hist) || !aba?.cargo || DEMO) return ''
  const re = () => estado.detalhe === det && renderDetalhe()
  const C = coordsLocais(re)
  if (C.erro) return ''
  const F = fonteFicha(det, c, aba, re)
  const nr = F.nr
  const B = det.bai || {}
  const p22 = refFicha(c, aba, F)
  const A0 = p22?.el.ano || 2022
  let pts = null, semPos = 0
  if (C.valor && !B.mun) {
    const m22 = p22 ? munAno(p22.el.ano, p22.el.id) : null
    if (m22 && !m22.valor) m22.then(re).catch(() => {})
    if (F.mun && (!m22 || m22.valor)) {
      const meus = F.mun.meus, v22 = m22?.valor.cand[p22.c.sq] || null
      pts = Object.entries(C.valor._mun).map(([cd, [lat, lon]]) => {
        const v = meus[cd] || 0, a = v22 ? v22[cd] || 0 : null, va = variacao(v, a)
        return { lat, lon, tam: v, cor: COR_VAR[va?.cls || 'var-igual'], nome: NOME_MUN.get(cd), html: `<strong>${esc(NOME_MUN.get(cd) || cd)}</strong><br>${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, F.mun.validos[cd]))}%${a != null ? `<br>${A0}: ${fmt.format(a)}${va ? ` · <strong>${va.txt}</strong>` : ''}` : ''}` }
      }).filter((p) => p.tam > 0)
    }
  } else if (C.valor) {
    pts = []
    for (const cd of B.mun.cds) {
      const arq = secoesAno(F.ano, cd, re)
      if (!arq) continue
      const porNome = F.hist ? coordsPorNome(C, cd, re) : null
      if (F.hist && !porNome) continue
      const ag = agregarSecoes(arq, F.el, {}, 'local', nr)
      for (const g of ag.grupos) {
        const xy = F.hist ? porNome.get(semAcento(arq.locais[g.chave]?.[0] || '')) : C.valor[cd]?.[g.chave]
        if (!xy && g.foco) semPos++
        if (!xy || !g.foco) continue
        const pos = posicaoNoGrupo(g, nr)
        pts.push({ lat: xy[0], lon: xy[1], tam: g.foco, cor: corPartido(c.partido), nome: tituloLocal(arq.locais[g.chave]?.[0] || g.chave),
          html: `<strong>${esc(tituloLocal(arq.locais[g.chave]?.[0] || g.chave))}</strong><br>${esc(bairroDoLocal(arq, g.chave))}<br>${fmt.format(g.foco)} votos · ${fmtPct.format(pctDe(g.foco, g.validos))}%${pos ? ` · ${pos.p}º de ${pos.n}` : ''}` })
      }
    }
  }
  const id = `ficha-${det.sqcand}-${B.mun?.id || 'sc'}`
  if (pts) MAPAS.set(id, pts)
  const leg = !B.mun && p22
    ? `<div class="var-legenda"><span class="mudo">Tamanho = votos · cor = variação desde ${A0}:</span>${[['var-alta-forte', '▲ +20% ou mais'], ['var-alta', '▲ subiu'], ['var-queda', '▼ caiu'], ['var-queda-forte', '▼ −20% ou mais']].map(([k, t]) => `<span class="leg-ponto"><i style="background:${COR_VAR[k]}"></i>${t}</span>`).join('')}</div>`
    : '<p class="nota">Tamanho do círculo = votos.</p>'
  return `<section class="cartao"><h3>🗺️ Mapa de votos · ${esc(B.mun ? B.mun.nm : 'Santa Catarina')}</h3>
    ${pts ? `<div class="pro-mapa" data-mapa="${esc(id)}" role="region" aria-label="Mapa de votos"></div>${leg}<p class="nota">${B.mun ? 'Cada círculo é um local de votação.' : 'Cada círculo é um município (centro dos seus locais de votação).'}${semPos ? ` ${fmt.format(semPos)} locais de ${F.ano} não foram achados no cadastro de 2026 e ficam fora do mapa.` : ''} ${F.cdFixo ? '' : 'Para ver um município por local, escolha-o em "Onde foi mais votado". '}Toque num círculo para ver os números.</p>` : '<p class="nota">Carregando o mapa…</p>'}
  </section>`
}

/* ---------------- 👥 idade do eleitorado onde o candidato vota (área 🔒) ---------------- */

// Estimativa: cruza os votos do candidato em cada seção com o perfil etário do eleitorado da seção
// (TSE, perfil_eleitor_secao). Arquivos criptografados pro/idade-<ano>-<eleição>.bin (scripts/gerar_idade.py).
const FAIXA_CURTA = ['16–17', '18–24', '25–34', '35–44', '45–59', '60–69', '70+']
// eleitorado de cada seção por faixa etária (área 🔒): {cd: {'zona-seção': [7 faixas]}}
function idadeSecoes(ano, re) {
  if (!PRO.chave || DEMO) return null
  const A = arquivoPro(`idade-secoes-${ano}`)
  if (!A.valor) {
    if (!A.erro) A.then(re).catch(() => {})
    return null
  }
  return A.valor.s
}
// público de uma seção: faixa que predomina, % de jovens (16–24) e de idosos (60+)
function perfilSecao(I, cd, zs) {
  const v = I?.[cd]?.[zs]
  if (!v) return null
  const t = v.reduce((a, x) => a + x, 0) || 1
  const p = v.map((x) => x / t)
  const top = p.indexOf(Math.max(...p))
  return { p, top, j: p[0] + p[1], i: p[5] + p[6] }
}
const txtIdadeSecao = (q) =>
  q ? `<div class="cand-meta idade-sec">👥 predomina <strong>${FAIXA_CURTA[q.top]} anos</strong> (${fmtPct.format(100 * q.p[q.top])}%) · jovens 16–24: ${fmtPct.format(100 * q.j)}% · 60+: ${fmtPct.format(100 * q.i)}%</div>` : ''
const colsIdade = (q) => (q ? [`${FAIXA_CURTA[q.top]} anos`, 100 * q.j, 100 * q.i, ...q.p.map((x) => 100 * x)] : ['', '', '', '', '', '', '', '', '', ''])
const CAB_IDADE = ['Faixa que predomina', '% jovens 16–24', '% 60+', ...FAIXA_CURTA.map((f) => `% ${f}`)]

function dadosIdade(det, c, aba, re) {
  const ano = aba.hist ? aba.ano : 2026
  const el = aba.hist ? aba.el : eleicaoDoCargo(aba.cargo)
  const A = arquivoPro(`idade-${ano}-${el}`)
  if (!A.valor) {
    if (!A.erro) A.then(re).catch(re)
    return { ano, el, carregando: !A.erro, erro: A.erro }
  }
  const municipal = ehMunicipal(aba.cargo)
  const x = A.valor.c[municipal ? c.sqcand : String(Number(c.numero))]
  const base = A.valor.b[municipal ? c.cd || det.abr : 'sc']
  return { ano, el, x, base, faixas: A.valor.faixas, onde: municipal ? NOME_MUN.get(c.cd || det.abr) || '' : 'SC' }
}
function secaoIdade(det, c, aba) {
  if (DEMO || !aba?.cargo || (!det.hist && det.abr !== UF)) return ''
  const tit = '<h3>👥 Idade do eleitorado onde vota <span class="tag">🔒</span></h3>'
  if (!PRO.chave)
    return `<section class="cartao idade">${tit}<p class="nota">Estimativa da faixa etária dos eleitores das seções onde ${esc(c.nome)} teve votos (16 a 70+ anos), comparada com a média ${ehMunicipal(aba.cargo) ? 'da cidade' : 'de SC'}, e o desempenho nas seções mais jovens e mais idosas. Disponível na área protegida.</p>
      <button type="button" class="botao secundario" data-pro-abrir>🔒 Entrar na área protegida</button></section>`
  const re = () => estado.detalhe === det && renderDetalhe()
  const D = dadosIdade(det, c, aba, re)
  if (D.carregando || D.erro) return `<section class="cartao idade">${tit}<p class="nota">${D.erro ? 'O perfil etário desta eleição ainda não está no app.' : 'Carregando…'}</p></section>`
  if (!D.x || !D.base) return `<section class="cartao idade">${tit}<p class="nota">Poucos votos para estimar (mínimo de 30).</p></section>`
  const { x, base, onde } = D
  const cor = corPartido(c.partido)
  const idx = x.m.map((m, i) => (base[i] ? m / base[i] : 1))
  const max = Math.max(...x.m, ...base, 0.01)
  const melhor = idx.indexOf(Math.max(...idx)), pior = idx.indexOf(Math.min(...idx))
  const mediaQ = (q) => q.reduce((a, v) => a + v, 0) / 5
  const frases = [
    `Nas seções onde ${c.nome} teve votos, há proporcionalmente mais eleitores de ${D.faixas[melhor]} (${fmtPct.format(100 * x.m[melhor])}% × ${fmtPct.format(100 * base[melhor])}% na média ${onde === 'SC' ? 'de SC' : `de ${onde}`}, índice ${fmtDec(idx[melhor])}).`,
    `E menos eleitores de ${D.faixas[pior]} (${fmtPct.format(100 * x.m[pior])}% × ${fmtPct.format(100 * base[pior])}%, índice ${fmtDec(idx[pior])}).`,
    x.qj[4] >= x.qj[0]
      ? `Vai melhor nas seções mais jovens: ${fmtPct.format(x.qj[4])}% dos válidos nas 20% com mais jovens (16 a 24) contra ${fmtPct.format(x.qj[0])}% nas com menos.`
      : `Vai melhor nas seções com menos jovens: ${fmtPct.format(x.qj[0])}% dos válidos contra ${fmtPct.format(x.qj[4])}% nas 20% com mais jovens (16 a 24).`,
    x.qi[4] >= x.qi[0]
      ? `Nas 20% seções com mais idosos (60+), teve ${fmtPct.format(x.qi[4])}% dos válidos, contra ${fmtPct.format(x.qi[0])}% nas com menos.`
      : `Nas 20% seções com mais idosos (60+), teve só ${fmtPct.format(x.qi[4])}% dos válidos, contra ${fmtPct.format(x.qi[0])}% nas com menos.`,
  ]
  const linha = (i) => {
    const v = idx[i], cls = v >= 1.05 ? 'var-alta' : v <= 0.95 ? 'var-queda' : 'var-igual'
    return `<div class="idade-linha"><span class="idade-rot">${esc(FAIXA_CURTA[i])}</span>
      <div class="idade-barras"><span class="b-cand" style="width:${(100 * x.m[i]) / max}%;background:${cor}"></span><span class="b-base" style="width:${(100 * base[i]) / max}%"></span></div>
      <span class="idade-num"><strong>${fmtPct.format(100 * x.m[i])}%</strong> <small>média ${fmtPct.format(100 * base[i])}%</small></span><span class="var ${cls}">${v >= 1 ? '▲' : '▼'} ${fmtDec(v)}</span></div>`
  }
  const quintos = (q, rot) => {
    const mx = Math.max(...q, 0.01)
    return `<div class="perfil-graf"><div class="perfil-tit">${esc(rot)} <span class="mudo">· % dos válidos de ${esc(c.nome)} em cada quinto das seções de ${esc(onde)}</span></div>
      <div class="perfil-barras">${q.map((v) => `<div class="perfil-col"><span class="perfil-val">${fmtPct.format(v)}%</span><span class="perfil-barra" style="height:${Math.max(2, (100 * v) / mx)}%"></span></div>`).join('')}</div>
      <div class="perfil-eixo"><span>menos</span><span>mais →</span></div></div>`
  }
  const sub = `${c.partido} · nº ${c.numero} · ${aba.rotulo.replace(/ SC$/, '')}${ehMunicipal(aba.cargo) ? ` · ${onde}` : ''}`
  det.idade = {
    card: { chapeu: `${aba.hist ? `ELEIÇÕES ${aba.ano}` : 'APURAÇÃO 2026'} · IDADE DO ELEITORADO`, exclusivo: true, foto: c.foto, nome: c.nome, cor, sub, titulo: 'Idade do eleitorado onde vota', subtitulo: `Seções onde teve votos × média ${onde === 'SC' ? 'de SC' : `de ${onde}`}`, numerar: false,
      linhas: FAIXA_CURTA.map((f, i) => ({ nome: `${f} anos`, extra: `média ${fmtPct.format(100 * base[i])}%`, valor: `${fmtPct.format(100 * x.m[i])}%`, dir2: `${idx[i] >= 1 ? '▲' : '▼'} ${fmtDec(idx[i])}`, corDir2: idx[i] >= 1.05 ? '#0b7a45' : idx[i] <= 0.95 ? '#c62828' : null, barras: [{ frac: x.m[i] / max, cor }, { frac: base[i] / max, cor: '#9aa19d' }] })),
      rodape: 'Estimativa pelo perfil do eleitorado de cada seção (TSE) · o voto é secreto' },
    xlsx: { nome: `${nomeArquivo(c.nome)}-idade-${D.ano}-${D.el}.xlsx`, abas: [
      { aba: 'Faixas', cab: ['Faixa etária', '% nas seções onde votou', `% média ${onde}`, 'Índice'], linhas: D.faixas.map((f, i) => [f, 100 * x.m[i], 100 * base[i], idx[i]]) },
      { aba: 'Quintos', cab: ['Quinto das seções', '% dos válidos (jovens 16–24)', '% dos válidos (idosos 60+)'], linhas: [0, 1, 2, 3, 4].map((q) => [`${q + 1}º (${q === 0 ? 'menos' : q === 4 ? 'mais' : '…'})`, x.qj[q], x.qi[q]]) },
    ] },
  }
  return `<section class="cartao idade perfil" style="--cor-perfil:${cor}">${tit}
    <ul class="perfil-frases">${frases.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <div class="idade-leg"><span><i style="background:${cor}"></i>Seções onde ${esc(c.nome)} teve votos (pesado pelos votos dele)</span><span><i class="b-base"></i>Média ${esc(onde === 'SC' ? 'de SC' : `de ${onde}`)}</span></div>
    ${FAIXA_CURTA.map((_, i) => linha(i)).join('')}
    ${quintos(x.qj, 'Seções com mais jovens (16 a 24)')}
    ${quintos(x.qi, 'Seções com mais idosos (60+)')}
    <div class="exportar">${botaoCard('idade', det.idade.card)}<button type="button" class="botao secundario" data-idade-xlsx>${icone('baixar')} Excel</button></div>
    <p class="nota">Estimativa pelo perfil do eleitorado de cada seção (TSE, ${D.ano}) cruzado com os votos de ${esc(c.nome)} em cada seção (${fmtPct.format(mediaQ(x.qj))}% dos válidos em média). Não é o voto por idade — o voto é secreto. Índice = % da faixa nas seções dele ÷ média ${onde === 'SC' ? 'de SC' : 'da cidade'}.</p>
  </section>`
}

// mapa da comparação: cor de quem venceu em cada município ou local
function mapaComparacao(D, P, linhas) {
  if (D.grupo !== 'mun' && D.grupo !== 'local') return ''
  // locais de outros anos não têm coordenadas pelo código
  if (D.grupo === 'local' && P.some((p) => p.F?.hist)) return ''
  const C = coordsLocais(() => estado.detalhe && renderDetalhe())
  if (!C.valor) return ''
  const pts = linhas.map((x) => {
    const [cd, loc] = D.grupo === 'mun' ? [x.k, null] : x.k.split('|')
    const xy = loc ? C.valor[cd]?.[loc] : C.valor._mun[cd]
    if (!xy) return null
    const o = ordemNoLugar(x)
    const tam = x.v.reduce((a, v) => a + v, 0)
    return tam ? { lat: xy[0], lon: xy[1], tam, cor: P[o[0]].cor, html: `<strong>${esc(x.nome)}</strong>${x.sub ? `<br>${esc(x.sub)}` : ''}<br>${o.map((i, n) => `${n + 1}º ${esc(P[i].nome)}: ${fmt.format(x.v[i])}`).join('<br>')}` } : null
  }).filter(Boolean)
  const id = `comp-${D.grupo}-${D.mun?.id || 'sc'}-${P.map((p) => p.c.sqcand).join('-')}`
  MAPAS.set(id, pts)
  return `<div class="pro-mapa" data-mapa="${esc(id)}" role="region" aria-label="Mapa da comparação"></div>
    <div class="var-legenda"><span class="mudo">Cor de quem teve mais votos · tamanho = votos somados:</span>${P.map((p) => `<span class="leg-ponto"><i style="background:${p.cor}"></i>${esc(p.nome)}</span>`).join('')}</div>`
}

async function montarMapaAberto(div) {
  const pts = MAPAS.get(div.dataset.mapa)
  if (!pts) return
  let L
  try {
    L = await carregarLeaflet()
  } catch {
    div.innerHTML = '<p class="nota">Não consegui carregar o mapa agora.</p>'
    return
  }
  if (!document.body.contains(div)) return
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches
  const mapa = L.map(div, { zoomControl: true, attributionControl: true, preferCanvas: true, scrollWheelZoom: false })
  mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
  div.classList.toggle('mapa-escuro', escuro)
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa)
  let falhas = 0
  osm.on('tileerror', () => {
    if (++falhas !== 4) return
    mapa.removeLayer(osm)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Mapa &copy; Esri, HERE, Garmin, &copy; OpenStreetMap' }).addTo(mapa)
  })
  const max = Math.max(1, ...pts.map((p) => p.tam))
  const bounds = []
  for (const p of [...pts].sort((a, b) => b.tam - a.tam)) {
    L.circleMarker([p.lat, p.lon], { radius: Math.max(3, 24 * Math.sqrt(p.tam / max)), color: escuro ? '#1b1f1d' : '#ffffff', weight: 1.5, fillColor: p.cor, fillOpacity: 0.78 }).bindPopup(p.html).addTo(mapa)
    bounds.push([p.lat, p.lon])
  }
  if (bounds.length) mapa.fitBounds(bounds, { padding: [16, 16], maxZoom: 15 })
  else mapa.setView([-27.6, -50.5], 7)
}

/* ---------------- relatório em PDF (páginas A4 com os cards do app) ---------------- */

// prepara o cartão "Onde foi mais votado" num estado temporário e espera os arquivos carregarem
async function bairrosProntos(det, c, aba, grupo) {
  // prefeito e vereador (anos anteriores): sempre dentro da cidade
  const mun = det.hist && ehMunicipal(aba.cargo) ? lugarBairros(det.abr) : null
  const tmp = { aba: det.aba, abr: det.abr, sqcand: det.sqcand, hist: det.hist, bai: { mun, modo: 'v', todos: false, painel: false, busca: '', grupo } }
  for (let i = 0; i < 6; i++) {
    secaoBairros(tmp, c, aba)
    const pend = [...ARQ_ANO.values(), ...[...HIST.values()].flatMap((X) => [...X.mun.values()])].filter((p) => !p.valor && !p.erro)
    if (!pend.length) break
    await Promise.allSettled(pend)
  }
  return tmp.bai.export ? tmp.bai : null
}

// níveis do relatório e do Excel da ficha: [grupo, nome da aba, páginas no PDF]
const gruposExport = (det, aba) =>
  det.hist && ehMunicipal(aba.cargo)
    ? [['zona', 'Zonas', 4], ['bairro', 'Bairros', 4], ['local', 'Locais', 2], ['secao', 'Seções', 0]]
    : det.hist
      ? [['mun', 'Municípios', 3], ['assoc', 'Associações', 5]]
      : [['mun', 'Municípios', 3], ['assoc', 'Associações', 5], ['bairro', 'Bairros', 3]]

async function gerarRelatorio(botao) {
  const det = estado.detalhe
  const d = dadosDetalhe()
  const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
  const aba = abaDe(det.aba)
  if (!c) return
  const cards = [CARDS.get('ficha-resumo'), det.analise?.card].filter(Boolean)
  if ((det.abr === UF || det.hist) && aba?.cargo && !DEMO) {
    if (botao) (botao.disabled = true), (botao.innerHTML = '⏳ Juntando os dados…')
    for (const [grupo, max] of gruposExport(det, aba).map(([g, , max]) => [g, max])) {
      const B = await bairrosProntos(det, c, aba, grupo).catch(() => null)
      if (B) cards.push(...B.carrossel().slice(0, max))
    }
    if (botao) botao.disabled = false
    // o estado temporário regravou os cards do cartão de bairros; redesenha a ficha para restaurar
    renderDetalhe()
    botao = detalheEl.querySelector('[data-relatorio]') || botao
  }
  return gerarPDF(cards, c.nome, botao)
}

/* ---------------- planilha Excel (.xlsx), com SheetJS carregado só na hora ---------------- */

// ficha: uma aba para municípios, associações e bairros de SC (e o lugar escolhido, se houver)
async function excelFicha(botao) {
  const det = estado.detalhe
  const d = dadosDetalhe()
  const c = d?.candidatos.find((x) => x.sqcand === det.sqcand)
  const aba = abaDe(det.aba)
  if (!c) return
  const abas = []
  const naCidade = det.hist && ehMunicipal(aba?.cargo)
  if (det.bai?.mun && det.bai.export && !naCidade) abas.push({ aba: `${det.bai.mun.nm}`, ...det.bai.export.csv })
  if ((det.abr === UF || det.hist) && aba?.cargo) {
    if (botao) (botao.disabled = true), (botao.innerHTML = '⏳ Juntando os dados…')
    for (const [g, rot] of gruposExport(det, aba)) {
      const B = await bairrosProntos(det, c, aba, g).catch(() => null)
      if (B?.export) abas.push({ aba: rot, ...B.export.csv })
    }
    renderDetalhe()
    botao = detalheEl.querySelector('[data-bai-xlsx]') || botao
  }
  return baixarExcel(`${nomeArquivo(c.nome)}-votos.xlsx`, abas, botao)
}

// comparação: em SC, uma aba por nível (municípios, associações, regiões); num lugar, a tabela da tela
function excelComparacao(det, botao) {
  const D = det.comp.dif
  const abas = []
  if (D.mun) abas.push({ aba: `${D.mun.nm}`, ...D.export.csv })
  else
    for (const [g, rot] of [['mun', 'Municípios'], ['assoc', 'Associações'], ['meso', 'Regiões']]) {
      const tmp = { ...det, comp: { ...det.comp, dif: { ...D, grupo: g, modo: 'v', todos: true } } }
      secaoCompDiferenca(tmp, D.lista)
      if (tmp.comp.dif.export) abas.push({ aba: rot, ...tmp.comp.dif.export.csv })
    }
  renderDetalhe()
  return baixarExcel(`${D.lista.map((x) => nomeArquivo(x.c.nome)).join('-x-')}.xlsx`, abas, detalheEl.querySelector('[data-cd-xlsx]') || botao)
}

// soma dos municípios de cada associação (FECAM), por arquivo de votos por município
const ASSOC_CACHE = new WeakMap()
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
  const re = () => estado.detalhe === det && renderDetalhe()
  const F = fonteFicha(det, c, aba, re)
  const elId = F.elId
  const B = (det.bai ??= { mun: F.cdFixo ? lugarBairros(F.cdFixo) : det.mun ? lugarBairros(det.mun.regiao || det.mun.cd) : null, modo: 'v', todos: false, painel: false, busca: '', grupo: F.cdFixo ? 'zona' : F.hist ? 'mun' : 'bairro' })
  const nr = F.nr
  const cor = corPartido(c.partido)
  const p22 = refFicha(c, aba, F)
  // anos da comparação: a participação anterior × esta eleição
  const A0 = p22?.el.ano || 2022, A1 = F.ano
  const rotCargo = `${aba.rotulo.replace(/ SC$/, '')}${F.cdFixo ? ` · ${NOME_MUN.get(F.cdFixo) || ''}` : ''}`
  const chapeuH = F.hist ? { chapeu: `${F.chapeu} · ${(B.mun ? B.mun.nm : 'Santa Catarina').toUpperCase()}` } : {}
  // níveis: em SC, municípios ou bairros; num município ou região, zonas, bairros, locais ou seções
  const niveis = B.mun ? [['zona', 'Zonas'], ['bairro', 'Bairros'], ['local', 'Locais'], ['secao', 'Seções']] : [['mun', 'Municípios'], ['assoc', 'Associações'], ...(F.hist ? [] : [['bairro', 'Bairros']])]
  if (!niveis.some(([k]) => k === B.grupo)) B.grupo = niveis.some(([k]) => k === 'bairro') ? 'bairro' : niveis[0][0]
  const nomeNivel = Object.fromEntries(niveis)[B.grupo]
  const naNivel = { mun: 'no município', assoc: 'na associação', zona: 'na zona', bairro: 'no bairro', local: 'no local', secao: 'na seção' }[B.grupo]
  const r = dadosBairrosFicha(B, elId, aba, nr, p22, re, F)
  const tem22 = !!r.com22
  if (!tem22 && (B.modo === 'up' || B.modo === 'dn')) B.modo = 'v'
  const modos = [['v', 'Mais votos'], ['p', 'Maior %'], ...(tem22 ? [['up', '▲ Mais cresceu'], ['dn', '▼ Mais caiu']] : [])]
  const lugar = B.mun ? B.mun.nm : 'Santa Catarina'
  const controles = `${F.cdFixo ? '' : escolhaLugarBairros(B)}
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
    // urnas (seções) de um recorte, já com o voto do candidato
    const listaUrnasRecorte = (lista, total, onde, mostrarBairro, rotulo, chave) => {
      const ordU = B.ordUrnas || 'v'
      // 🔒 público de cada seção (faixa etária que predomina)
      const I = idadeSecoes(F.ano, re)
      if (I) for (const u of lista) u.ida ??= perfilSecao(I, u.cd, u.zs)
      const us = [...lista].sort(ordU === 's' ? (a, b) => a.s - b.s : ordU === 'p' ? (a, b) => b.v / b.val - a.v / a.val || b.v - a.v : ordU === 'j' && I ? (a, b) => (b.ida?.j || 0) - (a.ida?.j || 0) : ordU === 'i' && I ? (a, b) => (b.ida?.i || 0) - (a.ida?.i || 0) : (a, b) => b.v - a.v)
      // compartilhar: imagem com as urnas mais votadas e carrossel com todas
      const somaU = us.reduce((a, u) => a + u.v, 0)
      const primeiros = us.filter((u) => u.pos?.p === 1).length
      const maxU = Math.max(1, ...us.map((u) => u.v))
      const linhaU = (u) => ({ nome: u.nome, extra: `${mostrarBairro ? `${u.local} · ${u.bairro}` : u.local}${u.ida ? ` · 👥 ${FAIXA_CURTA[u.ida.top]}` : ''}`, valor: fmt.format(u.v), dir2: `${fmtPct.format(pctDe(u.v, u.val))}% · ${u.pos ? `${u.pos.p}º de ${u.pos.n}` : ''}`, frac: u.v / maxU, corBarra: cor })
      const baseU = { ...chapeuH, turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotCargo}`, chapeu: `${F.hist ? `${F.chapeu} · ` : ''}URNA POR URNA · ${lugar.toUpperCase()}`,
        titulo: `Urnas · ${rotulo}`, subtitulo: `${fmt.format(us.length)} urnas com voto${primeiros ? ` · 1º lugar em ${fmt.format(primeiros)}` : ''}`,
        total: { rot: `Votos · ${rotulo}`, quem: c.nome, valor: `${fmt.format(somaU)} votos`, sub: `em ${fmt.format(us.length)} de ${fmt.format(total)} urnas` } }
      const POR = 8
      const paginas = Math.ceil(us.length / POR)
      URNAS_CAR.set(chave, () => Array.from({ length: paginas }, (_, k) => ({ ...baseU, linhas: us.slice(k * POR, (k + 1) * POR).map(linhaU) })))
      const compartilhar = us.length
        ? `<div class="exportar">${botaoCard(`urnas-${chave}`, { ...baseU, linhas: us.slice(0, POR).map(linhaU) }, `${icone('compartilhar')} Compartilhar estas urnas`, 'botao secundario')}${paginas > 1 ? botoesPartes(chave, paginas, 'botao secundario') : ''}${paginas > 1 ? `<button type="button" class="botao secundario" data-urnas-pdf="${esc(chave)}">${icone('pdf')} PDF com todas (${paginas} páginas)</button>` : ''}</div>`
        : ''
      return `<div class="zona-urnas"><p class="nota"><strong>${fmt.format(us.length)}</strong> urnas com voto de ${fmt.format(total)} ${onde} · <strong>${fmt.format(us.reduce((a, u) => a + u.v, 0))}</strong> votos</p>
          <div class="segmentado" role="group" aria-label="Ordenar urnas"><button type="button" data-bai-urnas-ord="v" aria-pressed="${ordU === 'v'}">Mais votos</button><button type="button" data-bai-urnas-ord="p" aria-pressed="${ordU === 'p'}">Maior %</button><button type="button" data-bai-urnas-ord="s" aria-pressed="${ordU === 's'}">Nº da seção</button>${I ? `<button type="button" data-bai-urnas-ord="j" aria-pressed="${ordU === 'j'}">👥 Mais jovens</button><button type="button" data-bai-urnas-ord="i" aria-pressed="${ordU === 'i'}">👥 Mais idosos</button>` : ''}</div>
          ${us.length ? `<table class="tabela urnas-tab"><tbody>${us.map((u) => `<tr class="clicavel" ${u.ir}><td><strong>${esc(u.nome)}</strong><div class="cand-meta">${esc(u.local)}${mostrarBairro ? ` · ${esc(u.bairro)}` : ''}</div>${txtIdadeSecao(u.ida)}</td><td class="dir"><strong>${fmt.format(u.v)}</strong><div class="cand-meta">${fmtPct.format(pctDe(u.v, u.val))}% · ${u.pos ? `${u.pos.p === 1 ? '🏆 ' : ''}${u.pos.p}º de ${u.pos.n}` : ''}</div></td></tr>`).join('')}</tbody></table>` : `<p class="nota">Sem votos nas urnas ${onde}.</p>`}
          ${compartilhar}</div>`
    }
    // botão + urnas de um bairro dentro da zona
    const blocoUrnasBairro = (f) => {
      const aberto = !!f.urnas
      return `<button type="button" class="link-zonas leve bairro-urnas-bt" data-bai-bairro-urnas="${esc(f.chaveB)}" aria-expanded="${aberto}">🗳️ ${aberto ? 'Esconder as urnas' : 'Ver as urnas deste bairro'} <span class="seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span></button>${aberto ? listaUrnasRecorte(f.urnas, f.urnasTotal, 'no bairro', false, `${f.zonaNome} › ${f.nome}`, f.chaveB) : ''}`
    }
    // bairros de uma zona (sublista)
    const blocoZona = (l) => {
      if (!l.zonaKey) return ''
      const aberta = !!l.filhos
      const urnasAbertas = !!l.urnas
      const blocoUrnas = urnasAbertas ? listaUrnasRecorte(l.urnas, l.urnasTotal, 'na zona', true, l.nome.replace(/ · .*/, ''), l.zonaKey) : ''
      // carrossel: capa com os bairros da zona e, depois, cada bairro com as suas seções
      const zonaRot = l.nome.replace(/ · .*/, '')
      // resumo: capa + 1 imagem por bairro (as 8 urnas mais votadas), cabendo num post de até 20 imagens
      const montarZB = (resumo) => {
        const bs = l.urnasPorBairro()
        const ordU = B.ordUrnas || 'v'
        const ordena = (a, b) => (ordU === 's' ? a.s - b.s : ordU === 'p' ? b.v / b.val - a.v / a.val || b.v - a.v : b.v - a.v)
        const base = { turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotCargo}`, chapeu: `${F.hist ? `${F.chapeu} · ` : ''}URNA POR URNA · ${lugar.toUpperCase()}` }
        const somaZ = bs.reduce((a, b) => a + b.v, 0)
        const nUrnas = bs.reduce((a, b) => a + b.urnas.length, 0)
        const maxB = Math.max(1, ...bs.map((b) => b.v))
        const POR = 8
        // capa: todos os bairros da zona (8 por imagem), depois as seções de cada bairro
        const paginas = []
        // no resumo, uma capa só (os 8 bairros com mais votos); no completo, todos os bairros
        for (let i = 0; i < (resumo ? Math.min(POR, bs.length) : bs.length); i += POR)
          paginas.push({ ...base, numerar: false, titulo: `Urnas por bairro · ${zonaRot}`, subtitulo: `${fmt.format(bs.length)} bairros · ${fmt.format(nUrnas)} urnas com voto${resumo && bs.length > POR ? ` · os ${POR} com mais votos` : bs.length > POR ? ` · bairros ${i + 1} a ${Math.min(bs.length, i + POR)}` : ''}`, total: { rot: `Votos · ${zonaRot}`, quem: c.nome, valor: `${fmt.format(somaZ)} votos`, sub: `em ${fmt.format(nUrnas)} urnas` },
            linhas: bs.slice(i, i + POR).map((b, j) => ({ nome: `${i + j + 1}º ${b.bairro}`, extra: `${b.urnas.length} de ${b.total} urnas com voto`, valor: fmt.format(b.v), dir2: `${fmtPct.format(pctDe(b.v, somaZ || 1))}% da zona`, frac: b.v / maxB, corBarra: cor })) })
        for (const b of bs) {
          if (resumo && paginas.length >= 20) break
          const us = [...b.urnas].sort(resumo ? (x, y) => y.v - x.v : ordena)
          const maxU = Math.max(1, ...us.map((u) => u.v))
          for (let i = 0; i < (resumo ? Math.min(us.length, POR) : us.length); i += POR)
            paginas.push({ ...base, titulo: `${zonaRot} › ${b.bairro}`, subtitulo: resumo ? `${us.length > POR ? `as ${POR} mais votadas de ` : ''}${us.length} urnas com voto no bairro` : `${us.length} urnas com voto de ${b.total} no bairro${us.length > POR ? ` · parte ${i / POR + 1} de ${Math.ceil(us.length / POR)}` : ''}`,
              total: { rot: `Votos · ${b.bairro}`, quem: c.nome, valor: `${fmt.format(b.v)} votos`, sub: `em ${fmt.format(us.length)} urnas` },
              linhas: us.slice(i, i + POR).map((u) => ({ nome: u.nome, extra: u.local, valor: fmt.format(u.v), dir2: `${fmtPct.format(pctDe(u.v, u.val))}% · ${u.pos ? `${u.pos.p}º de ${u.pos.n}` : ''}`, frac: u.v / maxU, corBarra: cor })) })
        }
        return paginas
      }
      URNAS_CAR.set(`zb|${l.zonaKey}`, () => montarZB(false))
      URNAS_CAR.set(`zbr|${l.zonaKey}`, () => montarZB(true))
      const btU = `<button type="button" class="link-zonas zona-bairros-bt" data-bai-zona-urnas="${esc(l.zonaKey)}" aria-expanded="${urnasAbertas}">🗳️ ${urnasAbertas ? 'Esconder as urnas desta zona' : 'Ver as urnas desta zona'} <span class="seta" aria-hidden="true">${urnasAbertas ? '▴' : '▾'}</span></button>${(() => {
        // quantas imagens: capa (8 bairros por imagem) + seções de cada bairro (8 por imagem)
        const bs = l.urnasPorBairro()
        const n = Math.ceil(bs.length / 8) + bs.reduce((a, b) => a + Math.ceil(b.urnas.length / 8), 0)
        if (!bs.length) return ''
        const nRes = Math.min(20, 1 + bs.length)
        return `<div class="urnas-comp"><span class="atalhos-rot">📤 Urnas da zona por bairro</span>${botoesPartes(`zb|${l.zonaKey}`, n)}${n > 20 ? `<button type="button" class="link-zonas zona-bairros-bt" data-urnas-car="zbr|${esc(l.zonaKey)}">${icone('carrossel')} Carrossel resumido (${nRes} imagens: as urnas mais votadas de cada bairro)</button>` : ''}<button type="button" class="link-zonas zona-bairros-bt" data-urnas-pdf="zb|${esc(l.zonaKey)}">${icone('pdf')} PDF completo (${n} páginas)</button></div>`
      })()}`
      const bt = `<button type="button" class="link-zonas zona-bairros-bt" data-bai-zona="${esc(l.zonaKey)}" aria-expanded="${aberta}">🏘️ ${aberta ? 'Esconder os bairros desta zona' : 'Ver os bairros desta zona'} <span class="seta" aria-hidden="true">${aberta ? '▴' : '▾'}</span></button>${btU}${blocoUrnas}`
      if (!aberta) return bt
      const fs = l.filhos.filter((f) => f.v > 0 || (tem22 && f.v22 > 0))
      const metaF = (f) => [f.pos ? `${f.pos.p === 1 ? '🏆 ' : ''}${f.pos.p}º de ${f.pos.n} no bairro` : '', `${fmtPct.format(pctDe(f.v, f.val))}% dos votos do bairro`].filter(Boolean).join(' · ')
      return `${bt}<div class="zona-bairros">${fs.length
        ? tem22
          ? listaComparada(fs.map((f) => ({ nome: f.nome, v: f.v, v22: f.v22, meta: metaF(f), ir: f.ir, extra: f.v > 0 ? blocoUrnasBairro(f) : '' })), cor, [A0, A1])
          : `<div class="cmp-lista">${fs.map((f) => `<div class="cmp-linha clicavel" ${f.ir}><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(f.nome)}</strong></div><strong class="cmp-total">${fmt.format(f.v)}</strong></div><div class="cand-meta">${metaF(f)}</div>${f.v > 0 ? blocoUrnasBairro(f) : ''}</div>`).join('')}</div>`
        : '<p class="nota">Sem votos nos bairros desta zona.</p>'}</div>`
    }
    const metaDe = (l) => [l.pos ? `${l.pos.p === 1 ? '🏆 ' : ''}${l.pos.p}º de ${l.pos.n} ${naNivel}` : '', `${fmtPct.format(pctDe(l.v, l.val))}% dos votos ${B.grupo === 'mun' ? 'do município' : B.grupo === 'assoc' ? 'da associação' : B.grupo === 'secao' ? 'da seção' : B.grupo === 'local' ? 'do local' : B.grupo === 'zona' ? 'da zona' : 'do bairro'}`].filter(Boolean).join(' · ')
    // o resumo conta todos os lugares (no índice de SC, vem pronto do estado inteiro)
    const [sobe, cai] = r.sobeCai || [ls.filter((l) => l.v > l.v22).length, ls.filter((l) => l.v < l.v22).length]
    const rotOrdem = { v: 'mais votos', p: 'maior %', up: `onde mais cresceu desde ${A0}`, dn: `onde mais caiu desde ${A0}` }[B.modo]
    const lista = vis.slice(0, lim)
    corpo = (r.aviso ? `<p class="nota">${r.aviso}</p>` : '') +
      (B.grupo === 'zona' && lista.length ? `<button type="button" class="link-zonas" data-bai-zonas-todas aria-expanded="${!!B.zonasTodas}">🏘️ ${B.zonasTodas ? 'Fechar os bairros de todas as zonas' : 'Ver os bairros de todas as zonas'} <span class="seta" aria-hidden="true">${B.zonasTodas ? '▴' : '▾'}</span></button>` : '') +
      (tem22 ? `<p class="var-resumo">Desde ${A0} (${esc(ROTULO_ELEICAO[p22?.el.id || r.e22] || '')}): <span class="var var-alta-forte">▲ cresceu em ${fmt.format(sobe)} ${esc(nomeNivel.toLowerCase())}</span> <span class="var var-queda-forte">▼ caiu em ${fmt.format(cai)}</span></p>` + legendaVar(cor) : '') +
      (!lista.length
        ? `<p class="nota">${B.modo === 'up' ? 'Não cresceu em nenhum lugar' : B.modo === 'dn' ? 'Não caiu em nenhum lugar' : 'Sem votos'} em ${esc(lugar)}.</p>`
        : tem22
          ? listaComparada(lista.map((l) => ({ nome: l.nome, sub: l.sub, v: l.v, v22: l.v22, meta: metaDe(l), ir: l.ir, extra: blocoZona(l) })), cor, [A0, A1])
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
    const totalFicha = tv == null ? null : { ...totalCard(B.mun ? somaDe[0].toUpperCase() + somaDe.slice(1) : 'Santa Catarina inteira', tv, tv22, 'votos', A0), quem: c.nome }
    // carrossel: capa + todas as linhas (na visão por zona, os bairros de cada zona), 6 por imagem
    const POR = 6
    const linhaCar = (x, max) => ({ nome: x.nome, extra: [x.sub, x.pos ? `${x.pos.p}º de ${x.pos.n}` : ''].filter(Boolean).join(' · '), corBarra: cor,
      ...(tem22 ? { par: { v22: x.v22, v26: x.v, max }, dir2: variacao(x.v, x.v22)?.txt || '', corDir2: COR_VAR[variacao(x.v, x.v22)?.cls] } : { valor: fmt.format(x.v), dir2: `${fmtPct.format(pctDe(x.v, x.val))}%`, frac: x.v / max }) })
    const baseCar = { ...chapeuH, turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotCargo}` }
    const montarCarrossel = () => {
      let grupos
      if (B.grupo === 'zona') {
        const rz = dadosBairrosFicha({ ...B, zonasTodas: true }, elId, aba, nr, p22, () => {}, F)
        grupos = (rz.linhas || []).filter(naComp).sort((a, b) => b.v - a.v).map((z) => ({ titulo: z.nome, sub: z.sub, z, itens: (z.filhos || []).filter((f) => f.v > 0 || (tem22 && f.v22 > 0)) }))
      } else grupos = [{ titulo: tit, itens: visComp }]
      // em SC por bairro a lista é só um recorte: vale o total do candidato no estado
      const total26 = !B.mun && tv != null ? tv : ls.reduce((a, l) => a + l.v, 0)
      const total22 = !B.mun && tv22 != null ? tv22 : ls.reduce((a, l) => a + l.v22, 0)
      const vaT = tem22 ? variacao(total26, total22) : null
      const capa = { ...baseCar, total: totalFicha, titulo: `${B.grupo === 'zona' ? 'Zonas e bairros' : nomeNivel} · ${lugar}`, subtitulo: tem22 ? `${A0} × ${A1} · ${grupos.reduce((a, g) => a + g.itens.length, 0)} ${B.grupo === 'zona' ? 'bairros' : nomeNivel.toLowerCase()}` : rotOrdem,
        tiles: [{ rot: `Votos em ${lugar}`, valor: fmt.format(total26), sub: tem22 ? `${A0}: ${fmt.format(total22)} · ${vaT?.txt || ''}` : '', corSub: vaT ? COR_VAR[vaT.cls] : null },
          ...(B.grupo === 'zona' ? grupos.slice(0, 5).map((g) => { const va = tem22 ? variacao(g.z.v, g.z.v22) : null; return { rot: g.titulo, valor: fmt.format(g.z.v), sub: [g.z.pos ? `${g.z.pos.p}º na zona` : '', va?.txt].filter(Boolean).join(' · '), corSub: va ? COR_VAR[va.cls] : null } }) : [])],
        linhas: B.grupo === 'zona' ? [] : vis.slice(0, 3).map((x) => linhaCar(x, Math.max(1, ...vis.slice(0, 3).map((y) => Math.max(y.v, y.v22 || 0))))),
        rodape: tem22 ? `Desde ${A0}: cresceu em ${fmt.format(sobe)} e caiu em ${fmt.format(cai)} ${nomeNivel.toLowerCase()}` : '' }
      const paginas = [capa]
      for (const g of grupos) {
        const max = Math.max(1, ...g.itens.map((x) => Math.max(x.v, tem22 ? x.v22 : 0)))
        const nPag = Math.max(1, Math.ceil(g.itens.length / POR))
        for (let k = 0; k < nPag && paginas.length < 20; k++) {
          paginas.push({ ...baseCar, total: g.z ? totalCard(`Total na ${g.titulo.replace(/ · .*/, '')}`, g.z.v, tem22 ? g.z.v22 : null, 'votos', A0) : totalFicha, titulo: g.titulo, subtitulo: `${B.grupo === 'zona' ? 'Bairros da zona' : rotOrdem}${nPag > 1 ? ` · parte ${k + 1} de ${nPag}` : ''}${tem22 ? ` · ${A0} × ${A1}` : ''}`, numerar: false,
            linhas: g.itens.slice(k * POR, (k + 1) * POR).map((x) => linhaCar(x, max)) })
        }
      }
      return paginas
    }
    B.carrossel = montarCarrossel
    B.export = {
      csv: { nome: `${nomeArquivo(c.nome)}-${nomeArquivo(nomeNivel)}-${nomeArquivo(lugar)}.csv`, cab: [{ Municípios: 'Município', Associações: 'Associação', Bairros: 'Bairro', Zonas: 'Zona', Locais: 'Local', Seções: 'Seção' }[nomeNivel] || nomeNivel, 'Onde', `Votos ${A1}`, '% do lugar', 'Posição', ...(tem22 ? [`Votos ${A0}`, 'Diferença'] : [])],
        linhas: visComp.flatMap((l) => [[l.nome, l.sub || '', l.v, pctDe(l.v, l.val), l.pos ? `${l.pos.p}º de ${l.pos.n}` : '', ...(tem22 ? [l.v22, l.v - l.v22] : [])],
          ...(l.filhos || []).flatMap((f) => [[`${l.nome} › ${f.nome}`, l.sub || '', f.v, pctDe(f.v, f.val), f.pos ? `${f.pos.p}º de ${f.pos.n}` : '', ...(tem22 ? [f.v22, f.v - f.v22] : [])],
            ...(f.urnas || []).map((u) => [`${l.nome} › ${f.nome} › ${u.nome}`, u.local, u.v, pctDe(u.v, u.val), u.pos ? `${u.pos.p}º de ${u.pos.n}` : '', ...(tem22 ? ['', ''] : [])])]),
          ...(l.urnas || []).map((u) => [`${l.nome} › ${u.nome}`, `${u.local} · ${u.bairro}`, u.v, pctDe(u.v, u.val), u.pos ? `${u.pos.p}º de ${u.pos.n}` : '', ...(tem22 ? ['', ''] : [])])]) },
      card: { ...chapeuH, turno: turnoDe(elId), foto: c.foto, nome: c.nome, cor, sub: `${c.partido} · nº ${c.numero} · ${rotCargo}`, titulo: tit, subtitulo: rotOrdem, total: totalFicha,
        linhas: linhasBairroCard(visComp.map((l) => ({ nome: l.nome, v: l.v, pct: pctDe(l.v, l.val), v22: tem22 ? l.v22 : null, va: tem22 ? variacao(l.v, l.v22) : null, extra: [l.sub, l.pos ? `${l.pos.p}º de ${l.pos.n}` : ''].filter(Boolean).join(' · ') }))),
        rodape: tem22 ? `Desde ${A0}: cresceu em ${fmt.format(sobe)} e caiu em ${fmt.format(cai)} ${nomeNivel.toLowerCase()}` : '' },
      paginas: Math.min(20, 1 + Math.ceil(visComp.length / POR)),
      legenda: legendaShare(`${c.nome} · ${tit}`),
      zonas: B.grupo === 'zona' ? vis.filter((l) => l.zonaKey).map((l) => ({ k: l.zonaKey, nome: l.nome.replace(/ · .*/, ''), dentro: !B.zonasFora.has(l.zonaKey) })) : null,
    }
  }
  return `<section class="cartao bai"><h3>🏘️ Onde foi mais votado</h3>${controles}${corpo}
    ${B.export?.zonas?.length > 1 ? `<div class="zonas-comp"><span class="atalhos-rot">📤 Zonas no compartilhamento</span><div class="atalhos-chips">${B.export.zonas
      .map((z) => `<button type="button" class="atalho ${z.dentro ? 'ativo' : ''}" data-bai-zona-comp="${esc(z.k)}" aria-pressed="${z.dentro}">${z.dentro ? '✓ ' : ''}${esc(z.nome)}</button>`)
      .join('')}</div>${B.export.zonas.every((z) => !z.dentro) ? '<p class="nota">Marque ao menos uma zona.</p>' : ''}</div>` : ''}
    ${B.export ? `<div class="exportar">${botaoCard('ficha-bairros', B.export.card)}<button type="button" class="botao" data-bai-carrossel>${icone('carrossel')} ${B.grupo === 'zona' ? 'Carrossel: zonas e todos os bairros' : `Carrossel com todos (${B.export.paginas} imagens)`}</button><button type="button" class="botao secundario" data-bai-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-bai-xlsx>${icone('baixar')} Excel</button><button type="button" class="botao secundario" data-bai-legenda>${icone('copiar')} Copiar legenda com o link do Instagram</button></div>` : ''}
    ${F.hist ? '' : '<button type="button" class="botao secundario pro-atalho" data-pro-abrir>🔒 Mapa, perfil do eleitor e abstenção</button>'}
    <p class="nota">${F.hist
      ? `Fonte: TSE, votação por seção eleitoral (${F.ano}, ${turnoDe(elId)}º turno) e cadastro de locais de votação.${p22 ? ` ${A0} ligado pelo nome completo do candidato.` : ''} Toque numa linha para abrir no 📅 Histórico.`
      : `Fonte: boletins de urna do ${turnoDe(elId)}º turno (TSE) e cadastro de locais de votação. 2022 ligado pelo nome completo do candidato. Toque numa linha para abrir na aba Bairros.`}</p></section>`
}

// linhas do cartão "Onde foi mais votado" para o nível escolhido: { linhas: [{ nome, sub, v, val, v22, pos, ir }], com22, nota, aviso } ou { msg }
function dadosBairrosFicha(B, elId, aba, nr, p22, re, F) {
  const cargo = aba.cargo
  const ano = F.ano, A0 = p22?.el.ano || 2022
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
    if (!F.mun) return { msg: F.erro ? 'Os votos por município ainda não estão no app.' : 'Carregando os municípios…' }
    const M = { valor: { validos: F.mun.validos, c: F.mun.todos } }
    const meus = F.mun.meus
    let v22de = null
    if (p22) {
      const m22 = munAno(p22.el.ano, p22.el.id)
      if (!m22.valor) m22.then(re).catch(() => {})
      else v22de = m22.valor.cand[p22.c.sq] || {}
    }
    if (B.grupo === 'assoc') {
      // soma dos municípios de cada associação (FECAM); posição contra a soma de cada candidato
      if (!ASSOC_CACHE.has(F.mun.todos)) {
        const val = {}, cand = {}
        for (const [cd, v] of Object.entries(M.valor.validos)) { const sg = ASSOCIACAO_MUN[cd]; if (sg) val[sg] = (val[sg] || 0) + v }
        for (const [n, por] of Object.entries(M.valor.c)) {
          const t = cand[n] = {}
          for (const [cd, v] of Object.entries(por)) { const sg = ASSOCIACAO_MUN[cd]; if (sg) t[sg] = (t[sg] || 0) + v }
        }
        ASSOC_CACHE.set(F.mun.todos, { val, cand })
      }
      const A = ASSOC_CACHE.get(F.mun.todos)
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
      return { totalSC: Object.values(meusA).reduce((a, v) => a + v, 0), com22: !!v22de, linhas, aviso: p22 && !v22de && PREF.mostrar2022 ? `Carregando ${A0}…` : '', nota: `Associações de municípios da FECAM (soma dos municípios de cada uma). Votou em ${fmt.format(linhas.filter((l) => l.v).length)} de ${Object.keys(ASSOCIACOES).length}. Toque numa associação para ver as zonas e bairros dela.` }
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
    return { totalSC: Object.values(meus).reduce((a, v) => a + v, 0), com22: !!v22de, linhas, aviso: p22 && !v22de && PREF.mostrar2022 ? `Carregando ${A0}…` : '', nota: `Votou em ${fmt.format(linhas.filter((l) => l.v).length)} de ${MUNICIPIOS_SC.length} municípios. Toque num município para ver os bairros dele.` }
  }
  // município ou região: zonas, bairros, locais ou seções (arquivos de seções de cada cidade)
  const cds = B.mun.cds
  const regiao = cds.length > 1
  const arqs = cds.map((cd) => [cd, secoesAno(ano, cd, re)])
  const prontos = arqs.filter(([, a]) => a)
  const faltam = arqs.filter(([cd, a]) => !a && !erroSecoes(ano, cd)).length
  if (!prontos.length) return { msg: faltam ? `Carregando as seções de ${esc(B.mun.nm)}…` : 'Os boletins deste lugar ainda não estão no app.' }
  // 2022 só por zona e bairro (os códigos de locais e seções mudam entre eleições) e só com todos os arquivos
  // (nos cargos municipais, só na mesma cidade: o número do candidato se repete entre cidades)
  const usa22 = !!p22 && (B.grupo === 'zona' || B.grupo === 'bairro') && (!ehMunicipal(p22.el.cargo) || cds.every((cd) => cd === p22.c.cd))
  const faltam22 = usa22 ? cds.filter((cd) => !secoesAno(A0, cd, re) && !erroSecoes(A0, cd)).length : 0
  const com22 = usa22 && !faltam22
  const linhas = []
  // seções (urnas) com voto do candidato num recorte (zona; zona + bairro)
  const urnasDe = (arq, cd, filtro) => {
    const gs = agregarSecoes(arq, F.el, filtro, 'secao', nr)
    const urnas = gs.grupos
      .filter((x) => x.foco > 0)
      .map((x) => {
        const loc = arq.secoes[x.chave]
        return { cd, zs: x.chave, s: Number(x.chave.split('-')[1]), nome: `Seção ${x.chave.split('-')[1]}`, local: tituloLocal((arq.locais[loc] || [''])[0]), bairro: bairroDoLocal(arq, loc), v: x.foco, val: x.validos, pos: posicaoNoGrupo(x, nr), ir: `data-bai-ir="${esc(cd)}" data-bai-tipo="secao" data-bai-chave="${esc(x.chave)}"` }
      })
    return { urnas, urnasTotal: gs.grupos.length }
  }
  for (const [cd, arq] of prontos) {
    const ag = agregarSecoes(arq, F.el, {}, B.grupo, nr)
    let m22 = null
    if (com22) {
      const a22 = secoesAno(A0, cd, re)
      if (a22) m22 = new Map(agregarSecoes(a22, p22.el, {}, B.grupo, nr22).grupos.map((g) => [g.chave, g.foco]))
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
        // urnas (seções) da zona onde o candidato teve voto
        if (B.zonasUrnas?.has(linha.zonaKey)) Object.assign(linha, urnasDe(arq, cd, { zona: k }))
        // para o carrossel "zona por bairro": urnas da zona agrupadas pelo bairro (calculado só ao tocar)
        linha.urnasPorBairro = () => {
          const { urnas } = urnasDe(arq, cd, { zona: k })
          const total = new Map()
          for (const zs of Object.keys(arq.votos[elId] || {})) if (zs.split('-')[0] === k) { const b = bairroDoLocal(arq, arq.secoes[zs]); total.set(b, (total.get(b) || 0) + 1) }
          const porB = new Map()
          for (const u of urnas) porB.set(u.bairro, [...(porB.get(u.bairro) || []), u])
          return [...porB.entries()].map(([bairro, us]) => ({ bairro, urnas: us, total: total.get(bairro) || us.length, v: us.reduce((a, u) => a + u.v, 0) })).sort((a, b) => b.v - a.v)
        }
        if (B.zonas?.has(linha.zonaKey) || B.zonasTodas) {
          const gb = agregarSecoes(arq, F.el, { zona: k }, 'bairro', nr)
          let b22 = null
          if (com22) {
            const a22 = secoesAno(A0, cd, re)
            if (a22) b22 = new Map(agregarSecoes(a22, p22.el, { zona: k }, 'bairro', nr22).grupos.map((x) => [x.chave, x.foco]))
          }
          const ks = new Set(gb.grupos.filter((x) => x.foco > 0).map((x) => x.chave))
          if (b22) for (const [kb, v22] of b22) if (v22 > 0) ks.add(kb)
          const porChave = new Map(gb.grupos.map((x) => [x.chave, x]))
          linha.filhos = [...ks].map((kb) => {
            const x = porChave.get(kb)
            const chaveB = `${linha.zonaKey}|${kb}`
            return { zonaNome: `${Number(k)}ª zona`, nome: kb, v: x?.foco || 0, val: x?.validos || 0, v22: b22?.get(kb) || 0, pos: x?.foco ? posicaoNoGrupo(x, nr) : null, ir: `data-bai-ir="${esc(cd)}" data-bai-bairro="${esc(kb)}"`, chaveB, ...(B.bairrosUrnas?.has(chaveB) ? urnasDe(arq, cd, { zona: k, bairro: kb }) : {}) }
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
    aviso: faltam ? `Carregando ${faltam} de ${cds.length} municípios…` : faltam22 ? `Carregando os dados de ${A0} (${cds.length - faltam22} de ${cds.length})…` : '',
    nota: `Total em ${esc(B.mun.nm)}: <strong>${fmt.format(total)}</strong> votos${com22 ? ` (${A0}: ${fmt.format(linhas.reduce((a, l) => a + l.v22, 0))})` : ''}${regiao ? ` · ${prontos.length} municípios` : ''}.${p22 && !usa22 ? ' A comparação com ${A0} aparece por zona e por bairro (locais e seções mudam de número entre as eleições).' : ''}`,
  }
}

/* ---------------- início ---------------- */

// instalar como app (PWA): service worker com rede primeiro
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {})

// Versão nova publicada: compara a <meta name="versao"> do index.html do servidor com a desta página
// e oferece recarregar (sem precisar fechar e abrir o app).
async function checarVersao() {
  if (!VERSAO || document.getElementById('versao-nova')) return
  try {
    const html = await (await fetch(`./?checar=${Date.now()}`, { cache: 'no-store' })).text()
    const v = html.match(/<meta name="versao" content="([\w.-]+)"/)?.[1]
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
$('.sub').textContent = subtituloAno()
// 🧭 Campanha (campanha.js): formulários e helpers do app
conteudo.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-camp-form]')
  if (!f) return
  ev.preventDefault()
  submitCampanha(f)
})
configurarCampanha({
  esc, fmt, fmtPct, pctDe, semAcento, nomeArquivo, esqueleto, icone, estiloCor, corPartido, pill, attrCand, variacao, COR_VAR, totalCard, listaComparada, botaoCard, baixarCSV, baixarExcel, baixarArquivo, gerarPDF, hashDe,
  NOME_MUN, MUNICIPIOS_SC, ASSOCIACAO_MUN, ASSOCIACOES, ROTULO_26, ROTULO_ELEICAO, INDICE26, eleicaoDoCargo, turnoDe, ehProp, UF, ABAS, PREF, H22, B26, TERR,
  get favoritos() {
    return favoritos
  },
  achar2022, resumo2022, munAno, somaTerr, secoesAno, erroSecoes, arquivoAno, agregarSecoes, bairroDoLocal, tituloLocal, posicaoNoGrupo, salvarTerr, carregarEleicao,
  carregar, rerender: () => estado.aba.tipo === 'camp' && !estado.detalhe && renderizar(),
  lerLocal, gravarLocal, trocarAba, definirChavePro, temChavePro: () => !!PRO.chave,
})
montarAbas()
if (lerHash().p.toString() || lerHash().id === 'telao') aplicarLink()
else carregar()
