// Planos e cobrança pelo Mercado Pago (sem SDK: só fetch).
//
// - Anual: pagamento único pelo Checkout Pro (preferência → init_point). O webhook "payment" confirma.
// - Mensal: assinatura (preapproval → init_point). Os webhooks "subscription_preapproval" e
//   "subscription_authorized_payment" ativam, renovam, pausam ou cancelam.
// - O webhook nunca confia no corpo: reconsulta o recurso no MP pelo id e só então muda o comitê.
//   Idempotente: um registro por id do MP em `pagamentos`; plano_ate nunca encurta.
import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from './db/index.ts'
import { Invalido, Proibido, appUrl, corpo, hojeISO, ipDe, type Vars } from './comum.ts'
import { limitar } from './limites.ts'
import { GARANTIA_DIAS, MARCA, PERIODOS, PLANOS, PLANO_IDS, catalogo, precoBR, type Periodo, type PlanoId } from './planos.ts'
import { comiteDe, contarPessoas, planoDoComite, resumoPlano } from './sessao.ts'

const { comites, iaUsosComite, pagamentos, territorios, usuarios } = schema
const MP = 'https://api.mercadopago.com'

export const temMP = () => !!process.env.MP_ACCESS_TOKEN
export const temChavePro = () => !!process.env.PRO_CHAVE

// fetch injetável (os testes simulam o Mercado Pago)
let fetchMP: typeof fetch = (...a) => fetch(...a)
export const definirFetchMP = (fn: typeof fetch) => (fetchMP = fn)

async function mp<T = Record<string, unknown>>(metodo: 'GET' | 'POST' | 'PUT', rota: string, corpoJson?: unknown): Promise<T> {
  const r = await fetchMP(`${MP}${rota}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(metodo === 'POST' ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}) },
    body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson),
  })
  const j = (await r.json().catch(() => ({}))) as T & { message?: string }
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${j?.message || 'erro'}`)
  return j
}

/* ---------------- catálogo (público) ---------------- */

export const planos = new Hono<{ Variables: Vars }>()
planos.get('/', (c) => c.json({ planos: catalogo(), garantiaDias: GARANTIA_DIAS, pagamento: temMP() ? 'mercadopago' : null }))

/* ---------------- o plano do comitê (login) ---------------- */

export const cobranca = new Hono<{ Variables: Vars }>()

async function usoDoComite(comiteId: number) {
  const [ia] = await db().select({ n: iaUsosComite.n }).from(iaUsosComite).where(and(eq(iaUsosComite.comiteId, comiteId), eq(iaUsosComite.dia, hojeISO())))
  const ids = (await db().select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.comiteId, comiteId))).map((x) => x.id)
  const cds = new Set<string>()
  if (ids.length) {
    const ts = await db().select({ itens: territorios.itens }).from(territorios)
    for (const t of ts) for (const k of Object.keys(t.itens || {})) cds.add(k.split('|')[0])
  }
  return { pessoas: await contarPessoas(comiteId), iaHoje: ia?.n || 0, municipios: cds.size }
}

cobranca.get('/plano', async (c) => {
  const u = c.get('usuario')
  const com = await comiteDe(u.comiteId)
  const P = resumoPlano(com)
  const uso = await usoDoComite(u.comiteId)
  const pags = u.papel === 'admin' ? await db().select().from(pagamentos).where(eq(pagamentos.comiteId, u.comiteId)).orderBy(desc(pagamentos.criadoEm)).limit(30) : []
  return c.json({
    ...P,
    uso,
    assinatura: com?.mpPreapprovalId ? { id: com.mpPreapprovalId } : null,
    pagamentos: pags.map((p) => ({ id: p.id, plano: p.plano, periodo: p.periodo, valor: precoBR(p.valorCentavos), tipo: p.tipo, status: p.status, mpId: p.mpId, criadoEm: p.criadoEm })),
    pagamento: temMP() ? 'mercadopago' : null,
    garantiaDias: GARANTIA_DIAS,
  })
})

