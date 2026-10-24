// 🧭 Campanha: conta e comitê (Neon), equipe de coordenadores e cabos eleitorais com os territórios de cada
// um, relatório de votos por liderança, 🧠 IA (perguntas e relatórios sobre os dados de votação) e notas.
//
// O app.js injeta os helpers (configurarCampanha) e chama renderCampanha/tratarCampanha/inputCampanha.
// Os votos vêm dos arquivos estáticos do TSE já usados pelo app; o banco guarda só pessoas, territórios,
// metas, notas, relatórios e conversas.
import { api, apiBase, apiLogado, apiToken, ErroApi } from './api.js'
import { GARANTIA_DIAS, PLANOS, PLANO_IDS, precoBR } from './server/planos.ts'

let X = null // helpers do app.js
export function configurarCampanha(ctx) {
  X = ctx
}

const PAPEL = { admin: 'Comitê (admin)', coordenador: 'Coordenador', cabo: 'Cabo eleitoral' }
const CARGO_ABA = { presidente: 1, governador: 3, senador: 5, depfed: 6, depest: 7 }
const ABA_CARGO = { 1: 'presidente', 3: 'governador', 5: 'senador', 6: 'depfed', 7: 'depest' }

export const CAMP = {
  vis: 'equipe', // equipe | ia | notas | plano | conta
  sessao: undefined, // undefined = ainda não conferida · null = sem login · { usuario, comite, territorio, plano }
  carregando: false,
  erro: '',
  indisponivel: false,
  convite: '', // código vindo do link (#campanha?convite=…)
  codigoLogin: '', // código de uso único do retorno do Google (#campanha?codigo=…)
  redefinir: '', // token do link de redefinição de senha (#campanha?redefinir=…)
  pagamento: '', // retorno do Mercado Pago (#campanha?pagamento=ok|pendente|erro)
  nudge: '', // aviso de limite do plano (erro com codigo 'plano')
  periodo: 'anual', // período mostrado na tabela de preços
  plano: null, // GET /plano (seção 💳 Plano)
  form: { modo: 'entrar', usuario: '', senha: '', nome: '', email: '', telefone: '', comite: '', convite: '', aceite: false, erro: '', ocupado: false, enviado: false },
  equipe: null, // { comite, membros }
  convites: null,
  novoConvite: { papel: 'cabo', coordenadorId: '', maxUsos: 1 },
  buscaCand: '',
  edit: null, // edição do território de um membro: { id, nome, itens, meta, cd, buscaMun, abertos }
  ordem: 'votos',
  ia: { estado: undefined, mensagens: [], pergunta: '', ocupado: false, erro: '', conversaId: null, salvando: null, relatorios: null, verRelatorio: null, passo: '' },
  notas: null,
  nota: { texto: '', lugar: '' },
  conta: { senhaAtual: '', senhaNova: '', msg: '' },
}

const re = () => X.rerender()
const esc = (s) => X.esc(s)
const fmt = (n) => X.fmt.format(n)
const pct = (v, t) => X.fmtPct.format(X.pctDe(v, t))
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const erroTexto = (e) => (e instanceof ErroApi ? e.message : 'Não deu certo agora. Tente de novo.')

/* ---------------- sessão ---------------- */

export async function prepararCampanha(signal) {
  if (CAMP.sessao === undefined) await carregarSessao()
  if (signal?.aborted) return
  const cand = CAMP.sessao?.comite?.candidato
  if (cand?.cargo) await X.carregarEleicao(cand.cargo, signal).catch(() => {})
}

// sem login, confere se o servidor da campanha existe neste endereço (GitHub Pages não tem /api)
async function verificarSaude() {
  if (CAMP.saude !== undefined) return
  CAMP.saude = null
  try {
    const s = await api.get('/saude')
    CAMP.saude = s
    CAMP.indisponivel = !s?.banco
  } catch (e) {
    CAMP.saude = { ok: false }
    CAMP.indisponivel = true
  }
  re()
}

async function carregarSessao() {
  // voltou do Google com um código de uso único: troca por um token de sessão
  if (CAMP.codigoLogin) {
    const codigo = CAMP.codigoLogin
    CAMP.codigoLogin = ''
    try {
      const s = await api.post('/auth/google/trocar', { codigo })
      apiToken(s.token)
      aplicarSessao(s)
      CAMP.equipe = null
      return
    } catch (e) {
      CAMP.form.erro = erroTexto(e)
    }
  }
  if (!apiLogado()) {
    CAMP.sessao = null
    verificarSaude()
    return
  }
  CAMP.carregando = true
  try {
    const s = await api.get('/me')
    aplicarSessao(s)
  } catch (e) {
    CAMP.sessao = null
    CAMP.indisponivel = e instanceof ErroApi && e.indisponivel
    if (!(e instanceof ErroApi && (e.status === 401 || e.indisponivel))) CAMP.erro = erroTexto(e)
  } finally {
    CAMP.carregando = false
  }
}

function aplicarSessao(s) {
  CAMP.sessao = { usuario: s.usuario, comite: s.comite, territorio: s.territorio, plano: s.plano || null }
  CAMP.indisponivel = false
  CAMP.erro = ''
  if (s.plano?.limites?.analises && !X.temChavePro()) pedirChavePro()
  // território salvo no servidor entra no aparelho quando aqui não há nada marcado
  const T = X.TERR
  const t = s.territorio
  if (t?.itens && Object.keys(t.itens).length && !Object.keys(T.itens).length) {
    T.itens = t.itens
    T.nome = t.nome || T.nome
    if (t.ref) T.ref = t.ref
    X.salvarTerr(true)
  } else if (Object.keys(T.itens).length && !Object.keys(t?.itens || {}).length) enviarTerritorio()
}

// plano com 🔒 Análises: o servidor entrega a chave dos dados e o app abre a área sem a senha antiga
let pedindoChave = false
async function pedirChavePro() {
  if (pedindoChave) return
  pedindoChave = true
  try {
    const r = await api.get('/pro/chave')
    if (r?.chave) await X.definirChavePro(r.chave)
  } catch {
  } finally {
    pedindoChave = false
  }
}

// limite do plano (erro com codigo 'plano'): mostra o aviso com o caminho para os planos
function avisoPlano(e) {
  if (e instanceof ErroApi && e.codigo === 'plano') {
    CAMP.nudge = e.message
    re()
    return true
  }
  return false
}
const limitesDoPlano = () => CAMP.sessao?.plano?.limites || PLANOS.gratis

// chamado pelo app.js sempre que "Meu território" é salvo no aparelho
let timerTerr = null
export function aoSalvarTerritorio() {
  if (!CAMP.sessao) return
  clearTimeout(timerTerr)
  timerTerr = setTimeout(enviarTerritorio, 1200)
}
async function enviarTerritorio() {
  if (!CAMP.sessao) return
  const T = X.TERR
  try {
    const t = await api.put('/territorio', { nome: T.nome, itens: T.itens, meta: CAMP.sessao.territorio?.meta || 0, ref: T.ref || null })
    CAMP.sessao.territorio = t
    if (CAMP.equipe) {
      const m = CAMP.equipe.membros.find((x) => x.id === CAMP.sessao.usuario.id)
      if (m) m.territorio = t
    }
  } catch {}
}

async function entrar() {
  const f = CAMP.form
  f.erro = ''
  f.ocupado = true
  re()
  try {
    if (f.modo === 'recuperar') {
      await api.post('/auth/recuperar', { email: f.email })
      Object.assign(f, { ocupado: false, enviado: true })
      return re()
    }
    const s =
      f.modo === 'entrar'
        ? await api.post('/auth/entrar', { usuario: f.usuario, senha: f.senha })
        : f.modo === 'redefinir'
          ? await api.post('/auth/redefinir', { token: CAMP.redefinir, senha: f.senha })
          : await api.post('/auth/cadastrar', { nome: f.nome, usuario: f.usuario, email: f.email, senha: f.senha, telefone: f.telefone || undefined, convite: f.convite || undefined, comite: f.convite ? undefined : f.comite, aceite: f.aceite })
    CAMP.redefinir = ''
    apiToken(s.token)
    aplicarSessao(s)
    CAMP.form = { ...CAMP.form, senha: '', erro: '', ocupado: false }
    CAMP.equipe = null
    X.carregar()
  } catch (e) {
    f.erro = erroTexto(e)
    f.ocupado = false
    CAMP.indisponivel = e instanceof ErroApi && e.indisponivel
    re()
  }
}

async function sair() {
  try {
    await api.post('/auth/sair')
  } catch {}
  apiToken(null)
  Object.assign(CAMP, { sessao: null, equipe: null, convites: null, notas: null, edit: null })
  CAMP.ia = { ...CAMP.ia, mensagens: [], conversaId: null, relatorios: null, verRelatorio: null }
  re()
}

/* ---------------- render ---------------- */

export function renderCampanha() {
  if (CAMP.sessao === undefined) {
    if (!CAMP.carregando) carregarSessao().then(re)
    return X.esqueleto('Conferindo a sua conta…')
  }
  const topo = `<section class="cartao camp-topo"><h2>🧭 Campanha</h2>
    <p class="nota">Equipe de coordenadores e cabos eleitorais, relatório de votos por liderança, 🧠 IA para analisar os dados de votação e notas de campanha. Os dados ficam no banco da campanha (Neon); os votos continuam vindo do TSE.</p>
    ${CAMP.sessao ? `<div class="segmentado camp-vis" role="group" aria-label="Seção">${[['equipe', '👥 Equipe'], ['ia', '🧠 IA'], ['notas', '📝 Notas'], ...(souAdmin() ? [['plano', '💳 Plano']] : []), ['conta', '⚙️ Conta']].map(([k, t]) => `<button type="button" data-camp-vis="${k}" aria-pressed="${CAMP.vis === k}">${t}</button>`).join('')}</div>` : ''}
  </section>${CAMP.sessao ? renderNudge() : ''}`
  if (!CAMP.sessao) return topo + renderLogin()
  if (CAMP.vis === 'ia') return topo + renderIA()
  if (CAMP.vis === 'notas') return topo + renderNotas()
  if (CAMP.vis === 'plano') return topo + renderPlano()
  if (CAMP.vis === 'conta') return topo + renderConta()
  return topo + renderEquipe()
}

// aviso de limite do plano
function renderNudge() {
  if (!CAMP.nudge) return ''
  const P = CAMP.sessao?.plano
  return `<section class="cartao camp-nudge"><div><strong>Limite do plano${P ? ` ${esc(P.nome)}` : ''}</strong><p>${esc(CAMP.nudge)}</p></div><div class="camp-acoes">${souAdmin() ? '<button type="button" class="botao" data-camp-vis="plano">💳 Ver planos</button>' : '<span class="nota">Peça ao comitê (admin) para fazer o upgrade.</span>'} <button type="button" class="link-zonas leve" data-camp-nudge-fechar>✕</button></div></section>`
}

/* ---------------- planos e preços ---------------- */

// tabela de planos (tela de login, Sobre e 💳 Plano); com admin logado, mostra os botões de contratar
export function renderPrecos({ compacto = false, atual = null, podeContratar = false } = {}) {
  const periodo = CAMP.periodo
  const grupos = [['individual', 'Para você'], ['comite', 'Para o comitê']]
  const cartao = (id) => {
    const P = PLANOS[id]
    const preco = P[periodo]
    const atualEste = atual === id
    return `<div class="preco ${P.destaque ? 'destaque' : ''} ${atualEste ? 'atual' : ''}">
      ${P.destaque ? '<span class="preco-selo">Mais escolhido</span>' : ''}
      <h4>${esc(P.nome)}</h4>
      <div class="preco-valor">${preco ? `<strong>${esc(precoBR(preco))}</strong><small>/${periodo === 'anual' ? 'ano' : 'mês'}</small>` : '<strong>Grátis</strong>'}</div>
      ${preco && periodo === 'anual' ? `<div class="mudo">ou 12x de ${esc(precoBR(Math.ceil(preco / 12)))} no cartão</div>` : ''}
      <ul>${P.descricao.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      ${atualEste ? '<span class="preco-atual">Seu plano atual</span>' : podeContratar && preco ? `<button type="button" class="botao" data-camp-checkout="${id}|${periodo}">Contratar</button>` : ''}
    </div>`
  }
  return `<section class="cartao camp-precos"><h3>💳 Planos</h3>
    <div class="segmentado" role="group" aria-label="Período"><button type="button" data-camp-periodo="anual" aria-pressed="${periodo === 'anual'}">Anual</button><button type="button" data-camp-periodo="mensal" aria-pressed="${periodo === 'mensal'}">Mensal</button></div>
    ${grupos.map(([g, t]) => `<div class="preco-grupo"><span class="atalhos-rot">${t}</span><div class="precos ${compacto ? 'compacto' : ''}">${PLANO_IDS.filter((id) => PLANOS[id].grupo === g).map(cartao).join('')}</div></div>`).join('')}
    <p class="nota">Garantia de ${GARANTIA_DIAS} dias: devolução integral do primeiro pagamento, sem perguntas. Pagamento pelo Mercado Pago (Pix, cartão em até 12x ou boleto). O plano mensal renova sozinho até você cancelar; o anual não renova sozinho. <a href="termos.html" target="_blank" rel="noopener">Termos de uso</a> · <a href="privacidade.html" target="_blank" rel="noopener">Privacidade</a>.</p>
  </section>`
}

async function carregarPlano() {
  try {
    CAMP.plano = await api.get('/plano')
    if (CAMP.pagamento === 'ok' && souAdmin()) {
      CAMP.pagamento = 'sinc'
      const P = await api.post('/plano/sincronizar').catch(() => null)
      if (P) CAMP.plano = { ...CAMP.plano, ...P }
      const s = await api.get('/me').catch(() => null)
      if (s) aplicarSessao(s)
      CAMP.pagamento = 'ok'
    }
  } catch (e) {
    CAMP.erro = erroTexto(e)
    CAMP.plano = { erro: true }
  }
  re()
}

