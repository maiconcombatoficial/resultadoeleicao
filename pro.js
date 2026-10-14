// 🔒 Análises (área protegida): dados criptografados, mapa de votos, perfil do eleitor, abstenção e transferência entre turnos.
import { corPartido } from './cores.js'
import { $, COR_VAR, DEMO, UF, VERSAO, conteudo, esc, esqueleto, fmt, fmtPct, num, pctDe, semAcento, statusEl } from './nucleo.js'
import { botaoCard, totalCard, variacao } from './exportar.js'
import { ABAS, B26, FLORIPA_CD, H22, INDICE26, NOME_MUN, PREF, ROTULO_26, abaDe, achar2022, agregarSecoes, bairroDoLocal, buscar, carregar, dadosDetalhe, eleicao26, eleicaoDoCargo, eleicoes26, estado, estiloCor, fecharDetalhe, foto, indice26Pronto, pill, posicaoNoGrupo, regiao, renderizar, resumo, resumo2022, secoesAno, titulo22, trocarAba, turnoDe } from './app.js'

/* ---------------- 🔒 Análises (área protegida) ---------------- */

// Os dados desta área ficam em pro/*.bin, criptografados (AES-256-GCM, comprimidos com gzip).
// A chave dos dados só é obtida com usuário e senha: pro/usuarios.json guarda, para cada usuário,
// a chave embrulhada com outra derivada da senha (PBKDF2-SHA256). Nenhuma senha fica no código.
export const PRO = { chave: null, aba: 'mapa', sel: 't1-c7', cand: null, mun: null, camada: 'votos', busca: '', ordem: 'abst', cargoAbst: 't1-c3', erro: '', entrando: false, mapa: null }

export const ARQ_PRO = new Map()

export const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const bytesB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))

export async function sha256hex(t) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function importarChave(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
}