// cria o checkout (anual) ou a assinatura (mensal) e devolve a URL do Mercado Pago
cobranca.post('/plano/checkout', async (c) => {
  const u = c.get('usuario')
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) contrata planos.')
  if (!temMP()) return c.json({ erro: 'Pagamento não configurado neste servidor (MP_ACCESS_TOKEN).' }, 503)
  await limitar(`checkout:${u.id}`, 10, 600)
  const d = await corpo(c, z.object({ plano: z.enum(PLANO_IDS).exclude(['gratis']), periodo: z.enum(PERIODOS) }))
  const P = PLANOS[d.plano]
  const valor = P[d.periodo]
  const ref = `comite:${u.comiteId}|plano:${d.plano}|periodo:${d.periodo}`
  const base = `${appUrl()}/#campanha?v=plano`
  const email = u.email || `comite${u.comiteId}@exemplo.com`
  if (d.periodo === 'anual') {
    const pref = await mp<{ id: string; init_point: string; sandbox_init_point?: string }>('POST', '/checkout/preferences', {
      items: [{ id: `${d.plano}-anual`, title: `${MARCA} · ${P.nome} (1 ano)`, description: P.descricao.slice(0, 2).join(' · '), quantity: 1, unit_price: valor / 100, currency_id: 'BRL' }],
      payer: { email },
      external_reference: ref,
      metadata: { comite_id: u.comiteId, plano: d.plano, periodo: 'anual' },
      back_urls: { success: `${base}&pagamento=ok`, pending: `${base}&pagamento=pendente`, failure: `${base}&pagamento=erro` },
      auto_return: 'approved',
      notification_url: `${appUrl()}/api/cobranca/webhook`,
      statement_descriptor: MARCA.toUpperCase().replace(/[^A-Z ]/g, '').slice(0, 22),
      payment_methods: { installments: 12 },
    })
    await db().insert(pagamentos).values({ comiteId: u.comiteId, plano: d.plano, periodo: 'anual', valorCentavos: valor, tipo: 'pagamento', mpId: `pref:${pref.id}`, status: 'pendente', raw: { preferenceId: pref.id } }).onConflictDoNothing()
    return c.json({ url: pref.init_point })
  }
  const pre = await mp<{ id: string; init_point: string; status: string }>('POST', '/preapproval', {
    reason: `${MARCA} · ${P.nome} (mensal)`,
    external_reference: ref,
    payer_email: email,
    back_url: `${base}&pagamento=ok`,
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: valor / 100, currency_id: 'BRL' },
    status: 'pending',
  })
  await db().insert(pagamentos).values({ comiteId: u.comiteId, plano: d.plano, periodo: 'mensal', valorCentavos: valor, tipo: 'assinatura', mpId: `pre:${pre.id}`, status: 'pendente', raw: pre }).onConflictDoNothing()
  return c.json({ url: pre.init_point })
})

// cancela a assinatura mensal (o acesso continua até plano_ate)
cobranca.post('/plano/cancelar', async (c) => {
  const u = c.get('usuario')
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) altera o plano.')
  const com = await comiteDe(u.comiteId)
  if (!com?.mpPreapprovalId) throw new Invalido('Este comitê não tem assinatura mensal ativa.')
  if (temMP()) await mp('PUT', `/preapproval/${com.mpPreapprovalId}`, { status: 'cancelled' })
  await db().update(pagamentos).set({ status: 'cancelado', atualizadoEm: new Date() }).where(eq(pagamentos.mpId, `pre:${com.mpPreapprovalId}`))
  await db().update(comites).set({ mpPreapprovalId: null }).where(eq(comites.id, u.comiteId))
  return c.json({ ok: true, planoAte: com.planoAte })
})

// reconsulta no MP o que estiver pendente para este comitê (quando o webhook ainda não chegou)
cobranca.post('/plano/sincronizar', async (c) => {
  const u = c.get('usuario')
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) altera o plano.')
  await limitar(`sincronizar:${u.id}`, 20, 600)
  if (!temMP()) return c.json(await planoDoComite(u.comiteId))
  const ref = `comite:${u.comiteId}`
  // pagamentos avulsos pela referência externa
  try {
    const busca = await mp<{ results?: Array<{ id: number }> }>('GET', `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(ref)}&limit=10`)
    for (const p of busca.results || []) await aplicarPagamento(String(p.id))
  } catch (e) {
    console.error('sincronizar pagamentos', e)
  }
  // assinatura
  const com = await comiteDe(u.comiteId)
  const pendentes = await db().select().from(pagamentos).where(and(eq(pagamentos.comiteId, u.comiteId), eq(pagamentos.tipo, 'assinatura')))
  for (const p of pendentes) await aplicarPreapproval(p.mpId.replace(/^pre:/, '')).catch((e) => console.error('sincronizar preapproval', e))
  if (com?.mpPreapprovalId) await aplicarPreapproval(com.mpPreapprovalId).catch(() => {})
  return c.json(await planoDoComite(u.comiteId))
})