function renderPlano() {
  if (!CAMP.plano) {
    carregarPlano()
    return X.esqueleto('Carregando o plano…')
  }
  const P = CAMP.plano
  const L = P.limites || PLANOS.gratis
  const uso = P.uso || {}
  const barra = (rot, v, max) => `<div class="camp-uso"><div class="meta-topo"><span>${rot}</span><strong>${fmt(v)}${max == null ? '' : ` / ${fmt(max)}`}</strong></div>${max == null ? '<div class="mudo">ilimitado</div>' : `<div class="barra fina"><span style="width:${Math.min(100, max ? (100 * v) / max : 0)}%"></span></div>`}</div>`
  const banner = CAMP.pagamento === 'ok' ? '<div class="aviso camp-aviso ok">✅ Pagamento recebido. Se o plano ainda não aparecer ativo, aguarde alguns instantes e toque em "Atualizar".</div>' : CAMP.pagamento === 'pendente' ? '<div class="aviso camp-aviso">⏳ Pagamento em processamento (Pix ou boleto). O plano é liberado assim que o Mercado Pago confirmar.</div>' : CAMP.pagamento === 'erro' ? '<div class="aviso camp-aviso">⚠️ O pagamento não foi concluído. Você pode tentar de novo abaixo.</div>' : ''
  return `${banner}<section class="cartao camp-plano"><h3>💳 Plano do comitê</h3>
    <div class="fav-nums">
      <div><span class="fav-rot">Plano</span><strong>${esc(P.nome || 'Grátis')}</strong>${P.vencido ? '<span class="camp-erro">vencido</span>' : P.periodo ? `<span class="mudo">${P.periodo}</span>` : ''}</div>
      <div><span class="fav-rot">Válido até</span><strong>${P.planoAte ? new Date(P.planoAte).toLocaleDateString('pt-BR') : '–'}</strong>${P.assinatura ? '<span class="mudo">renova todo mês</span>' : ''}</div>
      <div><span class="fav-rot">Pessoas</span><strong>${fmt(uso.pessoas || 0)}${L.pessoas == null ? '' : ` / ${fmt(L.pessoas)}`}</strong></div>
    </div>
    ${barra('🧠 IA hoje', uso.iaHoje || 0, L.iaDia)}
    ${barra('Municípios com território', uso.municipios || 0, L.municipios)}
    <p class="nota">Inclui: ${[L.analises && '🔒 Análises', L.notas && '📝 Notas', L.relatorioEquipe && '📊 Relatório por liderança', L.iaDia > 0 && `🧠 IA (${L.iaDia}/dia)`].filter(Boolean).join(' · ') || 'resultados públicos'}.</p>
    <div class="exportar"><button type="button" class="botao secundario" data-camp-plano-atualizar>⟳ Atualizar</button>${P.assinatura ? '<button type="button" class="botao secundario" data-camp-plano-cancelar>Cancelar assinatura mensal</button>' : ''}</div>
    ${P.pagamento ? '' : '<p class="nota">⚠️ O pagamento ainda não está configurado neste servidor (MP_ACCESS_TOKEN).</p>'}
    ${(P.pagamentos || []).length ? `<details class="camp-sobre"><summary>Pagamentos</summary><div class="camp-lista">${P.pagamentos.map((p) => `<div class="camp-item"><div>${esc(PLANOS[p.plano]?.nome || p.plano)} · ${esc(p.periodo)} · ${esc(p.valor)}<div class="cand-meta">${esc(p.tipo)} · ${esc(p.status)} · ${quando(p.criadoEm)}</div></div></div>`).join('')}</div></details>` : ''}
  </section>${renderPrecos({ atual: P.id, podeContratar: souAdmin() && !!P.pagamento })}`
}

/* ---------------- onboarding do comitê ---------------- */

function cardOnboarding(comite, membros) {
  if (!souAdmin() || X.lerLocal('campanha:onb', '') === '1') return ''
  const t = CAMP.sessao.territorio
  const passos = [
    { ok: !!comite?.nome && !/^Comitê de /.test(comite.nome), t: 'Dê um nome ao comitê', a: '<a href="#camp-comite-nome" class="link-zonas">nome do comitê ›</a>' },
    { ok: !!comite?.candidato, t: 'Escolha o candidato do comitê', a: '<a href="#camp-cand-busca" class="link-zonas">escolher ›</a>' },
    { ok: (CAMP.convites || []).length > 0 || membros.length > 1, t: 'Gere um convite para a equipe', a: '<a href="#camp-cv-usos" class="link-zonas">convites ›</a>' },
    { ok: membros.length > 1, t: 'Convide coordenadores e cabos', a: '<span class="mudo">mande o link pelo WhatsApp</span>' },
    { ok: !!t && Object.keys(t.itens || {}).length > 0, t: 'Marque o seu território', a: '<a href="#bairros" class="link-zonas">🏘️ Bairros → 📍 Meu território ›</a>' },
    { ok: CAMP.ia.mensagens.length > 0 || (CAMP.notas || []).length > 0, t: 'Faça a primeira pergunta à IA ou escreva uma nota', a: '<button type="button" class="link-zonas" data-camp-vis="ia">🧠 IA ›</button>' },
  ]
  const feitos = passos.filter((p) => p.ok).length
  if (feitos === passos.length) return ''
  return `<section class="cartao camp-onb"><h3>🚀 Primeiros passos <span class="mudo">· ${feitos} de ${passos.length}</span></h3>
    <ol class="camp-passos">${passos.map((p) => `<li class="${p.ok ? 'ok' : ''}"><span>${p.ok ? '✅' : '⬜'}</span> <span>${esc(p.t)}</span> ${p.ok ? '' : p.a}</li>`).join('')}</ol>
    <button type="button" class="link-zonas leve" data-camp-onb-fechar>Esconder</button>
  </section>`
}

function renderLogin() {
  const f = CAMP.form
  if (CAMP.convite && !f.convite) {
    f.convite = CAMP.convite
    if (f.modo === 'entrar') f.modo = 'criar'
  }
  if (CAMP.redefinir) f.modo = 'redefinir'
  const aviso = CAMP.indisponivel ? `<div class="aviso camp-aviso">⚠️ O servidor da campanha${CAMP.saude && CAMP.saude.ok !== false && !CAMP.saude.banco ? ' está sem banco de dados configurado (DATABASE_URL)' : ' não está disponível neste endereço'}. A versão completa roda no Vercel com o banco Neon (veja o README); no GitHub Pages só o site estático funciona.</div>` : ''
  const google = CAMP.saude?.google !== false
  const linkGoogle = `${apiBase()}/auth/google/iniciar?${new URLSearchParams({ ...(f.convite ? { convite: f.convite } : {}), ...(CAMP.vis !== 'equipe' ? { v: CAMP.vis } : {}), aceite: f.aceite ? '1' : '0' }).toString()}`
  const botaoGoogle = `<a class="botao botao-google ${google ? '' : 'desligado'}" href="${google ? esc(linkGoogle) : '#campanha'}" ${google ? '' : 'aria-disabled="true" title="Login com Google não configurado neste servidor"'} data-camp-google><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.3-4.8 7.5l7.4 5.7c4.4-4.1 7.2-10.1 7.2-16.8z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg> Entrar com Google</a>`
  const aceite = `<label class="camp-aceite"><input id="camp-aceite" type="checkbox" ${f.aceite ? 'checked' : ''} required> Li e aceito os <a href="termos.html" target="_blank" rel="noopener">termos de uso</a> e a <a href="privacidade.html" target="_blank" rel="noopener">política de privacidade</a>.</label>`
  let corpo = ''
  if (f.modo === 'recuperar') {
    corpo = f.enviado
      ? `<p class="nota">Se existir uma conta com <strong>${esc(f.email)}</strong>, enviamos um link para criar uma senha nova. Vale por 1 hora. Confira também a caixa de spam.</p><button type="button" class="botao secundario" data-camp-modo="entrar">← Voltar</button>`
      : `<form data-camp-form="entrar" autocomplete="on"><p class="nota">Informe o e-mail da conta: enviamos um link para criar uma senha nova.</p>
        <label>E-mail <input id="camp-email" type="email" maxlength="120" value="${esc(f.email)}" required autocomplete="email"></label>
        ${f.erro ? `<p class="camp-erro" role="alert">${esc(f.erro)}</p>` : ''}
        <button type="submit" class="botao" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? '⏳ Aguarde…' : 'Enviar link'}</button>
        <button type="button" class="botao secundario" data-camp-modo="entrar">← Voltar</button></form>`
  } else if (f.modo === 'redefinir') {
    corpo = `<form data-camp-form="entrar" autocomplete="on"><p class="nota">Crie a sua senha nova.</p>
      <label>Senha nova <input id="camp-senha" type="password" minlength="6" value="${esc(f.senha)}" required autocomplete="new-password"></label>
      ${f.erro ? `<p class="camp-erro" role="alert">${esc(f.erro)}</p>` : ''}
      <button type="submit" class="botao" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? '⏳ Aguarde…' : 'Salvar e entrar'}</button></form>`
  } else {
    corpo = `<div class="segmentado" role="group"><button type="button" data-camp-modo="entrar" aria-pressed="${f.modo === 'entrar'}">Entrar</button><button type="button" data-camp-modo="criar" aria-pressed="${f.modo === 'criar'}">Criar conta</button></div>
    ${botaoGoogle}
    <div class="camp-ou"><span>ou</span></div>
    <form data-camp-form="entrar" autocomplete="on">
      ${f.modo === 'criar' ? `<label>Seu nome <input id="camp-nome" type="text" maxlength="80" value="${esc(f.nome)}" required autocomplete="name"></label>` : ''}
      <label>${f.modo === 'criar' ? 'Usuário' : 'Usuário ou e-mail'} <input id="camp-usuario" type="text" maxlength="120" value="${esc(f.usuario)}" required autocomplete="username" placeholder="ex.: maria.silva" ${f.modo === 'criar' ? 'pattern="[a-zA-Z0-9._-]{3,40}"' : ''}></label>
      ${f.modo === 'criar' ? `<label>E-mail <input id="camp-email" type="email" maxlength="120" value="${esc(f.email)}" required autocomplete="email"></label>` : ''}
      <label>Senha <input id="camp-senha" type="password" minlength="6" value="${esc(f.senha)}" required autocomplete="${f.modo === 'criar' ? 'new-password' : 'current-password'}"></label>
      ${f.modo === 'criar' ? `<label>Telefone (opcional) <input id="camp-telefone" type="tel" maxlength="30" value="${esc(f.telefone)}" autocomplete="tel"></label>
        <label>Código de convite <input id="camp-convite" type="text" maxlength="12" value="${esc(f.convite)}" placeholder="recebido do coordenador" style="text-transform:uppercase"></label>
        ${!f.convite ? `<label>…ou crie um comitê novo (você será o admin) <input id="camp-comite" type="text" maxlength="80" value="${esc(f.comite)}" placeholder="nome do comitê / candidatura"></label>` : ''}
        ${aceite}` : ''}
      ${f.erro ? `<p class="camp-erro" role="alert">${esc(f.erro)}</p>` : ''}
      <button type="submit" class="botao" ${f.ocupado ? 'disabled' : ''}>${f.ocupado ? '⏳ Aguarde…' : f.modo === 'criar' ? 'Criar conta' : 'Entrar'}</button>
      ${f.modo === 'entrar' ? '<button type="button" class="link-zonas leve" data-camp-modo="recuperar">Esqueci a senha</button>' : ''}
    </form>
    ${f.modo === 'criar' ? '<p class="nota">Ao entrar com o Google pela primeira vez, marque o aceite acima. Cabos eleitorais entram com o código de convite do coordenador; o comitê cria a conta sem convite e depois convida os coordenadores. A senha fica só como hash no banco.</p>' : ''}`
  }
  return `${aviso}<section class="cartao camp-login">${corpo}</section>${renderPrecos({ compacto: true })}`
}

/* ---------------- equipe ---------------- */

const souAdmin = () => CAMP.sessao?.usuario.papel === 'admin'
const souCoord = () => CAMP.sessao?.usuario.papel === 'coordenador'

async function carregarEquipe() {
  try {
    CAMP.equipe = await api.get('/equipe')
    if (!souAdmin() && !souCoord()) CAMP.convites = []
    else CAMP.convites = await api.get('/convites').catch(() => [])
  } catch (e) {
    CAMP.erro = erroTexto(e)
    CAMP.equipe = { comite: CAMP.sessao.comite, membros: [] }
  }
  re()
}

function renderEquipe() {
  if (!CAMP.equipe) {
    carregarEquipe()
    return X.esqueleto('Carregando a equipe…')
  }
  const { comite, membros } = CAMP.equipe
  return [cardOnboarding(comite, membros), cardComite(comite), CAMP.edit ? cardEditorTerritorio() : '', cardConvites(), cardMembros(membros), cardRelatorio(comite, membros)].join('')
}