export async function entrarPro(usuario, senha, lembrar) {
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

export function sairPro() {
  PRO.chave = null
  ARQ_PRO.clear()
  for (const s of [localStorage, sessionStorage]) try { s.removeItem('pro:chave') } catch {}
  renderizar()
}

export async function restaurarPro() {
  let s = null
  for (const g of [localStorage, sessionStorage]) try { s ||= g.getItem('pro:chave') } catch {}
  if (s) PRO.chave = await importarChave(b64bytes(s)).catch(() => null)
}

// chave entregue pelo servidor da campanha (plano com 🔒 Análises): mesma guarda do login por senha
export async function definirChavePro(b64) {
  PRO.chave = await importarChave(b64bytes(b64))
  try {
    localStorage.setItem('pro:chave', b64)
  } catch {}
  if (estado.aba.tipo === 'pro') carregar()
}

export const proPronto = restaurarPro()

// lê e decifra pro/<nome>.bin
export function arquivoPro(nome) {
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
export async function garantirEleicao26(id, signal) {
  if (B26.els.has(id)) return B26.els.get(id)
  const cargo = Number(id.split('-c')[1])
  const d = await buscar(ABAS.find((a) => a.cargo === cargo), UF, turnoDe(id), signal)
  const el = eleicao26(d, cargo, turnoDe(id))
  B26.els.set(id, el)
  return el
}

export async function carregarPro(ctrl) {
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

export function renderLoginPro() {
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

export const COR_ABST = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']

export const pctAbst = (l) => (l[4] ? 100 * (1 - l[5] / l[4]) : 0)

// 5 classes de abstenção (quintis dos locais de votação de SC)
export function limitesAbst() {
  const a = arquivoPro('locais').valor
  if (!a) return null
  if (!PRO.limAbst) {
    const todos = Object.values(a.l).flatMap((m) => Object.values(m)).filter((l) => l[4] >= 50).map(pctAbst).sort((x, y) => x - y)
    PRO.limAbst = [0.2, 0.4, 0.6, 0.8, 1].map((q) => todos[Math.min(todos.length - 1, Math.floor(q * todos.length))])
  }
  return PRO.limAbst
}

export function renderPro() {
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
  if (!el && PRO.aba !== 'abst') return topo + esqueleto('Carregando os candidatos…')
  return topo + (PRO.aba === 'mapa' ? renderMapaPro(el) : PRO.aba === 'perfil' ? renderPerfilPro(el) : renderAbstPro())
}

export function seletorCandidatoPro(el) {
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

export function seletorMunPro(extra = '') {
  const opcoes = [...MUNICIPIOS_SC].sort((a, b) => a[2].localeCompare(b[2], 'pt-BR'))
    .map((m) => `<option value="${m[0]}" ${PRO.mun === m[0] ? 'selected' : ''}>${esc(m[2])}</option>`).join('')
  return `<div class="bai-escolha">
    <button type="button" class="atalho regiao ${!PRO.mun ? 'ativo' : ''}" data-pro-mun="">🗺️ SC inteira</button>
    <button type="button" class="atalho ${PRO.mun === FLORIPA_CD ? 'ativo' : ''}" data-pro-mun="${FLORIPA_CD}">Florianópolis</button>
    <select data-pro-mun-sel aria-label="Município"><option value="">📍 Outro município…</option>${opcoes}</select>${extra}</div>`
}

// cabeçalho dos cards das análises (candidato selecionado)
export function baseCardPro(el, extra = {}) {
  const c = el?.porNumero?.get(String(PRO.cand))
  return { exclusivo: true, turno: turnoDe(PRO.sel), foto: c?.foto, nome: c?.nome || 'Análises', cor: corPartido(c?.partido), sub: c ? `${c.partido} · nº ${c.numero} · ${ROTULO_26[PRO.sel]}` : ROTULO_26[PRO.sel], ...extra }
}

/* ---- mapa ---- */

export function renderMapaPro(el) {
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

export let leafletPronto = null

export function carregarLeaflet() {
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
export async function pontosMapa(el) {
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

export function agrupaMun(cd, ls) {
  const com = ls.filter((l) => l[0] != null)
  const soma = (i) => ls.reduce((a, l) => a + l[i], 0)
  const l = [com.length ? com.reduce((a, x) => a + x[0], 0) / com.length : null, com.length ? com.reduce((a, x) => a + x[1], 0) / com.length : null, NOME_MUN.get(cd) || cd, '', soma(4), soma(5)]
  return { id: cd, nome: NOME_MUN.get(cd) || cd, sub: '', lat: l[0], lon: l[1], l }
}

export function cardMapaPro(el, pts) {
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

export async function montarMapaPro() {
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

export const GRUPOS_PERFIL = [['Sexo', [0]], ['Idade', [1, 2, 3, 4, 5]], ['Escolaridade', [6, 7, 8]]]

export function renderPerfilPro(el) {
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

export const CURTO_ATRIBUTO = { Mulheres: 'Mulheres', '16 a 24 anos': 'Jovens (16 a 24)', '25 a 34 anos': '25 a 34 anos', '35 a 44 anos': '35 a 44 anos', '45 a 59 anos': '45 a 59 anos', '60 anos ou mais': '60 anos ou mais', 'Até fundamental incompleto': 'Até fund. incompleto', 'Médio completo ou superior incompleto': 'Médio ou sup. incompleto', 'Superior completo': 'Superior completo' }

export const rotuloAtributo = (n) => ({ Mulheres: 'mulheres', '16 a 24 anos': 'jovens de 16 a 24 anos', '60 anos ou mais': 'eleitores de 60 anos ou mais', 'Até fundamental incompleto': 'eleitores com até o fundamental incompleto', 'Médio completo ou superior incompleto': 'eleitores com médio completo ou superior incompleto', 'Superior completo': 'eleitores com superior completo' })[n] || `eleitores de ${n}`

/* ---- abstenção, brancos e nulos ---- */

export function renderAbstPro() {
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

export function conjuntosTransf() {
  const l = []
  for (const c of [1, 3]) if (INDICE26.has(`t2-c${c}`)) l.push({ id: `transf-c${c}`, ano: 2026, cargo: c, rot: `${c === 1 ? 'Presidente' : 'Governador'} · 2026` })
  l.push({ id: 'transf22-c3', ano: 2022, cargo: 3, rot: 'Governador · 2022' })
  return l
}

// nome, partido e cor de um número de candidato numa eleição (2022 ou 2026)
export function votavelTransf(ano, id, nr) {
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

export function renderTransfPro() {
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
export function abrirAnalises(det) {
  const aba = abaDe(det.aba)
  const c = dadosDetalhe()?.candidatos.find((x) => x.sqcand === det.sqcand)
  if (!aba?.cargo || !c) return
  // eleição anterior: só abre a área (entrar com a senha); 2026: já com o candidato em destaque
  if (!aba.hist) Object.assign(PRO, { sel: eleicaoDoCargo(aba.cargo), cand: Number(c.numero), aba: 'mapa', busca: '' })
  const ir = () => {
    trocarAba('analises')
    window.scrollTo({ top: 0 })
  }
  const voltar = history.state?.detalhe
  fecharDetalhe()
  if (voltar) window.addEventListener('popstate', () => setTimeout(ir), { once: true })
  else ir()
}