// chave da área 🔒 Análises para quem tem plano com Análises (o app decifra os pro/*.bin com ela)
cobranca.get('/pro/chave', async (c) => {
  const u = c.get('usuario')
  await limitar(`prochave:${u.id}`, 10, 3600)
  const P = await planoDoComite(u.comiteId)
  if (!P.limites.analises) throw new Proibido(`O plano ${P.nome} não inclui a área Análises. Veja os planos em 💳 Plano.`, 'plano')
  if (!temChavePro()) return c.json({ erro: 'A chave da área protegida não está configurada neste servidor (PRO_CHAVE).' }, 503)
  return c.json({ chave: process.env.PRO_CHAVE })
})

/* ---------------- aplicar pagamentos e assinaturas (webhook e sincronização) ---------------- */

const lerRef = (ref: string | undefined | null) => {
  const m = /comite:(\d+)\|plano:(\w+)\|periodo:(\w+)/.exec(ref || '')
  if (!m || !PLANO_IDS.includes(m[2] as PlanoId) || !PERIODOS.includes(m[3] as Periodo)) return null
  return { comiteId: Number(m[1]), plano: m[2] as PlanoId, periodo: m[3] as Periodo }
}

const somarPeriodo = (de: Date, periodo: Periodo) => {
  const d = new Date(de)
  if (periodo === 'anual') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d
}

// ativa (ou estende) o plano do comitê; plano_ate nunca encurta
async function ativarPlano(comiteId: number, plano: PlanoId, periodo: Periodo, ate: Date, extra: Partial<typeof comites.$inferInsert> = {}) {
  const com = await comiteDe(comiteId)
  if (!com) return
  const atual = com.planoAte ? new Date(com.planoAte) : null
  const novoAte = atual && atual > ate && com.plano === plano ? atual : ate
  await db().update(comites).set({ plano, periodo, planoAte: novoAte, ...extra }).where(eq(comites.id, comiteId))
}

async function registrar(mpId: string, dados: Omit<typeof pagamentos.$inferInsert, 'mpId'>) {
  const [existente] = await db().select().from(pagamentos).where(eq(pagamentos.mpId, mpId))
  if (existente) {
    await db().update(pagamentos).set({ status: dados.status, raw: dados.raw, atualizadoEm: new Date() }).where(eq(pagamentos.mpId, mpId))
    return { anterior: existente.status, novo: dados.status }
  }
  await db().insert(pagamentos).values({ ...dados, mpId })
  return { anterior: null, novo: dados.status }
}

type PagamentoMP = { id: number; status: string; external_reference?: string; transaction_amount?: number; metadata?: Record<string, unknown>; date_approved?: string }
const STATUS_PAG: Record<string, string> = { approved: 'aprovado', pending: 'pendente', in_process: 'pendente', authorized: 'autorizado', rejected: 'recusado', cancelled: 'cancelado', refunded: 'estornado', charged_back: 'estornado' }

export async function aplicarPagamento(id: string) {
  const p = await mp<PagamentoMP>('GET', `/v1/payments/${id}`)
  const ref = lerRef(p.external_reference)
  if (!ref) return null
  const status = STATUS_PAG[p.status] || p.status
  const r = await registrar(`pag:${p.id}`, { comiteId: ref.comiteId, plano: ref.plano, periodo: ref.periodo, valorCentavos: Math.round((p.transaction_amount || 0) * 100), tipo: ref.periodo === 'anual' ? 'pagamento' : 'cobranca', status, raw: p })
  if (status === 'aprovado' && r.anterior !== 'aprovado') {
    const base = p.date_approved ? new Date(p.date_approved) : new Date()
    await ativarPlano(ref.comiteId, ref.plano, ref.periodo, somarPeriodo(base, ref.periodo), { mpUltimoPagamentoId: String(p.id) })
    // a preferência pendente vira paga
    await db().update(pagamentos).set({ status: 'aprovado', atualizadoEm: new Date() }).where(and(eq(pagamentos.comiteId, ref.comiteId), eq(pagamentos.tipo, 'pagamento'), eq(pagamentos.status, 'pendente')))
  }
  return { ref, status }
}

type PreapprovalMP = { id: string; status: string; external_reference?: string; next_payment_date?: string; auto_recurring?: { transaction_amount?: number } }
const STATUS_PRE: Record<string, string> = { authorized: 'autorizado', pending: 'pendente', paused: 'pausado', cancelled: 'cancelado' }

