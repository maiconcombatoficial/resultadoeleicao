// Apuração 2026 — acompanha os resultados oficiais do TSE direto no navegador.
// Formato "-u.json" de 2026: {base}/{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json
// Códigos (resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   6257/6258 = Eleição Geral Federal (Presidente) 1º/2º turno
//   6259/6260 = Eleições Gerais Estaduais (Governador, Senador, Deputados) 1º/2º turno

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

/* ---------------- estado e navegação ---------------- */

const estado = {
  aba: ABAS.find((a) => a.id === (location.hash.slice(1) || lerLocal('aba', 'presidente'))) || ABAS[0],
  abr: {},
  busca: '',
  visao: 'candidatos', // proporcionais: candidatos | partidos
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
      `<button role="tab" type="button" data-aba="${a.id}" aria-selected="${a === estado.aba}">${esc(a.rotulo)}</button>`,
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
  try {
    const dados = await buscar(aba, abr, TURNO, ctrl.signal)
    if (ctrl.signal.aborted) return
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
  }
})

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'busca') {
    estado.busca = ev.target.value
    $('#lista').innerHTML = listaProporcional()
  }
})

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
  const item = (rot, valor, extra) =>
    `<div><dt>${rot}</dt><dd>${valor}${extra != null && !Number.isNaN(extra) ? ` <span class="mudo">${fmtPct.format(extra)}%</span>` : ''}</dd></div>`
  f('numeros').innerHTML = [
    item('Comparecimento', fmt.format(d.eleitorado.comparecimento), d.eleitorado.pComparecimento),
    item('Abstenção', fmt.format(d.eleitorado.abstencao), d.eleitorado.pAbstencao),
    item('Votos válidos', fmt.format(d.votos.validos), d.votos.pValidos),
    item('Brancos', fmt.format(d.votos.brancos), d.votos.pBrancos),
    item('Nulos', fmt.format(d.votos.nulos), d.votos.pNulos),
    item(d.vagas > 1 ? 'Vagas' : 'Vaga', fmt.format(d.vagas)),
  ].join('')
  const div = document.createElement('div')
  div.appendChild(tpl)
  return div.innerHTML
}

function foto(c) {
  const ini = esc(iniciais(c.nome))
  if (!c.foto) return `<span class="foto"><span>${ini}</span></span>`
  return `<span class="foto"><span>${ini}</span><img src="${esc(c.foto)}" alt="" loading="lazy" onerror="this.remove()"></span>`
}

function selo(c) {
  if (c.eleito) return `<span class="tag eleito">${esc(/eleito/i.test(c.situacao) ? c.situacao : 'Eleito')}</span>`
  if (/2º turno|segundo turno/i.test(c.situacao)) return `<span class="tag turno2">2º turno</span>`
  if (/suplente/i.test(c.situacao)) return `<span class="tag suplente">Suplente</span>`
  if (!c.valido) return `<span class="tag invalido">${esc(c.destinacao || 'Voto anulado')}</span>`
  return ''
}

function delta(c) {
  if (!estado.anterior.size) return ''
  const antes = estado.anterior.get(c.sqcand)
  const d = antes == null ? 0 : c.votos - antes
  return d > 0 ? `<span class="delta">+${fmt.format(d)}</span>` : ''
}

function renderMajoritario(d) {
  const lista = d.candidatos.filter((c) => c.valido || c.votos > 0)
  const max = Math.max(1, ...lista.map((c) => c.percentual))
  const vagasTxt =
    estado.aba.cargo === 5 ? `<p class="nota">Em 2026 o Senado renova 2/3: SC elege <strong>${d.vagas}</strong> senadores — os ${d.vagas} mais votados.</p>` : ''
  return `${vagasTxt}<ol class="candidatos">
    ${lista
      .map(
        (c, i) => `
      <li class="cand ${c.eleito ? 'is-eleito' : ''} ${i < d.vagas ? 'is-vaga' : ''}">
        <span class="pos">${i + 1}º</span>
        ${foto(c)}
        <div class="cand-info">
          <div class="cand-linha">
            <span class="cand-nome">${esc(c.nome)}</span>
            ${selo(c)}
          </div>
          <div class="cand-meta">${esc(c.partido)} · ${esc(c.numero)}${c.vices.length ? ` · ${c.vices.map((v) => `${v.tipo === 'v' ? 'Vice' : 'Supl.'}: ${esc(v.nome)}`).join(' · ')}` : ''}</div>
          <div class="barra"><span style="width:${(100 * c.percentual) / max}%"></span></div>
        </div>
        <div class="cand-num">
          <span class="pct">${fmtPct.format(c.percentual)}%</span>
          <span class="votos">${fmt.format(c.votos)} votos</span>
          ${delta(c)}
        </div>
      </li>`,
      )
      .join('')}
  </ol>`
}

