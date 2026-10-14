// Modo telão: tela cheia para TV ou projetor, passando os cargos e os acompanhados sozinha.
import { corPartido } from './cores.js'
import { $, TURNO, UF, esc, fmt, fmtPct, num } from './nucleo.js'
import { ABAS, buscar, cadeirasPorPartido, estado, estiloCor, favoritos, foto, hashDesejado, pill, registrarHistorico } from './app.js'

/* ---------------- modo telão ---------------- */

// Tela cheia para TV/projetor: os cargos de SC (e os acompanhados) passam sozinhos a cada 12 s;
// os dados se atualizam a cada 60 s. ← → trocam de tela, espaço pausa, Esc sai.
export const TELAO = { aberto: false, i: 0, pausa: false, dados: new Map(), timer: null, timerDados: null, relogio: null }

export const telaoEl = document.createElement('div')

telaoEl.className = 'telao'

telaoEl.hidden = true

telaoEl.setAttribute('role', 'dialog')

telaoEl.setAttribute('aria-label', 'Modo telão')

document.body.appendChild(telaoEl)

export const TELAS = () => [
  { id: 'governador', tit: 'Governador' },
  { id: 'senador', tit: 'Senado' },
  { id: 'depfed', tit: 'Deputado Federal' },
  { id: 'depest', tit: 'Deputado Estadual' },
  ...(favoritos.some((f) => ABAS.find((a) => a.id === f.aba)?.cargo) ? [{ id: 'favoritos', tit: 'Acompanhados' }] : []),
]

export async function dadosTelao() {
  const ids = new Set(['governador', 'senador', 'depfed', 'depest'])
  const grupos = new Map([...ids].map((id) => [`${id}|${UF}`, { aba: ABAS.find((a) => a.id === id), abr: UF }]))
  for (const f of favoritos) {
    const aba = ABAS.find((a) => a.id === f.aba)
    if (aba?.cargo) grupos.set(`${f.aba}|${f.abr}`, { aba, abr: f.abr })
  }
  await Promise.allSettled(
    [...grupos.entries()].map(async ([k, g]) => {
      const d = await buscar(g.aba, g.abr, TURNO)
      TELAO.dados.set(k, d)
      registrarHistorico(g.aba.id, g.abr, d)
    }),
  )
  if (TELAO.aberto) desenharTelao()
}

export function abrirTelao() {
  if (TELAO.aberto) return
  TELAO.aberto = true
  TELAO.i = 0
  telaoEl.hidden = false
  document.documentElement.classList.add('com-telao')
  if (location.hash !== '#telao') history.pushState({ telao: true }, '', `${location.search}#telao`)
  for (const [k, d] of estado.favDados || []) TELAO.dados.set(k, d)
  desenharTelao()
  dadosTelao()
  TELAO.timerDados = setInterval(dadosTelao, 60_000)
  TELAO.relogio = setInterval(() => {
    const r = telaoEl.querySelector('.tv-relogio')
    if (r) r.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }, 10_000)
  agendarTelao()
  telaoEl.focus()
}

export function fecharTelao(voltar = true) {
  if (!TELAO.aberto) return
  TELAO.aberto = false
  clearTimeout(TELAO.timer)
  clearInterval(TELAO.timerDados)
  clearInterval(TELAO.relogio)
  telaoEl.hidden = true
  telaoEl.innerHTML = ''
  document.documentElement.classList.remove('com-telao')
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  if (location.hash === '#telao') {
    if (voltar && history.state?.telao) history.back()
    else history.replaceState(null, '', `${location.search}${hashDesejado()}`)
  }
}

export function agendarTelao() {
  clearTimeout(TELAO.timer)
  if (TELAO.pausa) return
  TELAO.timer = setTimeout(() => passarTelao(1), 12_000)
}

export function passarTelao(n) {
  const T = TELAS()
  TELAO.i = (TELAO.i + n + T.length) % T.length
  desenharTelao()
  agendarTelao()
}

export function telaCargo(id, tit) {
  const d = TELAO.dados.get(`${id}|${UF}`)
  if (!d) return `<div class="tv-vazio">Carregando ${esc(tit)}…</div>`
  const aba = ABAS.find((a) => a.id === id)
  const validos = d.candidatos.filter((c) => c.valido)
  if (aba.tipo === 'maj') {
    const top = validos.slice(0, 5)
    const max = Math.max(1, ...top.map((c) => c.percentual))
    return `<ol class="tv-maj">${top
      .map((c, i) => {
        const cor = corPartido(c.partido)
        return `<li style="${estiloCor(cor)}"><span class="tv-pos">${i + 1}º</span>${foto(c, cor)}<div class="tv-info"><div class="tv-nome">${esc(c.nome)} ${pill(c.partido, cor)} ${c.eleito ? '<span class="tv-eleito">✔ ELEITO</span>' : ''}</div>
          <div class="tv-barra"><span style="width:${(100 * c.percentual) / max}%"></span></div></div>
          <div class="tv-num"><strong>${fmtPct.format(c.percentual)}%</strong><small>${fmt.format(c.votos)} votos</small></div></li>`
      })
      .join('')}</ol>`
  }
  // deputados: os que ocupam as vagas e a bancada por partido
  const { eleitos, partidos } = cadeirasPorPartido(d)
  const lista = (eleitos.length ? eleitos : validos.slice(0, d.vagas)).slice(0, d.vagas)
  return `<div class="tv-prop">
    <div class="tv-bancada">${partidos
      .map(([p, cs]) => `<span class="tv-cad" style="${estiloCor(corPartido(p))}"><strong>${cs.length}</strong> ${esc(p)}</span>`)
      .join('')}</div>
    <ol class="tv-lista ${lista.length > 20 ? 'tres' : ''}">${lista
      .map((c, i) => `<li style="${estiloCor(corPartido(c.partido))}"><span class="tv-pos">${i + 1}</span><span class="tv-nome">${esc(c.nome)}</span> <span class="tv-sigla">${esc(c.partido)}</span><span class="tv-votos">${fmt.format(c.votos)}</span></li>`)
      .join('')}</ol></div>`
}