function cardComite(comite) {
  const cand = comite?.candidato
  const admin = souAdmin()
  const termo = X.semAcento(CAMP.buscaCand.trim())
  let achados = ''
  if (admin && termo.length >= 2) {
    const els = Object.values(CARGO_ABA).map((cg) => X.B26.els.get(X.eleicaoDoCargo(cg))).filter(Boolean)
    if (els.length < 4) {
      Object.values(CARGO_ABA).forEach((cg) => X.carregarEleicao(cg).then(re).catch(() => {}))
      achados = '<p class="nota">Carregando os candidatos…</p>'
    } else {
      const lista = els.flatMap((el) => el.candidatos.filter((c) => c.valido !== false && X.semAcento(`${c.nome} ${c.nomeCompleto || ''} ${c.partido} ${c.numero}`).includes(termo)).map((c) => ({ el, c }))).slice(0, 12)
      achados = `<div class="atalhos-chips">${lista.map(({ el, c }) => `<button type="button" class="atalho" data-camp-cand="${esc(c.sqcand)}|${ABA_CARGO[el.cargo]}|${el.cargo}|${esc(c.numero)}|${esc(c.nome)}|${esc(c.partido)}" style="${X.estiloCor(X.corPartido(c.partido))}">${esc(c.nome)} <small>${esc(X.ROTULO_26[el.id] || '')} · ${esc(c.partido)} · ${esc(c.numero)}</small></button>`).join('') || '<span class="nota">Ninguém com esse nome.</span>'}</div>`
    }
  }
  const favs = admin ? X.favoritos.filter((f) => CARGO_ABA[f.aba]) : []
  return `<section class="cartao camp-comite"><h3>🏛️ ${esc(comite?.nome || 'Comitê')} <span class="mudo">· ${esc(PAPEL[CAMP.sessao.usuario.papel])}</span></h3>
    ${cand ? `<div class="pro-cand" style="${X.estiloCor(X.corPartido(cand.partido))}">Candidato do comitê: <span class="cand-nome">${esc(cand.nome)}</span> ${X.pill(cand.partido)} <span class="mudo">nº ${esc(cand.numero)} · ${esc(X.ROTULO_26[X.eleicaoDoCargo(cand.cargo)] || '')}</span> <button type="button" class="link-zonas" ${X.attrCand({ sqcand: cand.sq }, cand.aba, X.UF)}>📋 Ficha ›</button>${admin ? ' <button type="button" class="link-zonas leve" data-camp-cand="">✕ trocar</button>' : ''}</div>` : `<p class="nota">${admin ? 'Escolha o candidato do comitê: o relatório da equipe e a IA usam ele.' : 'O comitê ainda não escolheu o candidato.'}</p>`}
    ${admin && !cand ? `${favs.length ? `<div class="atalhos-chips">${favs.map((f) => `<button type="button" class="atalho" data-camp-cand="${esc(f.sqcand)}|${esc(f.aba)}|${CARGO_ABA[f.aba]}|${esc(f.numero || '')}|${esc(f.nome)}|${esc(f.partido || '')}" style="${X.estiloCor(X.corPartido(f.partido))}">❤️ ${esc(f.nome)} <small>${esc(f.partido || '')}</small></button>`).join('')}</div>` : ''}
      <input id="camp-cand-busca" type="search" autocomplete="off" placeholder="🔎 Buscar candidato por nome, partido ou número…" value="${esc(CAMP.buscaCand)}">${achados}` : ''}
    ${admin ? `<label class="camp-inline">Nome do comitê <input id="camp-comite-nome" type="text" maxlength="80" value="${esc(comite?.nome || '')}"> <button type="button" class="botao secundario" data-camp-comite-salvar>Salvar</button></label>` : ''}
  </section>`
}

function cardConvites() {
  if (!souAdmin() && !souCoord()) return ''
  const n = CAMP.novoConvite
  const coords = (CAMP.equipe?.membros || []).filter((m) => m.papel === 'coordenador' || m.papel === 'admin')
  const link = (cv) => `${location.origin}${location.pathname}${X.hashDe('campanha', { convite: cv.codigo })}`
  return `<section class="cartao camp-convites"><h3>🔗 Convites</h3>
    <p class="nota">Cada pessoa entra com um código. Mande o link pelo WhatsApp: quem abrir cai direto no cadastro com o código preenchido.</p>
    <div class="camp-form-linha">
      ${souAdmin() ? `<select id="camp-cv-papel" aria-label="Papel"><option value="cabo" ${n.papel === 'cabo' ? 'selected' : ''}>Cabo eleitoral</option><option value="coordenador" ${n.papel === 'coordenador' ? 'selected' : ''}>Coordenador</option></select>
        ${n.papel === 'cabo' ? `<select id="camp-cv-coord" aria-label="Coordenador"><option value="">Responde a: (ninguém)</option>${coords.map((m) => `<option value="${m.id}" ${String(n.coordenadorId) === String(m.id) ? 'selected' : ''}>Responde a ${esc(m.nome)}</option>`).join('')}</select>` : ''}` : '<span class="mudo">Cabo eleitoral · responde a você</span>'}
      <label class="camp-inline">Usos <input id="camp-cv-usos" type="number" min="1" max="500" value="${n.maxUsos}"></label>
      <button type="button" class="botao secundario" data-camp-cv-criar>+ Gerar convite</button>
    </div>
    ${(CAMP.convites || []).length ? `<div class="camp-lista">${CAMP.convites.map((cv) => `<div class="camp-item"><div><strong class="camp-codigo">${esc(cv.codigo)}</strong> <span class="mudo">· ${esc(PAPEL[cv.papel])}${cv.coordenadorId ? ` · responde a ${esc(coords.find((m) => m.id === cv.coordenadorId)?.nome || '')}` : ''} · ${cv.usos}/${cv.maxUsos} usos · vence ${new Date(cv.expiraEm).toLocaleDateString('pt-BR')}</span></div>
      <div class="camp-acoes"><button type="button" class="link-zonas" data-camp-cv-copiar="${esc(link(cv))}">📋 Copiar link</button> <a class="link-zonas" href="https://wa.me/?text=${encodeURIComponent(`Entre na equipe da campanha: ${link(cv)}`)}" target="_blank" rel="noopener">💬 WhatsApp</a> <button type="button" class="link-zonas leve" data-camp-cv-apagar="${esc(cv.codigo)}">✕</button></div></div>`).join('')}</div>` : '<p class="nota">Nenhum convite ativo.</p>'}
  </section>`
}

const nLocais = (t) => Object.keys(t?.itens || {}).length
const nSecoes = (t, arqs) => {
  let n = 0
  for (const [k, secs] of Object.entries(t?.itens || {})) {
    if (secs.length) n += secs.length
    else {
      const [cd, loc] = k.split('|')
      const arq = arqs?.get(cd)
      n += arq ? Object.values(arq.secoes).filter((l) => l === loc).length : 0
    }
  }
  return n
}