export async function aplicarPreapproval(id: string) {
  const pre = await mp<PreapprovalMP>('GET', `/preapproval/${id}`)
  const ref = lerRef(pre.external_reference)
  if (!ref) return null
  const status = STATUS_PRE[pre.status] || pre.status
  await registrar(`pre:${pre.id}`, { comiteId: ref.comiteId, plano: ref.plano, periodo: 'mensal', valorCentavos: Math.round((pre.auto_recurring?.transaction_amount || 0) * 100), tipo: 'assinatura', status, raw: pre })
  if (status === 'autorizado') {
    const prox = pre.next_payment_date ? new Date(pre.next_payment_date) : somarPeriodo(new Date(), 'mensal')
    await ativarPlano(ref.comiteId, ref.plano, 'mensal', new Date(prox.getTime() + 3 * 86_400_000), { mpPreapprovalId: pre.id })
  } else if (status === 'cancelado' || status === 'pausado') {
    await db().update(comites).set({ mpPreapprovalId: null }).where(and(eq(comites.id, ref.comiteId), eq(comites.mpPreapprovalId, pre.id)))
  }
  return { ref, status }
}

type CobrancaMP = { id: number; status: string; preapproval_id?: string; payment?: { id?: number; status?: string }; debit_date?: string; transaction_amount?: number }
export async function aplicarCobrancaAssinatura(id: string) {
  const cob = await mp<CobrancaMP>('GET', `/authorized_payments/${id}`)
  if (!cob.preapproval_id) return null
  const pre = await mp<PreapprovalMP>('GET', `/preapproval/${cob.preapproval_id}`)
  const ref = lerRef(pre.external_reference)
  if (!ref) return null
  const aprovado = cob.status === 'processed' && (cob.payment?.status || 'approved') === 'approved'
  const r = await registrar(`cob:${cob.id}`, { comiteId: ref.comiteId, plano: ref.plano, periodo: 'mensal', valorCentavos: Math.round((cob.transaction_amount || 0) * 100), tipo: 'cobranca', status: aprovado ? 'aprovado' : cob.status, raw: cob })
  if (aprovado && r.anterior !== 'aprovado') {
    const base = cob.debit_date ? new Date(cob.debit_date) : new Date()
    await ativarPlano(ref.comiteId, ref.plano, 'mensal', new Date(somarPeriodo(base, 'mensal').getTime() + 3 * 86_400_000), { mpPreapprovalId: pre.id })
  }
  return { ref, aprovado }
}

/* ---------------- webhook (público) ---------------- */

// assinatura do Mercado Pago: x-signature "ts=…,v1=…"; manifesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
export function assinaturaValida(xSignature: string | undefined, xRequestId: string | undefined, dataId: string | undefined, segredo: string) {
  if (!xSignature) return false
  const partes = Object.fromEntries(xSignature.split(',').map((p) => p.trim().split('=').map((s) => s.trim())))
  const ts = partes.ts, v1 = partes.v1
  if (!ts || !v1) return false
  let id = dataId || ''
  if (/^[a-zA-Z0-9]+$/.test(id) && /[a-zA-Z]/.test(id)) id = id.toLowerCase()
  const manifesto = `${id ? `id:${id};` : ''}${xRequestId ? `request-id:${xRequestId};` : ''}ts:${ts};`
  const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex')
  return esperado.length === v1.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(v1))
}

export const webhook = new Hono<{ Variables: Vars }>()
webhook.post('/', async (c) => {
  await limitar(`webhook:${ipDe(c)}`, 300, 60)
  const dataId = c.req.query('data.id') || c.req.query('id')
  const segredo = process.env.MP_WEBHOOK_SECRET
  if (segredo) {
    const xs = c.req.header('x-signature')
    if (xs && !assinaturaValida(xs, c.req.header('x-request-id'), dataId, segredo)) return c.json({ erro: 'assinatura inválida' }, 401)
    if (!xs && process.env.NODE_ENV === 'production' && !c.req.query('type')?.startsWith('subscription')) return c.json({ erro: 'sem assinatura' }, 401)
  } else if (process.env.NODE_ENV === 'production') console.warn('webhook do Mercado Pago sem MP_WEBHOOK_SECRET')
  const corpoJson = (await c.req.json().catch(() => ({}))) as { type?: string; action?: string; data?: { id?: string | number } }
  const tipo = c.req.query('type') || c.req.query('topic') || corpoJson.type || ''
  const id = String(corpoJson.data?.id ?? dataId ?? '')
  if (!id || !temMP()) return c.json({ ok: true, ignorado: true })
  try {
    if (tipo === 'payment') await aplicarPagamento(id)
    else if (tipo === 'subscription_preapproval') await aplicarPreapproval(id)
    else if (tipo === 'subscription_authorized_payment') await aplicarCobrancaAssinatura(id)
  } catch (e) {
    console.error('webhook', tipo, id, e)
    // responde 200 mesmo assim: o MP reenvia e a sincronização manual cobre
  }
  return c.json({ ok: true })
})