export function telaFavoritos() {
  const linhas = favoritos
    .map((f) => {
      const d = TELAO.dados.get(`${f.aba}|${f.abr}`)
      const c = d?.candidatos.find((x) => x.sqcand === f.sqcand)
      if (!c) return ''
      const aba = ABAS.find((a) => a.id === f.aba)
      const cor = corPartido(c.partido)
      return `<li style="${estiloCor(cor)}">${foto(c, cor)}<div class="tv-info"><div class="tv-nome">${esc(c.nome)} ${pill(c.partido, cor)}</div><small>${esc(aba?.rotulo.replace(/ SC$/, '') || '')} · ${d.candidatos.indexOf(c) + 1}º lugar ${c.eleito ? '· ✔ eleito' : c.projecao && !c.tseDefinido ? '· ★ nas vagas' : ''}</small></div>
        <div class="tv-num"><strong>${fmt.format(c.votos)}</strong><small>${fmtPct.format(c.percentual)}%</small></div></li>`
    })
    .join('')
  return `<ol class="tv-maj tv-favs">${linhas}</ol>`
}

export function desenharTelao() {
  const T = TELAS()
  const tela = T[TELAO.i % T.length]
  const ref = TELAO.dados.get(`${tela.id === 'favoritos' ? 'governador' : tela.id}|${UF}`) || TELAO.dados.get(`governador|${UF}`)
  const pst = ref?.secoes?.percentual ?? 0
  const corpo = tela.id === 'favoritos' ? telaFavoritos() : telaCargo(tela.id, tela.tit)
  telaoEl.innerHTML = `<div class="tv">
    <header class="tv-topo">
      <div><p class="tv-chapeu">Apuração 2026 · Santa Catarina</p><h2>${esc(tela.tit)}${tela.id === 'favoritos' ? '' : ` <small>${ABAS.find((a) => a.id === tela.id)?.tipo === 'prop' ? `${TELAO.dados.get(`${tela.id}|${UF}`)?.vagas || ''} vagas` : ''}</small>`}</h2></div>
      <div class="tv-dir"><span class="tv-relogio">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        <button type="button" data-tv-cheia title="Tela cheia">⛶</button><button type="button" data-tv-pausa title="Pausar (espaço)">${TELAO.pausa ? '▶' : '❚❚'}</button><button type="button" data-tv-fechar title="Sair (Esc)">✕</button></div>
    </header>
    <div class="tv-prog"><div class="tv-prog-barra" style="width:${Math.min(100, pst)}%"></div><span>${fmtPct.format(pst)}% das seções apuradas${ref?.final ? ' · resultado final' : ''}${ref?.atualizadoEm ? ` · TSE ${esc(ref.atualizadoEm)}` : ''}</span></div>
    <div class="tv-corpo">${corpo}</div>
    <footer class="tv-rodape"><span>@maiconcombat · maiconcombat.com.br</span><span class="tv-pontos">${T.map((t, i) => `<button type="button" data-tv-ir="${i}" aria-label="${esc(t.tit)}" aria-current="${i === TELAO.i % T.length}"></button>`).join('')}</span><span>Fonte: TSE</span></footer>
  </div>`
}

telaoEl.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-tv-fechar]')) return fecharTelao()
  if (ev.target.closest('[data-tv-cheia]')) return document.fullscreenElement ? document.exitFullscreen?.() : telaoEl.requestFullscreen?.().catch(() => {})
  if (ev.target.closest('[data-tv-pausa]')) return ((TELAO.pausa = !TELAO.pausa), desenharTelao(), agendarTelao())
  const ir = ev.target.closest('[data-tv-ir]')
  if (ir) return ((TELAO.i = Number(ir.dataset.tvIr)), desenharTelao(), agendarTelao())
})

document.addEventListener('keydown', (ev) => {
  if (!TELAO.aberto) return
  if (ev.key === 'Escape' && !document.fullscreenElement) fecharTelao()
  else if (ev.key === 'ArrowRight') passarTelao(1)
  else if (ev.key === 'ArrowLeft') passarTelao(-1)
  else if (ev.key === ' ') {
    ev.preventDefault()
    TELAO.pausa = !TELAO.pausa
    desenharTelao()
    agendarTelao()
  } else return
})

window.addEventListener('popstate', () => {
  if (TELAO.aberto && location.hash !== '#telao') fecharTelao(false)
})