function cardMembros(membros) {
  const eu = CAMP.sessao.usuario
  const coords = membros.filter((m) => m.papel !== 'cabo')
  const grupos = new Map()
  for (const m of membros) {
    const k = m.papel === 'cabo' ? m.coordenadorId || 0 : m.id
    grupos.set(k, [...(grupos.get(k) || []), m])
  }
  const ordem = [...coords.map((m) => m.id), 0]
  const linha = (m) => {
    const t = m.territorio
    const edit = souAdmin() || m.id === eu.id || (souCoord() && m.coordenadorId === eu.id)
    return `<div class="camp-item ${m.ativo ? '' : 'inativo'}"><div><strong>${esc(m.nome)}</strong> <span class="mudo">· ${esc(PAPEL[m.papel])}${m.id === eu.id ? ' · você' : ''}${m.telefone ? ` · ${esc(m.telefone)}` : ''}${m.ativo ? '' : ' · desativado'}</span>
        <div class="cand-meta">${t && nLocais(t) ? `📍 ${esc(t.nome)} · ${nLocais(t)} ${nLocais(t) === 1 ? 'local' : 'locais'}${t.meta ? ` · meta ${fmt(t.meta)}` : ''} · ${quando(t.atualizadoEm)}` : 'sem território marcado'}</div></div>
      <div class="camp-acoes">${edit ? `<button type="button" class="link-zonas" data-camp-editar="${m.id}">📍 Território</button>` : ''}
        ${souAdmin() && m.id !== eu.id ? `<select data-camp-papel="${m.id}" aria-label="Papel"><option value="cabo" ${m.papel === 'cabo' ? 'selected' : ''}>Cabo</option><option value="coordenador" ${m.papel === 'coordenador' ? 'selected' : ''}>Coordenador</option><option value="admin" ${m.papel === 'admin' ? 'selected' : ''}>Admin</option></select>
          ${m.papel === 'cabo' ? `<select data-camp-coord="${m.id}" aria-label="Responde a"><option value="">Responde a…</option>${coords.filter((c) => c.id !== m.id).map((c) => `<option value="${c.id}" ${m.coordenadorId === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>` : ''}
          <button type="button" class="link-zonas leve" data-camp-ativo="${m.id}|${m.ativo ? 0 : 1}">${m.ativo ? 'Desativar' : 'Reativar'}</button> <button type="button" class="link-zonas leve" data-camp-remover="${m.id}|${esc(m.nome)}">✕</button>` : ''}</div></div>`
  }
  return `<section class="cartao camp-membros"><h3>👥 Equipe <span class="mudo">· ${membros.length} ${membros.length === 1 ? 'pessoa' : 'pessoas'}</span></h3>
    ${ordem.filter((k) => grupos.has(k)).map((k) => {
      const ls = grupos.get(k)
      const chefe = k ? membros.find((m) => m.id === k) : null
      return `<div class="camp-grupo">${chefe ? linha(chefe) : '<div class="atalhos-rot">Sem coordenador</div>'}${ls.filter((m) => m !== chefe).map((m) => `<div class="camp-sub">${linha(m)}</div>`).join('')}</div>`
    }).join('')}
    <p class="nota">Cada pessoa marca o próprio território em 🏘️ Bairros → 📍 Meu território (sincroniza sozinho). O comitê e os coordenadores também podem marcar pelo botão "Território".</p>
  </section>`
}

/* ---------------- editor do território de um membro ---------------- */

function cardEditorTerritorio() {
  const E = CAMP.edit
  const cds = [...new Set(Object.keys(E.itens).map((k) => k.split('|')[0]))]
  const termo = X.semAcento(E.buscaMun.trim())
  const achados = termo ? X.MUNICIPIOS_SC.filter((m) => X.semAcento(m[2]).includes(termo)).slice(0, 10) : []
  let lista = ''
  if (E.cd) {
    const arq = X.secoesAno(2026, E.cd, re)
    if (!arq) lista = `<p class="nota">${X.erroSecoes(2026, E.cd) ? 'Os boletins deste município ainda não estão no app.' : 'Carregando os locais de votação…'}</p>`
    else {
      const secsDe = new Map()
      for (const [zs, loc] of Object.entries(arq.secoes)) secsDe.set(loc, [...(secsDe.get(loc) || []), zs])
      const porBairro = new Map()
      for (const loc of secsDe.keys()) {
        const b = X.bairroDoLocal(arq, loc)
        porBairro.set(b, [...(porBairro.get(b) || []), loc])
      }
      lista = [...porBairro.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([b, locs]) => `<div class="terr-bairro"><span class="atalhos-rot">${esc(b)}</span>${locs.map((loc) => {
        const k = `${E.cd}|${loc}`
        const it = E.itens[k]
        const secs = secsDe.get(loc).sort((x, y) => Number(x.split('-')[1]) - Number(y.split('-')[1]))
        const aberto = E.abertos.has(k)
        return `<div class="terr-local ${it ? 'marcado' : ''}"><button type="button" class="terr-marca" data-camp-ed-local="${esc(k)}" aria-pressed="${!!it}">${it ? '☑' : '☐'} ${esc(X.tituloLocal((arq.locais[loc] || [loc])[0]))}<small>${secs.length} seções${it?.length ? ` (${it.length} marcadas)` : ''}</small></button>
          <button type="button" class="link-zonas leve" data-camp-ed-abrir="${esc(k)}" aria-expanded="${aberto}">${aberto ? 'fechar' : 'seções'}</button>
          ${aberto ? `<div class="atalhos-chips terr-secoes">${secs.map((zs) => { const on = it && (!it.length || it.includes(zs)); return `<button type="button" class="atalho ${on ? 'ativo' : ''}" data-camp-ed-secao="${esc(k)}|${esc(zs)}">${on ? '✓ ' : ''}${Number(zs.split('-')[0])}ª/${zs.split('-')[1]}</button>` }).join('')}</div>` : ''}</div>`
      }).join('')}</div>`).join('')
    }
  }
  return `<section class="cartao terr-editor camp-editor"><h3>📍 Território de ${esc(E.quem)} <span class="mudo">· ${Object.keys(E.itens).length} locais</span></h3>
    <label>Nome do território <input id="camp-ed-nome" type="text" maxlength="40" value="${esc(E.nome)}"></label>
    <label>Meta de votos <input id="camp-ed-meta" type="text" inputmode="numeric" value="${E.meta ? fmt(E.meta) : ''}" placeholder="—"></label>
    <div class="atalhos-chips">${cds.map((cd) => `<button type="button" class="atalho ${cd === E.cd ? 'ativo' : ''}" data-camp-ed-cd="${cd}">${esc(X.NOME_MUN.get(cd) || cd)}</button>`).join('')}</div>
    <input id="camp-ed-mun" type="search" autocomplete="off" placeholder="🔎 Escolher município para marcar escolas…" value="${esc(E.buscaMun)}">
    ${termo ? `<div class="atalhos-chips">${achados.map((m) => `<button type="button" class="atalho" data-camp-ed-cd="${m[0]}">${esc(m[2])}</button>`).join('') || '<span class="nota">Nenhum município encontrado.</span>'}</div>` : ''}
    ${E.cd ? `<div class="terr-lista"><div class="terr-lista-topo"><strong>Escolas de ${esc(X.NOME_MUN.get(E.cd) || E.cd)}</strong><button type="button" class="botao" data-camp-ed-cd="">✓ Pronto</button></div>${lista}</div>` : ''}
    <div class="exportar"><button type="button" class="botao" data-camp-ed-salvar ${E.ocupado ? 'disabled' : ''}>${E.ocupado ? '⏳ Salvando…' : '💾 Salvar território'}</button><button type="button" class="botao secundario" data-camp-ed-fechar>Cancelar</button></div>
    ${E.erro ? `<p class="camp-erro" role="alert">${esc(E.erro)}</p>` : ''}
  </section>`
}

/* ---------------- relatório da equipe ---------------- */

// candidato do comitê na eleição de 2026 carregada (B26.els)
function candidatoDoComite(comite) {
  const cand = comite?.candidato
  if (!cand?.cargo) return null
  const el = X.B26.els.get(X.eleicaoDoCargo(cand.cargo))
  if (!el) return { cand, el: null, c: null }
  const c = el.candidatos.find((x) => x.sqcand === cand.sq) || el.candidatos.find((x) => String(x.numero) === String(cand.numero))
  return { cand, el, c }
}

// soma os votos do candidato no território de cada membro (e em 2022 nas mesmas seções)
export function calcularRelatorio(comite, membros) {
  const K = candidatoDoComite(comite)
  if (!K?.el || !K.c) return null
  const { el, c } = K
  const nr = Number(c.numero)
  const p22 = X.PREF.mostrar2022 && X.H22.resumo ? X.achar2022(c).filter((p) => p.el.turno === 1).sort((x, y) => (y.el.cargo === el.cargo) - (x.el.cargo === el.cargo))[0] : null
  if (X.PREF.mostrar2022 && !X.H22.resumo) X.resumo2022().then(re).catch(() => {})
  const linhas = []
  let faltam = 0
  const porSecao = new Map() // "cd|z-s" → [membro…]
  const arqs = new Map()
  for (const m of membros) {
    const t = m.territorio
    if (!m.ativo || !t || !nLocais(t)) continue
    const T = X.somaTerr(2026, el.id, el.cargo, nr, el.anul, re, t.itens)
    const T22 = p22 ? X.somaTerr(2022, p22.el.id, p22.el.cargo, Number(p22.c.numero), p22.el.anul, re, t.itens) : null
    faltam += T.faltam
    for (const cd of new Set(Object.keys(t.itens).map((k) => k.split('|')[0]))) {
      const arq = X.secoesAno(2026, cd, re)
      if (!arq) continue
      arqs.set(cd, arq)
      for (const [zs, loc] of Object.entries(arq.secoes)) {
        const it = t.itens[`${cd}|${loc}`]
        if (it && (!it.length || it.includes(zs))) porSecao.set(`${cd}|${zs}`, [...(porSecao.get(`${cd}|${zs}`) || []), m])
      }
    }
    linhas.push({ m, T, T22, votos: T.focoTot, v22: T22?.focoTot ?? null, pctVal: X.pctDe(T.focoTot, T.validos), meta: t.meta || 0, locais: T.porLocal.size, secoes: nSecoes(t, arqs), coordenador: m.papel === 'cabo' ? membros.find((x) => x.id === m.coordenadorId) : null })
  }
  // seções únicas da equipe: votos do candidato sem contar duas vezes
  let unicos = 0, sobrepostas = []
  for (const [k, ms] of porSecao) {
    const [cd, zs] = k.split('|')
    const arr = arqs.get(cd)?.votos[el.id]?.[zs]
    if (arr) for (let i = 0; i < arr.length; i += 2) if (arr[i] === nr) unicos += arr[i + 1]
    if (ms.length > 1) sobrepostas.push({ cd, zs, local: X.tituloLocal((arqs.get(cd)?.locais[arqs.get(cd)?.secoes[zs]] || [''])[0]), quem: ms.map((m) => m.nome) })
  }
  const porCoord = new Map()
  for (const l of linhas) {
    const k = l.m.papel === 'cabo' ? l.m.coordenadorId || 0 : l.m.id
    const g = porCoord.get(k) || { chefe: k ? membros.find((x) => x.id === k) : null, votos: 0, meta: 0, pessoas: 0, v22: 0 }
    g.votos += l.votos
    g.meta += l.meta
    g.v22 += l.v22 || 0
    g.pessoas++
    porCoord.set(k, g)
  }
  return { el, c, p22, linhas, faltam, unicos, sobrepostas, porCoord: [...porCoord.values()].sort((a, b) => b.votos - a.votos), totalSC: c.votos, somaBruta: linhas.reduce((a, l) => a + l.votos, 0), somaMeta: linhas.reduce((a, l) => a + l.meta, 0) }
}

const COR_META = (p) => (p >= 100 ? '#0b7a45' : p >= 70 ? '#e08600' : '#c62828')

function cardRelatorio(comite, membros) {
  if (!limitesDoPlano().relatorioEquipe) return `<section class="cartao"><h3>📊 Relatório de votos por liderança</h3><p class="nota">Quantos votos cada coordenador e cabo eleitoral entregou nas escolas e seções que marcou, com meta, 2022 e sobreposições. Disponível a partir do plano <strong>Completo</strong>.</p>${souAdmin() ? '<button type="button" class="botao" data-camp-vis="plano">💳 Ver planos</button>' : ''}</section>`
  const K = candidatoDoComite(comite)
  if (!K) return `<section class="cartao"><h3>📊 Relatório de votos por liderança</h3><p class="nota">Escolha o candidato do comitê para ver quantos votos cada coordenador e cabo eleitoral entregou.</p></section>`
  if (!K.el) {
    X.carregarEleicao(K.cand.cargo).then(re).catch(() => {})
    return X.esqueleto('Carregando os candidatos…')
  }
  if (!K.c) return `<section class="cartao"><h3>📊 Relatório de votos por liderança</h3><p class="nota">Não achei ${esc(K.cand.nome)} entre os candidatos de 2026. Troque o candidato do comitê.</p></section>`
  const R = calcularRelatorio(comite, membros)
  if (!R.linhas.length) return `<section class="cartao"><h3>📊 ${esc(R.c.nome)}: votos por liderança</h3><p class="nota">Ninguém da equipe marcou território ainda. Cada pessoa marca em 🏘️ Bairros → 📍 Meu território; o comitê pode marcar pelo botão "Território" na lista acima.</p></section>`
  const ord = CAMP.ordem
  const ls = [...R.linhas].sort((a, b) => (ord === 'pct' ? b.pctVal - a.pctVal : ord === 'meta' ? (b.meta ? b.votos / b.meta : -1) - (a.meta ? a.votos / a.meta : -1) : ord === 'cresc' ? (b.v22 ? b.votos / b.v22 : 0) - (a.v22 ? a.votos / a.v22 : 0) : b.votos - a.votos))
  const cor = X.corPartido(R.c.cor || R.c.partido)
  const ano22 = R.p22 ? `${X.ROTULO_ELEICAO[R.p22.el.id] || '2022'}` : ''
  const pTot = R.somaMeta ? (100 * R.somaBruta) / R.somaMeta : 0
  const linha = (l) => {
    const p = l.meta ? (100 * l.votos) / l.meta : 0
    return `<div class="cmp-linha"><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(l.m.nome)}</strong> <span class="mudo">· ${esc(PAPEL[l.m.papel])}${l.coordenador ? ` · ${esc(l.coordenador.nome)}` : ''}</span></div><strong class="cmp-total">${fmt(l.votos)}</strong></div>
      <div class="cand-meta">${pct(l.votos, l.T.validos)}% dos válidos · ${l.T.pos ? `${l.T.pos}º de ${l.T.n}` : '–'} · ${l.locais} locais, ${l.secoes} seções · ${pct(l.votos, R.totalSC)}% do total em SC${l.v22 != null ? ` · ${ano22}: ${fmt(l.v22)} ${X.variacao(l.votos, l.v22)?.txt || ''}` : ''}${l.meta ? ` · meta ${fmt(l.meta)} <span style="color:${COR_META(p)}">(${X.fmtPct.format(p)}%)</span>` : ''}</div>
      ${l.meta ? `<div class="barra fina"><span style="width:${Math.min(100, p)}%;background:${COR_META(p)}"></span></div>` : ''}</div>`
  }
  const cab = ['Liderança', 'Papel', 'Coordenador', 'Locais', 'Seções', `${R.c.nome} 2026`, '% dos válidos', 'Posição', '% do total SC', ...(R.p22 ? [ano22, 'Variação %'] : []), 'Meta', 'Meta atingida %']
  const linhasX = ls.map((l) => [l.m.nome, PAPEL[l.m.papel], l.coordenador?.nome || '', l.locais, l.secoes, l.votos, X.pctDe(l.votos, l.T.validos), l.T.pos || '', X.pctDe(l.votos, R.totalSC), ...(R.p22 ? [l.v22 ?? 0, l.v22 ? (100 * (l.votos - l.v22)) / l.v22 : ''] : []), l.meta || '', l.meta ? (100 * l.votos) / l.meta : ''])
  const secLinhas = []
  for (const l of ls) for (const g of l.T.porLocal.values()) secLinhas.push([l.m.nome, X.NOME_MUN.get(g.cd) || g.cd, g.nome, g.bairro, g.secoes, g.foco, X.pctDe(g.foco, g.validos)])
  CAMP.exportar = {
    abas: [
      { aba: 'Lideranças', cab, linhas: linhasX },
      { aba: 'Coordenadores', cab: ['Coordenador', 'Pessoas', 'Votos', ...(R.p22 ? [ano22] : []), 'Meta'], linhas: R.porCoord.map((g) => [g.chefe?.nome || 'Sem coordenador', g.pessoas, g.votos, ...(R.p22 ? [g.v22] : []), g.meta || '']) },
      { aba: 'Locais', cab: ['Liderança', 'Município', 'Local', 'Bairro', 'Seções', `${R.c.nome} 2026`, '% do local'], linhas: secLinhas },
      { aba: 'Sobreposições', cab: ['Município', 'Zona-Seção', 'Local', 'Marcada por'], linhas: R.sobrepostas.map((s) => [X.NOME_MUN.get(s.cd) || s.cd, s.zs, s.local, s.quem.join(', ')]) },
    ],
    nome: `equipe-${X.nomeArquivo(comite?.nome || 'comite')}-${X.nomeArquivo(R.c.nome)}`,
    cards: cardsRelatorio(R, ls, comite),
  }
  return `<section class="cartao camp-rel" style="${X.estiloCor(cor)}"><h3>📊 ${esc(R.c.nome)}: votos por liderança</h3>
    <div class="fav-nums">
      <div><span class="fav-rot">Equipe (seções únicas)</span><strong>${fmt(R.unicos)}</strong><span class="mudo">${pct(R.unicos, R.totalSC)}% dos ${fmt(R.totalSC)} em SC</span></div>
      <div><span class="fav-rot">Soma das lideranças</span><strong>${fmt(R.somaBruta)}</strong><span class="mudo">${R.sobrepostas.length ? `${R.sobrepostas.length} seções em 2+ territórios` : 'sem sobreposição'}</span></div>
      <div><span class="fav-rot">Meta da equipe</span><strong>${R.somaMeta ? `${X.fmtPct.format(pTot)}%` : '–'}</strong><span class="mudo">${R.somaMeta ? `${fmt(R.somaBruta)} de ${fmt(R.somaMeta)}` : 'sem metas'}</span></div>
    </div>
    ${R.faltam ? '<p class="nota">Carregando as seções de alguns municípios…</p>' : ''}
    <div class="segmentado" role="group" aria-label="Ordem">${[['votos', 'Mais votos'], ['pct', 'Maior %'], ...(R.p22 ? [['cresc', 'Mais cresceu']] : []), ['meta', '% da meta']].map(([k, t]) => `<button type="button" data-camp-ordem="${k}" aria-pressed="${ord === k}">${t}</button>`).join('')}</div>
    <div class="cmp-lista">${ls.map(linha).join('')}</div>
    <h4>Por coordenador</h4>
    <div class="cmp-lista">${R.porCoord.map((g) => `<div class="cmp-linha"><div class="cmp-topo"><div class="cmp-nome"><strong>${esc(g.chefe?.nome || 'Sem coordenador')}</strong> <span class="mudo">· ${g.pessoas} ${g.pessoas === 1 ? 'pessoa' : 'pessoas'}</span></div><strong class="cmp-total">${fmt(g.votos)}</strong></div><div class="cand-meta">${pct(g.votos, R.totalSC)}% do total em SC${R.p22 ? ` · ${ano22}: ${fmt(g.v22)}` : ''}${g.meta ? ` · meta ${fmt(g.meta)} (${X.fmtPct.format((100 * g.votos) / g.meta)}%)` : ''}</div></div>`).join('')}</div>
    ${R.sobrepostas.length ? `<details class="camp-sobre"><summary>⚠️ ${R.sobrepostas.length} seções marcadas por mais de uma pessoa (contadas para cada uma)</summary><div class="camp-lista">${R.sobrepostas.slice(0, 60).map((s) => `<div class="camp-item"><div>${esc(X.NOME_MUN.get(s.cd) || s.cd)} · ${Number(s.zs.split('-')[0])}ª zona, seção ${s.zs.split('-')[1]} <span class="mudo">· ${esc(s.local)}</span></div><div class="mudo">${esc(s.quem.join(', '))}</div></div>`).join('')}${R.sobrepostas.length > 60 ? `<p class="nota">… e mais ${R.sobrepostas.length - 60} (todas no Excel).</p>` : ''}</div></details>` : ''}
    <div class="exportar">${X.botaoCard('equipe', CAMP.exportar.cards[0])}<button type="button" class="botao secundario" data-camp-xlsx>${X.icone('baixar')} Excel</button><button type="button" class="botao secundario" data-camp-pdf>${X.icone('baixar')} Relatório em PDF</button></div>
    <p class="nota">Votos "entregues" = votos de ${esc(R.c.nome)} nas urnas das escolas e seções marcadas por cada pessoa (boletins de urna do TSE). O voto é secreto: é uma medida do território, não de quem convenceu quem.</p>
  </section>`
}

function cardsRelatorio(R, ls, comite) {
  const cor = X.corPartido(R.c.partido)
  const max = Math.max(1, ...ls.slice(0, 8).map((l) => Math.max(l.votos, l.v22 || 0)))
  const base = { turno: 1, foto: R.c.foto, nome: R.c.nome, cor, sub: `${R.c.partido} · nº ${R.c.numero} · ${X.ROTULO_26[R.el.id] || ''}` }
  const capa = {
    ...base,
    titulo: `Equipe · ${comite?.nome || 'Comitê'}`, subtitulo: `${ls.length} lideranças · ${fmt(R.unicos)} votos nas seções da equipe (${pct(R.unicos, R.totalSC)}% do total)`,
    tiles: [{ rot: 'Votos da equipe', valor: fmt(R.unicos), sub: `${pct(R.unicos, R.totalSC)}% dos ${fmt(R.totalSC)} em SC`, cor }, ...(R.somaMeta ? [{ rot: 'Meta da equipe', valor: `${X.fmtPct.format((100 * R.somaBruta) / R.somaMeta)}%`, sub: `${fmt(R.somaBruta)} de ${fmt(R.somaMeta)}`, cor: COR_META((100 * R.somaBruta) / R.somaMeta) }] : [{ rot: 'Lideranças', valor: String(ls.length), sub: `${R.porCoord.length} coordenações`, cor: '#6b7570' }])],
    total: { ...X.totalCard('Votos nas seções da equipe', R.unicos, null), quem: R.c.nome },
    linhas: ls.slice(0, 8).map((l) => (R.p22 ? { nome: l.m.nome, extra: PAPEL[l.m.papel], par: { v22: l.v22 || 0, v26: l.votos, max }, dir2: X.variacao(l.votos, l.v22 || 0)?.txt || '', corDir2: X.COR_VAR[X.variacao(l.votos, l.v22 || 0)?.cls] } : { nome: l.m.nome, extra: PAPEL[l.m.papel], valor: fmt(l.votos), dir2: `${pct(l.votos, l.T.validos)}%`, frac: l.votos / max, corBarra: cor })),
    rodape: `${fmt(R.unicos)} votos entregues pela equipe para ${R.c.nome}`,
  }
  const porCoord = R.porCoord.map((g) => {
    const minhas = ls.filter((l) => (l.m.papel === 'cabo' ? l.m.coordenadorId || 0 : l.m.id) === (g.chefe?.id || 0))
    const mx = Math.max(1, ...minhas.slice(0, 10).map((l) => l.votos))
    return { ...base, titulo: g.chefe?.nome || 'Sem coordenador', subtitulo: `${g.pessoas} ${g.pessoas === 1 ? 'pessoa' : 'pessoas'} · ${fmt(g.votos)} votos${g.meta ? ` · meta ${fmt(g.meta)}` : ''}`,
      tiles: [{ rot: 'Votos', valor: fmt(g.votos), sub: `${pct(g.votos, R.totalSC)}% do total em SC`, cor }, ...(g.meta ? [{ rot: 'Meta', valor: `${X.fmtPct.format((100 * g.votos) / g.meta)}%`, sub: `${fmt(g.votos)} de ${fmt(g.meta)}`, cor: COR_META((100 * g.votos) / g.meta) }] : [])],
      total: { ...X.totalCard('Votos da coordenação', g.votos, null), quem: R.c.nome },
      linhas: minhas.slice(0, 10).map((l) => ({ nome: l.m.nome, extra: `${l.locais} locais · ${l.secoes} seções`, valor: fmt(l.votos), dir2: `${pct(l.votos, l.T.validos)}%`, frac: l.votos / mx, corBarra: cor })),
      rodape: `Coordenação ${g.chefe?.nome || ''} · ${fmt(g.votos)} votos para ${R.c.nome}` }
  })
  return [capa, ...porCoord]
}

/* ---------------- 🧠 IA ---------------- */

const SUGESTOES = ['Onde o candidato mais cresceu e mais caiu desde 2022? O que isso sugere?', 'Quais bairros de Florianópolis têm maior potencial não aproveitado?', 'Em quais urnas de Joinville ficamos em 2º por pouco?', 'Onde a abstenção foi mais alta nos nossos redutos? Vale mobilização?', 'Monte um relatório para o comitê com o que cada coordenador entregou.', 'Quais municípios da GRANFPOLIS concentram nossos votos? Estamos dependentes de poucos lugares?']

function renderIA() {
  const I = CAMP.ia
  if (I.estado === undefined) {
    I.estado = null
    api.get('/ia/estado').then((e) => ((I.estado = e), re())).catch(() => ((I.estado = { disponivel: false }), re()))
    if (!I.mensagens.length) {
      try {
        const g = JSON.parse(localStorage.getItem('campanha:ia') || 'null')
        if (g?.mensagens?.length) Object.assign(I, { mensagens: g.mensagens, conversaId: g.conversaId || null })
      } catch {}
    }
  }
  const cand = CAMP.sessao.comite?.candidato
  const vista = I.mensagens.map((m, i) => renderMensagem(m, i)).join('')
  return `<section class="cartao ia"><h3>🧠 IA da campanha</h3>
    <p class="nota">Pergunte sobre os dados de votação (município, zona, bairro, escola e seção; 2022 × 2026; abstenção; a equipe) e peça relatórios. A IA consulta os números do TSE que estão no app e as notas da equipe; nunca inventa votos.${cand ? ` Candidato em foco: <strong>${esc(cand.nome)}</strong>.` : ' <strong>Escolha o candidato do comitê</strong> em 👥 Equipe para ela já saber de quem se trata.'}</p>
    ${I.estado && !I.estado.disponivel ? '<div class="aviso camp-aviso">⚠️ A IA não está configurada neste servidor (falta ANTHROPIC_API_KEY no Vercel).</div>' : ''}
    <div class="ia-conversa" id="ia-conversa">${vista || `<div class="ia-vazio"><p>Alguns começos:</p><div class="atalhos-chips">${SUGESTOES.map((s) => `<button type="button" class="atalho" data-ia-sugestao="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}
      ${I.ocupado ? `<div class="ia-msg ia-assistente ia-pensando" role="status">⏳ ${esc(I.passo || 'Pensando…')}</div>` : ''}</div>
    ${I.erro ? `<p class="camp-erro" role="alert">${esc(I.erro)}</p>` : ''}
    <form data-camp-form="ia" class="ia-form"><textarea id="ia-pergunta" rows="2" placeholder="Sua pergunta ou pedido de relatório…" ${I.ocupado ? 'disabled' : ''}>${esc(I.pergunta)}</textarea><button type="submit" class="botao" ${I.ocupado ? 'disabled' : ''}>Enviar</button></form>
    <div class="exportar">${I.mensagens.length ? `<button type="button" class="botao secundario" data-ia-nova>✨ Nova conversa</button>` : ''}<button type="button" class="botao secundario" data-ia-relatorios>📚 Relatórios salvos${I.relatorios ? ` (${I.relatorios.length})` : ''}</button></div>
    ${I.estado?.modelo ? `<p class="nota">Modelo: ${esc(I.estado.modelo)} · até ${I.estado.limiteDia} consultas por pessoa por dia.</p>` : ''}
  </section>${renderRelatoriosSalvos()}`
}

const RESUMO_FERR = { listar_candidatos: 'candidatos', votos_por_municipio: 'votos por município', votos_no_municipio: 'votos no município', bairros_sc: 'bairros de SC', abstencao_no_municipio: 'abstenção', comparar_no_lugar: 'comparação', equipe_territorios: 'território da equipe', buscar_notas: 'notas da equipe', listar_relatorios: 'relatórios salvos' }
function renderMensagem(m, i) {
  if (m.role === 'user') return typeof m.content === 'string' ? `<div class="ia-msg ia-usuario">${esc(m.content)}</div>` : ''
  const blocos = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
  return blocos.map((b, j) => {
    if (b.type === 'text' && b.text?.trim()) return `<div class="ia-msg ia-assistente"><div class="md">${md(b.text)}</div><div class="ia-acoes">${CAMP.ia.salvando?.i === i && CAMP.ia.salvando?.j === j ? `<span class="camp-inline"><input id="ia-titulo" type="text" maxlength="120" value="${esc(CAMP.ia.salvando.titulo)}" placeholder="Título do relatório"> <button type="button" class="link-zonas" data-ia-salvar-ok>Salvar</button> <button type="button" class="link-zonas leve" data-ia-salvar-cancel>✕</button></span>` : `<button type="button" class="link-zonas leve" data-ia-salvar="${i}|${j}">💾 Salvar como relatório</button> <button type="button" class="link-zonas leve" data-ia-copiar="${i}|${j}">📋 Copiar</button>`}</div></div>`
    if (b.type === 'tool_use') return `<div class="ia-ferr">🔎 ${esc(RESUMO_FERR[b.name] || b.name)}${resumoEntrada(b.input)}</div>`
    return ''
  }).join('')
}
const resumoEntrada = (inp) => {
  const p = Object.entries(inp || {}).filter(([k, v]) => v != null && v !== '' && !['limite', 'ordem'].includes(k)).map(([, v]) => (Array.isArray(v) ? v.join(', ') : String(v)))
  return p.length ? ` <span class="mudo">· ${esc(p.join(' · ').slice(0, 90))}</span>` : ''
}

function guardarConversa() {
  const I = CAMP.ia
  try {
    localStorage.setItem('campanha:ia', JSON.stringify({ mensagens: I.mensagens, conversaId: I.conversaId }))
  } catch {}
  const titulo = (I.mensagens.find((m) => m.role === 'user' && typeof m.content === 'string')?.content || 'Conversa').slice(0, 100)
  const salvar = I.conversaId ? api.put(`/ia/conversas/${I.conversaId}`, { mensagens: I.mensagens }) : api.post('/ia/conversas', { titulo, mensagens: I.mensagens }).then((cv) => (I.conversaId = cv.id))
  salvar.catch(() => {})
}

async function perguntar(texto) {
  const I = CAMP.ia
  texto = (texto || '').trim()
  if (!texto || I.ocupado) return
  I.mensagens.push({ role: 'user', content: texto })
  Object.assign(I, { pergunta: '', ocupado: true, erro: '', passo: 'Pensando…' })
  re()
  const cand = CAMP.sessao.comite?.candidato
  const contexto = { comite: CAMP.sessao.comite?.nome || null, candidato: cand ? { nome: cand.nome, partido: cand.partido, numero: String(cand.numero), cargo: X.ROTULO_26[X.eleicaoDoCargo(cand.cargo)] || String(cand.cargo) } : null, turno2: X.INDICE26.has('t2-c3') }
  try {
    for (let rodada = 0; rodada < 12; rodada++) {
      const r = await api.post('/ia/chat', { mensagens: I.mensagens, contexto })
      I.mensagens.push(...(r.mensagensServidor || []))
      I.mensagens.push({ role: 'assistant', content: r.conteudo })
      if (r.parar === 'tool_use' && r.pendentes?.length) {
        I.passo = `Consultando ${r.pendentes.map((t) => RESUMO_FERR[t.name] || t.name).join(', ')}…`
        re()
        const resultados = [...(r.resultadosServidor || [])]
        for (const t of r.pendentes) {
          let content, is_error = false
          try {
            content = JSON.stringify(await executarFerramenta(t.name, t.input))
          } catch (e) {
            content = `Erro: ${e?.message || e}`
            is_error = true
          }
          resultados.push({ type: 'tool_result', tool_use_id: t.id, content, ...(is_error ? { is_error: true } : {}) })
        }
        I.mensagens.push({ role: 'user', content: resultados })
        I.passo = 'Analisando os números…'
        re()
        continue
      }
      if (r.parar === 'max_tokens') I.erro = 'A resposta ficou longa demais e foi cortada. Peça a continuação.'
      if (r.parar === 'refusal') I.erro = `A IA não respondeu a esta pergunta${r.detalhe?.explanation ? `: ${r.detalhe.explanation}` : '.'}`
      break
    }
  } catch (e) {
    I.erro = erroTexto(e)
    avisoPlano(e)
    // a última mensagem do usuário fica para a pessoa tentar de novo
    if (I.mensagens.at(-1)?.role === 'user' && typeof I.mensagens.at(-1).content === 'string') I.pergunta = I.mensagens.pop().content
  } finally {
    I.ocupado = false
    I.passo = ''
    guardarConversa()
    re()
    document.getElementById('ia-conversa')?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }
}

/* ---------------- ferramentas executadas no navegador ---------------- */

const CARGO_DE = (s) => CARGO_ABA[String(s).toLowerCase()] ?? Number(s)
const limitar = (n, pad = 25) => Math.min(Math.max(Number(n) || pad, 1), 80)
function acharMunicipio(nome) {
  const t = X.semAcento(String(nome || '').trim())
  if (!t) throw new Error('Informe o município.')
  const exato = X.MUNICIPIOS_SC.find((m) => X.semAcento(m[2]) === t)
  const m = exato || X.MUNICIPIOS_SC.find((m) => X.semAcento(m[2]).startsWith(t)) || X.MUNICIPIOS_SC.find((m) => X.semAcento(m[2]).includes(t))
  if (!m) throw new Error(`Município "${nome}" não encontrado em SC.`)
  return { cd: m[0], nome: m[2] }
}
async function eleicaoDe(cargo) {
  const cg = CARGO_DE(cargo)
  if (!CARGO_ABA[ABA_CARGO[cg]]) throw new Error('Cargo inválido.')
  return X.carregarEleicao(cg)
}
function candidatoDe(el, numero) {
  const nr = String(numero).trim()
  const c = el.candidatos.find((x) => String(x.numero) === nr)
  if (!c) throw new Error(`Não há candidato nº ${nr} para ${X.ROTULO_26[el.id] || el.id}. Use listar_candidatos.`)
  return c
}
const arquivo = async (caminho) => {
  const p = X.arquivoAno(caminho, () => {})
  const v = await p.catch(() => null)
  if (!v) throw new Error(`Arquivo ${caminho} não disponível.`)
  return v
}
async function secoesDe(cd) {
  const v = await arquivo(`dados2026/secoes/${cd}.json`)
  v.cd = cd
  return v
}
function p22De(c, el) {
  if (!X.H22.resumo) return null
  return X.achar2022(c).filter((p) => p.el.turno === 1).sort((x, y) => (y.el.cargo === el.cargo) - (x.el.cargo === el.cargo))[0] || null
}
const r2 = (x) => Math.round(x * 100) / 100
const nomeTop = (el, nr) => {
  if (nr < 100 && X.ehProp(el.cargo)) return `Legenda ${el.partidos?.[String(nr)] || nr}`
  const c = el.candidatos.find((x) => Number(x.numero) === nr)
  return c ? `${c.nome} (${c.partido})` : `nº ${nr}`
}
function ordenar(linhas, ordem) {
  const o = String(ordem || 'votos')
  const k = o === 'pct' ? (l) => l.pct : o === 'crescimento' ? (l) => (l.variacao_pct ?? -Infinity) : o === 'queda' ? (l) => -(l.variacao_pct ?? Infinity) : o === 'posicao' ? (l) => -(l.posicao || 999) : (l) => l.votos
  return linhas.sort((a, b) => k(b) - k(a))
}

async function executarFerramenta(nome, inp) {
  if (nome === 'listar_candidatos') {
    const el = await eleicaoDe(inp.cargo)
    const t = X.semAcento(inp.busca || '')
    const validos = el.candidatos.reduce((a, c) => a + c.votos, 0)
    const ls = el.candidatos.filter((c) => !t || X.semAcento(`${c.nome} ${c.nomeCompleto || ''} ${c.partido} ${c.numero}`).includes(t)).slice(0, limitar(inp.limite, 30))
    return { cargo: X.ROTULO_26[el.id], validos, candidatos: ls.map((c, i) => ({ numero: String(c.numero), nome: c.nome, partido: c.partido, votos: c.votos, pct: r2(X.pctDe(c.votos, validos)), posicao: el.candidatos.indexOf(c) + 1, situacao: c.situacao || (c.eleito ? 'Eleito' : '') })) }
  }
  if (nome === 'votos_por_municipio') {
    const el = await eleicaoDe(inp.cargo)
    const c = candidatoDe(el, inp.numero)
    const nr = Number(c.numero)
    const M = await arquivo(`dados2026/municipios-${el.id}.json`)
    if (X.PREF.mostrar2022 && !X.H22.resumo) await X.resumo2022().catch(() => {})
    const p22 = p22De(c, el)
    const m22 = p22 ? await X.munAno(2022, p22.el.id).catch(() => null) : null
    const v22 = m22?.cand?.[p22.c.sq] || {}
    const assoc = inp.associacao ? String(inp.associacao).toUpperCase() : null
    const meus = M.c[nr] || {}
    let linhas = Object.keys(M.validos).filter((cd) => !assoc || X.ASSOCIACAO_MUN[cd] === assoc).map((cd) => {
      const v = meus[cd] || 0, a = v22[cd]
      // posição no município: quantos candidatos tiveram mais votos que ele ali
      let pos = null
      if (v) pos = 1 + Object.values(M.c).filter((o) => (o[cd] || 0) > v).length
      return { municipio: X.NOME_MUN.get(cd) || cd, associacao: X.ASSOCIACAO_MUN[cd] || '', votos: v, validos: M.validos[cd], pct: r2(X.pctDe(v, M.validos[cd])), posicao: pos, votos_2022: p22 ? a || 0 : undefined, variacao_pct: p22 && a ? r2((100 * (v - a)) / a) : p22 ? (v ? null : 0) : undefined }
    })
    linhas = ordenar(linhas, inp.ordem).slice(0, limitar(inp.limite))
    return { candidato: `${c.nome} (${c.partido}) nº ${c.numero}`, cargo: X.ROTULO_26[el.id], total_sc: c.votos, posicao_sc: el.candidatos.indexOf(c) + 1, comparacao_2022: p22 ? `${X.ROTULO_ELEICAO[p22.el.id] || '2022'}: ${p22.c.votos} votos` : 'sem participação em 2022 pelo nome', municipios: linhas }
  }
  if (nome === 'votos_no_municipio' || nome === 'abstencao_no_municipio') {
    const el = await eleicaoDe(inp.cargo)
    const c = nome === 'votos_no_municipio' ? candidatoDe(el, inp.numero) : null
    const nr = c ? Number(c.numero) : null
    const { cd, nome: nm } = acharMunicipio(inp.municipio)
    const arq = await secoesDe(cd)
    const nivel = ['zona', 'bairro', 'local', 'secao'].includes(inp.nivel) ? inp.nivel : 'bairro'
    const A = X.agregarSecoes(arq, el, inp.bairro ? { bairro: inp.bairro } : {}, nivel, nr)
    const rot = (g) => (nivel === 'zona' ? `${Number(g.chave)}ª zona` : nivel === 'bairro' ? g.chave : nivel === 'local' ? `${X.tituloLocal((arq.locais[g.chave] || [g.chave])[0])} (${X.bairroDoLocal(arq, g.chave)})` : `Seção ${g.chave.split('-')[1]}, ${Number(g.chave.split('-')[0])}ª zona · ${X.tituloLocal((arq.locais[arq.secoes[g.chave]] || [''])[0])} (${X.bairroDoLocal(arq, arq.secoes[g.chave])})`)
    if (nome === 'abstencao_no_municipio') {
      if (!A.temAp) throw new Error('Este município não tem aptos/comparecimento por seção no app.')
      let linhas = A.grupos.map((g) => ({ lugar: rot(g), aptos: g.aptos, comparecimento: g.comp, ausentes: g.aptos - g.comp, abstencao_pct: r2(X.pctDe(g.aptos - g.comp, g.aptos)), brancos: g.br, nulos: g.nu, brancos_nulos_pct: r2(X.pctDe(g.br + g.nu, g.comp)) }))
      const o = inp.ordem || 'abstencao'
      const k = o === 'ausentes' ? (l) => l.ausentes : o === 'brancos' ? (l) => l.brancos : o === 'nulos' ? (l) => l.nulos : o === 'comparecimento' ? (l) => -l.abstencao_pct : (l) => l.abstencao_pct
      linhas.sort((a, b) => k(b) - k(a))
      return { municipio: nm, cargo: X.ROTULO_26[el.id], nivel, total: { aptos: A.aptos, comparecimento: A.comp, abstencao_pct: r2(X.pctDe(A.aptos - A.comp, A.aptos)), brancos: A.brancos, nulos: A.nulos }, lugares: linhas.slice(0, limitar(inp.limite)) }
    }
    let linhas = A.grupos.map((g) => {
      const pos = X.posicaoNoGrupo(g, nr)
      const top = [...g.top.entries()].sort((a, b) => b[1] - a[1])[0]
      return { lugar: rot(g), votos: g.foco, validos: g.validos, pct: r2(X.pctDe(g.foco, g.validos)), posicao: pos?.p ?? null, concorrentes: pos?.n ?? g.top.size, primeiro: top ? `${nomeTop(el, top[0])}: ${top[1]}` : '', diferenca_para_o_1o: top ? top[1] - g.foco : null, ...(A.temAp ? { aptos: g.aptos, comparecimento: g.comp, abstencao_pct: r2(X.pctDe(g.aptos - g.comp, g.aptos)) } : {}) }
    })
    linhas = ordenar(linhas, inp.ordem).slice(0, limitar(inp.limite))
    const totalMun = A.grupos.reduce((a, g) => a + g.foco, 0)
    return { candidato: `${c.nome} (${c.partido}) nº ${c.numero}`, municipio: nm, nivel, bairro: inp.bairro || null, total_no_municipio: totalMun, validos_no_municipio: A.validos, pct_no_municipio: r2(X.pctDe(totalMun, A.validos)), lugares: linhas }
  }
  if (nome === 'bairros_sc') {
    const el = await eleicaoDe(inp.cargo)
    const c = candidatoDe(el, inp.numero)
    const idx = await arquivo(`dados2026/bairros-${el.id}.json`)
    const x = idx.c[Number(c.numero)]
    if (!x) return { candidato: c.nome, bairros: [] }
    let linhas = x.v.map(([bi, v, v22]) => { const [cd, nome, val] = idx.b[bi]; return { bairro: nome, municipio: X.NOME_MUN.get(cd) || cd, votos: v, validos_bairro: val, pct: r2(X.pctDe(v, val)), votos_2022: x.e22 ? v22 || 0 : undefined, variacao_pct: x.e22 && v22 ? r2((100 * (v - v22)) / v22) : undefined } })
    linhas = ordenar(linhas, inp.ordem).slice(0, limitar(inp.limite))
    return { candidato: `${c.nome} (${c.partido}) nº ${c.numero}`, comparacao_2022: x.e22 ? X.ROTULO_ELEICAO[x.e22] || '2022' : 'sem 2022', bairros_cresceu: x.s?.[0], bairros_caiu: x.s?.[1], bairros: linhas }
  }
  if (nome === 'comparar_no_lugar') {
    const el = await eleicaoDe(inp.cargo)
    const cs = (inp.numeros || []).slice(0, 3).map((n) => candidatoDe(el, n))
    const nrs = cs.map((c) => Number(c.numero))
    const rotulo = (c) => `${c.nome} (${c.partido})`
    let linhas
    if (!inp.municipio) {
      const M = await arquivo(`dados2026/municipios-${el.id}.json`)
      linhas = Object.keys(M.validos).map((cd) => { const vs = nrs.map((nr) => M.c[nr]?.[cd] || 0); const i = vs.indexOf(Math.max(...vs)); return { lugar: X.NOME_MUN.get(cd) || cd, votos: Object.fromEntries(cs.map((c, k) => [rotulo(c), vs[k]])), na_frente: rotulo(cs[i]), diferenca: Math.max(...vs) - [...vs].sort((a, b) => b - a)[1], soma: vs.reduce((a, b) => a + b, 0) } })
    } else {
      const { cd } = acharMunicipio(inp.municipio)
      const arq = await secoesDe(cd)
      const nivel = ['zona', 'bairro', 'local', 'secao'].includes(inp.nivel) ? inp.nivel : 'bairro'
      const A = X.agregarSecoes(arq, el, {}, nivel, null)
      linhas = A.grupos.map((g) => { const vs = nrs.map((nr) => g.top.get(nr) || 0); const i = vs.indexOf(Math.max(...vs)); return { lugar: nivel === 'local' ? X.tituloLocal((arq.locais[g.chave] || [g.chave])[0]) : nivel === 'zona' ? `${Number(g.chave)}ª zona` : g.chave, votos: Object.fromEntries(cs.map((c, k) => [rotulo(c), vs[k]])), na_frente: rotulo(cs[i]), diferenca: Math.max(...vs) - [...vs].sort((a, b) => b - a)[1], soma: vs.reduce((a, b) => a + b, 0) } })
    }
    const placar = Object.fromEntries(cs.map((c) => [rotulo(c), linhas.filter((l) => l.na_frente === rotulo(c) && l.soma).length]))
    linhas.sort((a, b) => (inp.ordem === 'posicao' ? a.diferenca - b.diferenca : b.soma - a.soma))
    return { candidatos: cs.map((c) => ({ nome: rotulo(c), numero: String(c.numero), total_sc: c.votos })), lugares_na_frente: placar, lugares: linhas.slice(0, limitar(inp.limite)) }
  }
  if (nome === 'equipe_territorios') {
    if (!CAMP.equipe) CAMP.equipe = await api.get('/equipe')
    const R = calcularRelatorio(CAMP.equipe.comite, CAMP.equipe.membros)
    if (!R) throw new Error('O comitê ainda não escolheu o candidato (ou os candidatos não carregaram).')
    if (R.faltam) await new Promise((ok) => setTimeout(ok, 1500))
    const R2 = calcularRelatorio(CAMP.equipe.comite, CAMP.equipe.membros)
    return { candidato: `${R2.c.nome} nº ${R2.c.numero}`, total_sc: R2.totalSC, votos_nas_secoes_da_equipe: R2.unicos, soma_por_lideranca: R2.somaBruta, meta_da_equipe: R2.somaMeta, secoes_sobrepostas: R2.sobrepostas.length, carregando_ainda: R2.faltam > 0,
      liderancas: R2.linhas.map((l) => ({ nome: l.m.nome, papel: PAPEL[l.m.papel], coordenador: l.coordenador?.nome || null, locais: l.locais, secoes: l.secoes, votos: l.votos, pct_validos: r2(l.pctVal), posicao: l.T.pos || null, votos_2022_mesmas_secoes: l.v22, meta: l.meta || null, meta_pct: l.meta ? r2((100 * l.votos) / l.meta) : null, melhores_locais: [...l.T.porLocal.values()].sort((a, b) => b.foco - a.foco).slice(0, 5).map((g) => `${g.nome} (${g.bairro}, ${X.NOME_MUN.get(g.cd) || g.cd}): ${g.foco} votos, ${r2(X.pctDe(g.foco, g.validos))}%`) })),
      coordenacoes: R2.porCoord.map((g) => ({ coordenador: g.chefe?.nome || 'sem coordenador', pessoas: g.pessoas, votos: g.votos, meta: g.meta || null })) }
  }
  throw new Error(`Ferramenta desconhecida: ${nome}`)
}

/* ---------------- relatórios salvos ---------------- */

function renderRelatoriosSalvos() {
  const I = CAMP.ia
  if (!I.relatorios) return ''
  const V = I.verRelatorio
  return `<section class="cartao camp-relatorios"><h3>📚 Relatórios salvos</h3>
    ${V ? `<article class="ia-relatorio"><div class="camp-item"><div><strong>${esc(V.titulo)}</strong> <span class="mudo">· ${quando(V.criadoEm)}</span></div><div class="camp-acoes"><button type="button" class="link-zonas" data-ia-rel-copiar>📋 Copiar</button> <button type="button" class="link-zonas" data-ia-rel-baixar>⬇️ Baixar (.md)</button> <button type="button" class="link-zonas leve" data-ia-rel-fechar>✕ Fechar</button></div></div><div class="md">${md(V.conteudo)}</div></article>` : ''}
    ${I.relatorios.length ? `<div class="camp-lista">${I.relatorios.map((r) => `<div class="camp-item"><div><button type="button" class="link-zonas" data-ia-rel-abrir="${r.id}">${esc(r.titulo)}</button> <span class="mudo">· ${quando(r.criadoEm)}${r.autor ? ` · ${esc(r.autor)}` : ''}</span></div><div class="camp-acoes"><button type="button" class="link-zonas leve" data-ia-rel-apagar="${r.id}">✕</button></div></div>`).join('')}</div>` : '<p class="nota">Nenhum relatório salvo ainda. Na conversa, use "Salvar como relatório".</p>'}
  </section>`
}

/* ---------------- notas ---------------- */

function renderNotas() {
  if (!CAMP.notas) {
    api.get('/notas').then((n) => ((CAMP.notas = n), re())).catch((e) => ((CAMP.notas = []), (CAMP.erro = erroTexto(e)), re()))
    return X.esqueleto('Carregando as notas…')
  }
  const N = CAMP.nota
  const eu = CAMP.sessao.usuario
  return `<section class="cartao camp-notas"><h3>📝 Notas de campanha</h3>
    <p class="nota">O que a equipe sabe e os números não mostram: reunião com a associação de moradores, liderança local, demanda de um bairro, compromisso assumido. A 🧠 IA busca nestas notas para cruzar com os votos.</p>
    <form data-camp-form="nota"><input id="nota-lugar" type="text" maxlength="120" value="${esc(N.lugar)}" placeholder="Lugar (município, bairro ou escola) — opcional"><textarea id="nota-texto" rows="3" maxlength="4000" placeholder="A nota…" required>${esc(N.texto)}</textarea><button type="submit" class="botao">Guardar nota</button></form>
    ${CAMP.erro ? `<p class="camp-erro" role="alert">${esc(CAMP.erro)}</p>` : ''}
    ${CAMP.notas.length ? `<div class="camp-lista">${CAMP.notas.map((n) => `<div class="camp-item"><div>${n.lugar ? `<strong>${esc(n.lugar)}</strong> · ` : ''}<span class="mudo">${quando(n.criadaEm)}${n.autor ? ` · ${esc(n.autor)}` : ''}</span><div class="camp-nota-texto">${esc(n.texto)}</div></div>${souAdmin() || n.usuarioId === eu.id ? `<div class="camp-acoes"><button type="button" class="link-zonas leve" data-nota-apagar="${n.id}">✕</button></div>` : ''}</div>`).join('')}</div>` : '<p class="nota">Nenhuma nota ainda.</p>'}
  </section>`
}

/* ---------------- conta ---------------- */

function renderConta() {
  const u = CAMP.sessao.usuario
  const C = CAMP.conta
  const T = X.TERR
  const t = CAMP.sessao.territorio
  return `<section class="cartao camp-conta"><h3>⚙️ Sua conta</h3>
    <form data-camp-form="conta">
      <label>Nome <input id="conta-nome" type="text" maxlength="80" value="${esc(u.nome)}" required></label>
      <label>Usuário <input type="text" value="${esc(u.usuario)}" disabled></label>
      <label>E-mail <input id="conta-email" type="email" maxlength="120" value="${esc(u.email || '')}" required autocomplete="email"></label>
      <label>Telefone <input id="conta-telefone" type="tel" maxlength="30" value="${esc(u.telefone || '')}"></label>
      <label>Papel <input type="text" value="${esc(PAPEL[u.papel])}${u.google ? ' · entra com o Google' : ''}" disabled></label>
      <details><summary>${u.temSenha ? 'Trocar a senha' : 'Criar uma senha (além do Google)'}</summary>${u.temSenha ? '<label>Senha atual <input id="conta-senha-atual" type="password" autocomplete="current-password"></label>' : ''}<label>Senha nova <input id="conta-senha-nova" type="password" minlength="6" autocomplete="new-password"></label></details>
      ${C.msg ? `<p class="nota">${esc(C.msg)}</p>` : ''}
      <button type="submit" class="botao">Salvar</button>
    </form>
  </section>
  <section class="cartao"><h3>📍 Meu território</h3>
    <p class="nota">No aparelho: ${Object.keys(T.itens).length} locais (${esc(T.nome)}). No servidor: ${nLocais(t)} locais${t?.atualizadoEm ? ` · ${quando(t.atualizadoEm)}` : ''}. Marque em 🏘️ Bairros → 📍 Meu território; o app sincroniza sozinho.</p>
    <label class="camp-inline">Minha meta de votos <input id="conta-meta" type="text" inputmode="numeric" value="${t?.meta ? fmt(t.meta) : ''}" placeholder="—"> <button type="button" class="botao secundario" data-camp-meta-salvar>Salvar meta</button></label>
    <div class="exportar"><button type="button" class="botao secundario" data-camp-terr-enviar>⬆️ Enviar o território deste aparelho</button><button type="button" class="botao secundario" data-camp-terr-baixar ${nLocais(t) ? '' : 'disabled'}>⬇️ Usar o território do servidor</button></div>
  </section>
  <section class="cartao"><div class="exportar"><button type="button" class="botao secundario" data-camp-sair>Sair da conta</button></div></section>`
}

/* ---------------- eventos ---------------- */

const numero = (s) => Number(String(s || '').replace(/\D/g, '')) || 0

export function tratarCampanha(h) {
  let x
  if ((x = h('[data-camp-vis]'))) return ((CAMP.vis = x.dataset.campVis), (CAMP.erro = ''), (CAMP.nudge = ''), re(), true)
  if ((x = h('[data-camp-modo]'))) return ((CAMP.form.modo = x.dataset.campModo), (CAMP.form.erro = ''), (CAMP.form.enviado = false), (CAMP.redefinir = ''), re(), true)
  if (h('[data-camp-nudge-fechar]')) return ((CAMP.nudge = ''), re(), true)
  if (h('[data-camp-onb-fechar]')) return (X.gravarLocal('campanha:onb', '1'), re(), true)
  if ((x = h('[data-camp-periodo]'))) return ((CAMP.periodo = x.dataset.campPeriodo), re(), true)
  if ((x = h('[data-camp-checkout]'))) {
    const [plano, periodo] = x.dataset.campCheckout.split('|')
    x.disabled = true
    x.textContent = '⏳ Abrindo o pagamento…'
    api.post('/plano/checkout', { plano, periodo }).then((r) => { if (r?.url) location.href = r.url }).catch((e) => { CAMP.erro = erroTexto(e); re() })
    return true
  }
  if (h('[data-camp-plano-atualizar]')) return ((CAMP.plano = null), (CAMP.pagamento = CAMP.pagamento === 'ok' ? 'ok' : ''), re(), true)
  if ((x = h('[data-camp-plano-cancelar]'))) {
    if (CAMP.confirmar !== 'cancelar') {
      CAMP.confirmar = 'cancelar'
      x.textContent = 'Cancelar mesmo? toque de novo'
      setTimeout(() => (CAMP.confirmar = null), 4000)
      return true
    }
    api.post('/plano/cancelar').then(() => ((CAMP.plano = null), re())).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  if (h('[data-camp-google]') && CAMP.form.modo === 'criar' && !CAMP.form.aceite) {
    CAMP.form.erro = 'Marque o aceite dos termos antes de entrar com o Google.'
    re()
    return true
  }
  if (h('[data-camp-sair]')) return (sair(), true)
  // comitê
  if ((x = h('[data-camp-cand]'))) {
    const v = x.dataset.campCand
    const candidato = v ? (([sq, aba, cargo, numero, nome, partido]) => ({ sq, aba, cargo: Number(cargo), numero, nome, partido }))(v.split('|')) : null
    CAMP.buscaCand = ''
    api.patch('/comite', { candidato }).then((s) => { aplicarSessao(s); CAMP.equipe = null; X.carregar() }).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  if (h('[data-camp-comite-salvar]')) {
    const nome = document.getElementById('camp-comite-nome')?.value.trim()
    if (nome) api.patch('/comite', { nome }).then((s) => { aplicarSessao(s); CAMP.equipe = null; re() }).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  // convites
  if (h('[data-camp-cv-criar]')) {
    const n = CAMP.novoConvite
    const corpo = souAdmin() ? { papel: n.papel, coordenadorId: n.papel === 'cabo' && n.coordenadorId ? Number(n.coordenadorId) : null, maxUsos: Number(n.maxUsos) || 1 } : { papel: 'cabo', maxUsos: Number(n.maxUsos) || 1 }
    api.post('/convites', corpo).then((cv) => ((CAMP.convites = [cv, ...(CAMP.convites || [])]), re())).catch((e) => avisoPlano(e) || ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  if ((x = h('[data-camp-cv-copiar]'))) return (copiar(x.dataset.campCvCopiar, x), true)
  if ((x = h('[data-camp-cv-apagar]'))) {
    api.del(`/convites/${x.dataset.campCvApagar}`).then(() => ((CAMP.convites = CAMP.convites.filter((c) => c.codigo !== x.dataset.campCvApagar)), re())).catch(() => {})
    return true
  }
  // membros
  if ((x = h('[data-camp-editar]'))) {
    const m = CAMP.equipe.membros.find((y) => y.id === Number(x.dataset.campEditar))
    if (m) CAMP.edit = { id: m.id, quem: m.nome, nome: m.territorio?.nome || 'Meu território', itens: JSON.parse(JSON.stringify(m.territorio?.itens || {})), meta: m.territorio?.meta || 0, ref: m.territorio?.ref || null, cd: null, buscaMun: '', abertos: new Set(), ocupado: false, erro: '' }
    re()
    document.querySelector('.camp-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }
  if ((x = h('[data-camp-ativo]'))) {
    const [id, ativo] = x.dataset.campAtivo.split('|')
    api.patch(`/equipe/${id}`, { ativo: ativo === '1' }).then(carregarEquipe).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  if ((x = h('[data-camp-remover]'))) {
    const [id, nome] = x.dataset.campRemover.split('|')
    if (CAMP.confirmar !== id) {
      CAMP.confirmar = id
      x.textContent = `Remover ${nome}? toque de novo`
      setTimeout(() => (CAMP.confirmar = null), 4000)
      return true
    }
    api.del(`/equipe/${id}`).then(carregarEquipe).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  // editor de território
  if ((x = h('[data-camp-ed-cd]')) && CAMP.edit) return ((CAMP.edit.cd = x.dataset.campEdCd || null), (CAMP.edit.buscaMun = ''), re(), true)
  if ((x = h('[data-camp-ed-local]')) && CAMP.edit) {
    const k = x.dataset.campEdLocal
    k in CAMP.edit.itens ? delete CAMP.edit.itens[k] : (CAMP.edit.itens[k] = [])
    return (re(), true)
  }
  if ((x = h('[data-camp-ed-abrir]')) && CAMP.edit) {
    const k = x.dataset.campEdAbrir
    CAMP.edit.abertos.has(k) ? CAMP.edit.abertos.delete(k) : CAMP.edit.abertos.add(k)
    return (re(), true)
  }
  if ((x = h('[data-camp-ed-secao]')) && CAMP.edit) {
    const [cd, loc, zs] = x.dataset.campEdSecao.split('|')
    const k = `${cd}|${loc}`
    const arq = X.secoesAno(2026, cd)
    const todas = arq ? Object.entries(arq.secoes).filter(([, l]) => l === loc).map(([s]) => s) : []
    let sel = k in CAMP.edit.itens ? (CAMP.edit.itens[k].length ? [...CAMP.edit.itens[k]] : [...todas]) : []
    sel = sel.includes(zs) ? sel.filter((s) => s !== zs) : [...sel, zs]
    if (!sel.length) delete CAMP.edit.itens[k]
    else CAMP.edit.itens[k] = sel.length === todas.length ? [] : sel
    return (re(), true)
  }
  if (h('[data-camp-ed-fechar]')) return ((CAMP.edit = null), re(), true)
  if (h('[data-camp-ed-salvar]') && CAMP.edit) {
    const E = CAMP.edit
    E.ocupado = true
    E.erro = ''
    re()
    api.put(`/equipe/${E.id}/territorio`, { nome: E.nome, itens: E.itens, meta: E.meta, ref: E.ref }).then((t) => {
      if (E.id === CAMP.sessao.usuario.id) {
        CAMP.sessao.territorio = t
        X.TERR.itens = t.itens
        X.TERR.nome = t.nome
        X.salvarTerr(true)
      }
      CAMP.edit = null
      return carregarEquipe()
    }).catch((e) => ((E.ocupado = false), avisoPlano(e) || (E.erro = erroTexto(e)), re()))
    return true
  }
  // relatório
  if ((x = h('[data-camp-ordem]'))) return ((CAMP.ordem = x.dataset.campOrdem), re(), true)
  if ((x = h('[data-camp-xlsx]')) && CAMP.exportar) return (X.baixarExcel(`${CAMP.exportar.nome}.xlsx`, CAMP.exportar.abas, x), true)
  if ((x = h('[data-camp-pdf]')) && CAMP.exportar) return (X.gerarPDF(CAMP.exportar.cards, `Equipe ${CAMP.sessao.comite?.nome || ''}`, x), true)
  // conta / território
  if (h('[data-camp-meta-salvar]')) {
    const meta = numero(document.getElementById('conta-meta')?.value)
    const T = X.TERR
    api.put('/territorio', { nome: T.nome, itens: T.itens, meta, ref: T.ref || null }).then((t) => ((CAMP.sessao.territorio = t), (CAMP.conta.msg = 'Meta salva.'), re())).catch((e) => ((CAMP.conta.msg = erroTexto(e)), re()))
    return true
  }
  if (h('[data-camp-terr-enviar]')) return (enviarTerritorio().then(() => ((CAMP.conta.msg = 'Território enviado.'), re())), true)
  if (h('[data-camp-terr-baixar]')) {
    const t = CAMP.sessao.territorio
    if (t?.itens) {
      X.TERR.itens = t.itens
      X.TERR.nome = t.nome || X.TERR.nome
      if (t.ref) X.TERR.ref = t.ref
      X.salvarTerr(true)
      CAMP.conta.msg = 'Território do servidor copiado para este aparelho.'
      re()
    }
    return true
  }
  // IA
  if ((x = h('[data-ia-sugestao]'))) return (perguntar(x.dataset.iaSugestao), true)
  if (h('[data-ia-nova]')) {
    Object.assign(CAMP.ia, { mensagens: [], conversaId: null, erro: '', salvando: null })
    try {
      localStorage.removeItem('campanha:ia')
    } catch {}
    return (re(), true)
  }
  if (h('[data-ia-relatorios]')) {
    api.get('/relatorios').then((r) => ((CAMP.ia.relatorios = r), re())).catch((e) => ((CAMP.ia.erro = erroTexto(e)), re()))
    return true
  }
  if ((x = h('[data-ia-salvar]'))) {
    const [i, j] = x.dataset.iaSalvar.split('|').map(Number)
    const texto = CAMP.ia.mensagens[i]?.content?.[j]?.text || ''
    const titulo = (texto.match(/^#+\s*(.+)$/m)?.[1] || CAMP.ia.mensagens.slice(0, i).reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content || 'Relatório').slice(0, 100)
    CAMP.ia.salvando = { i, j, titulo }
    return (re(), true)
  }
  if (h('[data-ia-salvar-cancel]')) return ((CAMP.ia.salvando = null), re(), true)
  if (h('[data-ia-salvar-ok]') && CAMP.ia.salvando) {
    const { i, j } = CAMP.ia.salvando
    const titulo = document.getElementById('ia-titulo')?.value.trim() || CAMP.ia.salvando.titulo
    const conteudo = CAMP.ia.mensagens[i]?.content?.[j]?.text || ''
    api.post('/relatorios', { titulo, conteudo }).then((r) => { CAMP.ia.salvando = null; CAMP.ia.relatorios = [r, ...(CAMP.ia.relatorios || [])]; re() }).catch((e) => ((CAMP.ia.erro = erroTexto(e)), re()))
    return true
  }
  if ((x = h('[data-ia-copiar]'))) {
    const [i, j] = x.dataset.iaCopiar.split('|').map(Number)
    return (copiar(CAMP.ia.mensagens[i]?.content?.[j]?.text || '', x), true)
  }
  if ((x = h('[data-ia-rel-abrir]'))) {
    api.get(`/relatorios/${x.dataset.iaRelAbrir}`).then((r) => ((CAMP.ia.verRelatorio = r), re())).catch(() => {})
    return true
  }
  if (h('[data-ia-rel-fechar]')) return ((CAMP.ia.verRelatorio = null), re(), true)
  if ((x = h('[data-ia-rel-copiar]'))) return (copiar(CAMP.ia.verRelatorio?.conteudo || '', x), true)
  if (h('[data-ia-rel-baixar]') && CAMP.ia.verRelatorio) {
    const V = CAMP.ia.verRelatorio
    X.baixarArquivo(`${X.nomeArquivo(V.titulo)}.md`, new Blob([`# ${V.titulo}\n\n${V.conteudo}`], { type: 'text/markdown;charset=utf-8' }))
    return true
  }
  if ((x = h('[data-ia-rel-apagar]'))) {
    const id = Number(x.dataset.iaRelApagar)
    api.del(`/relatorios/${id}`).then(() => { CAMP.ia.relatorios = CAMP.ia.relatorios.filter((r) => r.id !== id); if (CAMP.ia.verRelatorio?.id === id) CAMP.ia.verRelatorio = null; re() }).catch(() => {})
    return true
  }
  // notas
  if ((x = h('[data-nota-apagar]'))) {
    const id = Number(x.dataset.notaApagar)
    api.del(`/notas/${id}`).then(() => ((CAMP.notas = CAMP.notas.filter((n) => n.id !== id)), re())).catch(() => {})
    return true
  }
  return false
}

export function submitCampanha(form) {
  const tipo = form.dataset.campForm
  if (tipo === 'entrar') {
    const f = CAMP.form
    Object.assign(f, { nome: form.querySelector('#camp-nome')?.value.trim() || f.nome, usuario: form.querySelector('#camp-usuario')?.value.trim() || f.usuario, email: form.querySelector('#camp-email')?.value.trim() || f.email, senha: form.querySelector('#camp-senha')?.value || '', telefone: form.querySelector('#camp-telefone')?.value.trim() || '', convite: (form.querySelector('#camp-convite')?.value || f.convite || '').trim().toUpperCase(), comite: form.querySelector('#camp-comite')?.value.trim() || '', aceite: form.querySelector('#camp-aceite') ? form.querySelector('#camp-aceite').checked : f.aceite })
    entrar()
    return true
  }
  if (tipo === 'ia') {
    perguntar(form.querySelector('#ia-pergunta')?.value)
    return true
  }
  if (tipo === 'nota') {
    const texto = form.querySelector('#nota-texto')?.value.trim(), lugar = form.querySelector('#nota-lugar')?.value.trim()
    if (!texto) return true
    api.post('/notas', { texto, lugar: lugar || null }).then((n) => { CAMP.notas = [{ ...n, autor: CAMP.sessao.usuario.nome }, ...(CAMP.notas || [])]; CAMP.nota = { texto: '', lugar: '' }; CAMP.erro = ''; re() }).catch((e) => avisoPlano(e) || ((CAMP.erro = erroTexto(e)), re()))
    return true
  }
  if (tipo === 'conta') {
    const corpo = { nome: form.querySelector('#conta-nome')?.value.trim(), email: form.querySelector('#conta-email')?.value.trim() || undefined, telefone: form.querySelector('#conta-telefone')?.value.trim() || null }
    const atual = form.querySelector('#conta-senha-atual')?.value, nova = form.querySelector('#conta-senha-nova')?.value
    if (nova) corpo.senha = { atual, nova }
    api.patch('/me', corpo).then((s) => { aplicarSessao(s); CAMP.conta = { senhaAtual: '', senhaNova: '', msg: 'Salvo.' }; CAMP.equipe = null; re() }).catch((e) => ((CAMP.conta.msg = erroTexto(e)), re()))
    return true
  }
  return false
}

// campos que só guardam o valor (sem redesenhar) e campos de busca (redesenham)
export function inputCampanha(alvo) {
  const id = alvo.id || ''
  const v = alvo.value
  if (id === 'camp-cand-busca') return ((CAMP.buscaCand = v), re())
  if (id === 'camp-ed-mun' && CAMP.edit) return ((CAMP.edit.buscaMun = v), re())
  if (id === 'camp-ed-nome' && CAMP.edit) return void (CAMP.edit.nome = v.trim() || 'Meu território')
  if (id === 'camp-ed-meta' && CAMP.edit) return void (CAMP.edit.meta = numero(v))
  if (id === 'camp-cv-papel') return ((CAMP.novoConvite.papel = v), re())
  if (id === 'camp-cv-coord') return void (CAMP.novoConvite.coordenadorId = v)
  if (id === 'camp-cv-usos') return void (CAMP.novoConvite.maxUsos = Number(v) || 1)
  if (id === 'ia-pergunta') return void (CAMP.ia.pergunta = v)
  if (id === 'ia-titulo' && CAMP.ia.salvando) return void (CAMP.ia.salvando.titulo = v)
  if (id === 'nota-texto') return void (CAMP.nota.texto = v)
  if (id === 'nota-lugar') return void (CAMP.nota.lugar = v)
  if (id === 'camp-nome') return void (CAMP.form.nome = v)
  if (id === 'camp-usuario') return void (CAMP.form.usuario = v)
  if (id === 'camp-senha') return void (CAMP.form.senha = v)
  if (id === 'camp-telefone') return void (CAMP.form.telefone = v)
  if (id === 'camp-convite') return void (CAMP.form.convite = v.toUpperCase())
  if (id === 'camp-comite') return void (CAMP.form.comite = v)
  if (id === 'camp-email') return void (CAMP.form.email = v)
  if (id === 'camp-aceite') return void (CAMP.form.aceite = !!alvo.checked)
  if (alvo.dataset?.campPapel) return void api.patch(`/equipe/${alvo.dataset.campPapel}`, { papel: v }).then(carregarEquipe).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
  if (alvo.dataset?.campCoord) return void api.patch(`/equipe/${alvo.dataset.campCoord}`, { coordenadorId: v ? Number(v) : null }).then(carregarEquipe).catch((e) => ((CAMP.erro = erroTexto(e)), re()))
}

// ids de campos cujo foco deve ser preservado ao redesenhar
export const CAMPOS_CAMPANHA = ['camp-cand-busca', 'camp-ed-mun', 'camp-ed-nome', 'camp-ed-meta', 'ia-pergunta', 'ia-titulo', 'nota-texto', 'nota-lugar', 'camp-nome', 'camp-usuario', 'camp-email', 'camp-senha', 'camp-telefone', 'camp-convite', 'camp-comite', 'camp-aceite', 'camp-comite-nome', 'conta-meta', 'conta-nome', 'conta-email', 'conta-telefone']

// link direto: #campanha?v=ia&convite=ABCD1234 · retorno do Google: ?codigo=… ou ?erro=google&motivo=… ·
// redefinição de senha: ?redefinir=<token> · retorno do pagamento: ?v=plano&pagamento=ok|pendente|erro
// (os parâmetros de uso único somem do endereço logo depois de lidos)
export const paramsCampanha = () => ({ v: CAMP.vis !== 'equipe' ? CAMP.vis : null })
const MOTIVOS = { estado: 'O login com o Google expirou. Tente de novo.', google: 'O Google não confirmou o login. Tente de novo.', email: 'A conta Google precisa ter um e-mail verificado.', convite: 'Convite inválido, vencido ou já usado. Peça outro ao coordenador.', plano: 'O comitê do convite não tem vaga no plano atual.', inativo: 'Esta conta foi desativada pelo comitê.', parametros: 'Não consegui concluir o login com o Google.' }
export function aplicarParamsCampanha(p) {
  const v = p.get('v')
  if (['equipe', 'ia', 'notas', 'plano', 'conta'].includes(v)) CAMP.vis = v
  const cv = p.get('convite')
  if (cv) {
    CAMP.convite = cv.toUpperCase()
    CAMP.form.convite = CAMP.convite
    if (CAMP.form.modo === 'entrar') CAMP.form.modo = 'criar'
  }
  if (p.get('codigo')) {
    CAMP.codigoLogin = p.get('codigo')
    CAMP.sessao = undefined
  }
  if (p.get('redefinir')) {
    CAMP.redefinir = p.get('redefinir')
    CAMP.form.modo = 'redefinir'
  }
  if (p.get('pagamento')) {
    CAMP.pagamento = p.get('pagamento')
    CAMP.vis = 'plano'
    CAMP.plano = null
  }
  if (p.get('erro') === 'google') CAMP.form.erro = MOTIVOS[p.get('motivo')] || MOTIVOS.parametros
  if (p.get('erro') === 'aceite') {
    CAMP.form.modo = 'criar'
    CAMP.form.erro = 'Para criar a conta com o Google, marque o aceite dos termos e toque de novo em "Entrar com Google".'
  }
}

async function copiar(texto, botao) {
  try {
    await navigator.clipboard.writeText(texto)
    if (botao) {
      const antes = botao.innerHTML
      botao.innerHTML = '✓ Copiado!'
      setTimeout(() => (botao.innerHTML = antes), 2000)
    }
  } catch {
    window.prompt('Copie:', texto)
  }
}

/* ---------------- Markdown (subconjunto: títulos, listas, tabelas, negrito, itálico, código) ---------------- */

export function md(texto) {
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  const linhas = String(texto || '').replace(/\r/g, '').split('\n')
  const out = []
  let i = 0
  while (i < linhas.length) {
    const l = linhas[i]
    if (!l.trim()) {
      i++
      continue
    }
    const h = l.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const n = Math.min(h[1].length + 2, 6)
      out.push(`<h${n}>${inline(h[2])}</h${n}>`)
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] || '')) {
      const cel = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const cab = cel(l)
      i += 2
      const corpo = []
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) corpo.push(cel(linhas[i++]))
      const num = (c) => /^[\d.,%+\-–−\s]+$/.test(c) && /\d/.test(c)
      out.push(`<div class="md-tabela"><table class="tabela"><thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${corpo.map((r) => `<tr>${r.map((c) => `<td class="${num(c) ? 'dir' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ord = /^\s*\d+[.)]/.test(l)
      const itens = []
      while (i < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) {
        let t = linhas[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')
        i++
        while (i < linhas.length && /^\s{2,}\S/.test(linhas[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) t += ' ' + linhas[i++].trim()
        itens.push(`<li>${inline(t)}</li>`)
      }
      out.push(`<${ord ? 'ol' : 'ul'}>${itens.join('')}</${ord ? 'ol' : 'ul'}>`)
      continue
    }
    if (/^\s*>\s?/.test(l)) {
      const q = []
      while (i < linhas.length && /^\s*>\s?/.test(linhas[i])) q.push(linhas[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push('<hr>')
      i++
      continue
    }
    const p = []
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,6}\s|\s*([-*•]|\d+[.)])\s|\s*\||\s*>)/.test(linhas[i])) p.push(linhas[i++])
    if (p.length) out.push(`<p>${inline(p.join(' '))}</p>`)
    else i++
  }
  return out.join('')
}