function listaProporcional() {
  const d = estado.dados
  if (!d) return ''
  const termo = semAcento(estado.busca.trim())
  const linhas = d.candidatos
    .map((c, i) => ({ c, pos: i + 1 }))
    .filter(({ c }) => !termo || semAcento(`${c.nome} ${c.nomeCompleto} ${c.partido} ${c.numero} ${c.agremiacao}`).includes(termo))
  if (!linhas.length) return `<p class="vazio">Nenhum candidato encontrado para “${esc(estado.busca)}”.</p>`
  const limite = termo ? 300 : 120
  return `<table class="tabela">
    <thead><tr><th>#</th><th>Candidato</th><th class="dir">Votos</th><th class="dir">%</th></tr></thead>
    <tbody>
    ${linhas
      .slice(0, limite)
      .map(
        ({ c, pos }) => `<tr class="${c.eleito ? 'is-eleito' : ''}">
        <td class="mudo">${pos}</td>
        <td>
          <div class="cand-linha"><span class="cand-nome">${esc(c.nome)}</span> ${selo(c)}</div>
          <div class="cand-meta">${esc(c.partido)} · ${esc(c.numero)}${c.agremiacao !== c.partido ? ` · ${esc(c.agremiacao)}` : ''}</div>
        </td>
        <td class="dir">${fmt.format(c.votos)} ${delta(c)}</td>
        <td class="dir">${fmtPct.format(c.percentual)}</td>
      </tr>`,
      )
      .join('')}
    </tbody></table>
    ${linhas.length > limite ? `<p class="nota">Mostrando ${limite} de ${fmt.format(linhas.length)}. Use a busca para encontrar outros candidatos.</p>` : ''}`
}

function tabelaPartidos(d) {
  const grupos = new Map()
  for (const c of d.candidatos) {
    const g = grupos.get(c.agremiacao) || { nome: c.agremiacao, partidos: new Set(), votos: 0, eleitos: 0, cands: 0 }
    g.partidos.add(c.partido)
    g.votos += c.valido ? c.votos : 0
    g.eleitos += c.eleito ? 1 : 0
    g.cands += 1
    grupos.set(c.agremiacao, g)
  }
  const lista = [...grupos.values()].sort((a, b) => b.votos - a.votos)
  const total = lista.reduce((a, g) => a + g.votos, 0) || 1
  const max = Math.max(1, ...lista.map((g) => g.votos))
  return `<p class="nota">Soma dos votos nominais de cada partido ou federação (sem votos de legenda).
    A distribuição oficial das ${d.vagas} vagas usa o quociente eleitoral e sai no fim da apuração — os eleitos aparecem marcados pelo TSE.</p>
    <table class="tabela">
    <thead><tr><th>Partido / federação</th><th class="dir">Votos</th><th class="dir">%</th><th class="dir">Eleitos</th></tr></thead>
    <tbody>
    ${lista
      .map(
        (g) => `<tr>
        <td><div class="cand-nome">${esc(g.nome)}</div>
          <div class="cand-meta">${g.partidos.size > 1 || !g.partidos.has(g.nome) ? esc([...g.partidos].join(', ')) + ' · ' : ''}${g.cands} candidatos</div>
          <div class="barra fina"><span style="width:${(100 * g.votos) / max}%"></span></div></td>
        <td class="dir">${fmt.format(g.votos)}</td>
        <td class="dir">${fmtPct.format((100 * g.votos) / total)}</td>
        <td class="dir">${g.eleitos || '—'}</td>
      </tr>`,
      )
      .join('')}
    </tbody></table>`
}

function renderProporcional(d) {
  const eleitos = d.candidatos.filter((c) => c.eleito)
  const destaque = eleitos.length ? eleitos : d.candidatos.slice(0, d.vagas)
  const titulo = eleitos.length ? `Eleitos (${eleitos.length} de ${d.vagas})` : `Os ${d.vagas} mais votados até agora`
  const chips = destaque
    .map((c) => `<li class="chip ${c.eleito ? 'is-eleito' : ''}"><strong>${esc(c.nome)}</strong> <span class="mudo">${esc(c.partido)} · ${fmt.format(c.votos)}</span></li>`)
    .join('')
  const abas = `<div class="segmentado" role="group" aria-label="Visão">
    <button type="button" data-visao="candidatos" aria-pressed="${estado.visao === 'candidatos'}">Candidatos</button>
    <button type="button" data-visao="partidos" aria-pressed="${estado.visao === 'partidos'}">Partidos</button>
  </div>`
  const corpo =
    estado.visao === 'partidos'
      ? tabelaPartidos(d)
      : `<input id="busca" type="search" placeholder="Buscar por nome, partido ou número…" value="${esc(estado.busca)}" autocomplete="off">
         <div id="lista">${listaProporcional()}</div>`
  return `<section class="cartao">
      <h3>${titulo}</h3>
      ${eleitos.length ? '' : '<p class="nota">Ordem por votos nominais — não é a projeção das vagas, que depende do quociente partidário.</p>'}
      <ul class="chips">${chips}</ul>
    </section>
    <section class="cartao">${abas}${corpo}</section>`
}

function renderizar() {
  const d = estado.dados
  if (!d) return
  const busca = document.activeElement?.id === 'busca'
  const pos = busca ? document.activeElement.selectionStart : null
  conteudo.innerHTML =
    cabecalhoAbrangencia() +
    resumo(d) +
    (estado.aba.tipo === 'maj' ? `<section class="cartao">${renderMajoritario(d)}</section>` : renderProporcional(d)) +
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
