// npm run test:api — a API inteira contra um Postgres de verdade (PGlite em memória, migrações de drizzle/):
// contas, papéis, convites, limites do plano, IA, notas, território, recuperação de senha, Google e Mercado Pago.
// As variáveis de ambiente são definidas ANTES de importar o app (o banco é um singleton por processo).
process.env.BANCO_LOCAL_PASTA = 'memory://'
delete process.env.DATABASE_URL
delete process.env.VERCEL
process.env.NODE_ENV = 'test'
process.env.APP_URL = 'http://localhost:5173'
process.env.ANTHROPIC_API_KEY = 'teste'
process.env.PRO_CHAVE = 'Y2hhdmUtZGUtdGVzdGU='
process.env.MP_ACCESS_TOKEN = 'TEST-x'
process.env.MP_WEBHOOK_SECRET = 'segredo-do-webhook'
process.env.GOOGLE_CLIENT_ID = 'id-google'
process.env.GOOGLE_CLIENT_SECRET = 'segredo-google'
delete process.env.RESEND_API_KEY

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'

const { app } = await import('./app.ts')
const { db, schema } = await import('./db/index.ts')
const { definirEnvioEmail } = await import('./email.ts')
const { definirFetchMP, assinaturaValida } = await import('./cobranca.ts')
const { definirFetchGoogle } = await import('./google.ts')
const { definirClienteIA } = await import('./ia.ts')

type Resp = { status: number; json: any; headers: Headers }
async function req(metodo: string, rota: string, corpo?: unknown, token?: string, extra: Record<string, string> = {}): Promise<Resp> {
  const r = await app.request(`http://localhost/api${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const txt = await r.text()
  let json: any = null
  try {
    json = txt ? JSON.parse(txt) : null
  } catch {}
  return { status: r.status, json, headers: r.headers }
}

const emails: Array<{ para: string; assunto: string; texto: string }> = []
definirEnvioEmail(async (e) => (emails.push(e), { ok: true, simulado: true }))

let n = 0
const novo = () => `u${Date.now().toString(36)}${++n}`
async function conta(extra: Record<string, unknown> = {}) {
  await db().delete(schema.limites) // os testes criam muitas contas do mesmo IP
  const u = novo()
  const r = await req('POST', '/auth/cadastrar', { nome: `Pessoa ${u}`, usuario: u, email: `${u}@teste.com`, senha: 'segredo123', comite: `Comitê ${u}`, aceite: true, ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return { token: r.json.token as string, usuario: u, comiteId: r.json.comite.id as number, id: r.json.usuario.id as number }
}
async function mudarPlano(comiteId: number, plano: string, planoAte: Date | null = null) {
  await db().update(schema.comites).set({ plano: plano as any, planoAte }).where(eq(schema.comites.id, comiteId))
}

before(async () => {
  const r = await req('GET', '/saude')
  assert.equal(r.status, 200)
  assert.equal(r.json.banco, true)
})

/* ---------------- contas ---------------- */

test('cadastro exige e-mail e aceite; entra por usuário e por e-mail', async () => {
  const u = novo()
  let r = await req('POST', '/auth/cadastrar', { nome: 'Sem aceite', usuario: u, email: `${u}@x.com`, senha: 'segredo123', comite: 'C' })
  assert.equal(r.status, 400)
  r = await req('POST', '/auth/cadastrar', { nome: 'Sem email', usuario: u, senha: 'segredo123', comite: 'C', aceite: true })
  assert.equal(r.status, 400)
  const c = await conta()
  r = await req('POST', '/auth/entrar', { usuario: c.usuario, senha: 'segredo123' })
  assert.equal(r.status, 200)
  assert.equal(r.json.plano.id, 'gratis')
  r = await req('POST', '/auth/entrar', { usuario: `${c.usuario}@teste.com`, senha: 'segredo123' })
  assert.equal(r.status, 200)
  r = await req('POST', '/auth/entrar', { usuario: c.usuario, senha: 'errada' })
  assert.equal(r.status, 401)
  r = await req('GET', '/me', undefined, c.token)
  assert.equal(r.status, 200)
  assert.equal(r.json.usuario.papel, 'admin')
  assert.equal(r.json.usuario.email, `${c.usuario}@teste.com`)
  r = await req('GET', '/me')
  assert.equal(r.status, 401)
})

test('papéis: cabo não cria convite; coordenador só convida cabo', async () => {
  const adm = await conta()
  await mudarPlano(adm.comiteId, 'estadual')
  let r = await req('POST', '/convites', { papel: 'coordenador' }, adm.token)
  assert.equal(r.status, 201)
  const cvCoord = r.json.codigo
  const uc = novo()
  r = await req('POST', '/auth/cadastrar', { nome: 'Coord', usuario: uc, email: `${uc}@t.com`, senha: 'segredo123', convite: cvCoord, aceite: true })
  assert.equal(r.status, 201)
  assert.equal(r.json.usuario.papel, 'coordenador')
  const coord = r.json.token
  r = await req('POST', '/convites', { papel: 'coordenador' }, coord)
  assert.equal(r.status, 403)
  r = await req('POST', '/convites', { papel: 'cabo' }, coord)
  assert.equal(r.status, 201)
  const ucabo = novo()
  r = await req('POST', '/auth/cadastrar', { nome: 'Cabo', usuario: ucabo, email: `${ucabo}@t.com`, senha: 'segredo123', convite: r.json.codigo, aceite: true })
  assert.equal(r.status, 201)
  assert.equal(r.json.usuario.papel, 'cabo')
  r = await req('POST', '/convites', { papel: 'cabo' }, r.json.token)
  assert.equal(r.status, 403)
  // convite com 1 uso só serve uma vez
  r = await req('POST', '/convites', { papel: 'cabo', maxUsos: 1 }, adm.token)
  const cv1 = r.json.codigo
  const a = novo(), b = novo()
  const [ra, rb] = await Promise.all([
    req('POST', '/auth/cadastrar', { nome: 'Pessoa A', usuario: a, email: `${a}@t.com`, senha: 'segredo123', convite: cv1, aceite: true }),
    req('POST', '/auth/cadastrar', { nome: 'Pessoa B', usuario: b, email: `${b}@t.com`, senha: 'segredo123', convite: cv1, aceite: true }),
  ])
  assert.deepEqual([ra.status, rb.status].sort(), [201, 400], JSON.stringify([ra.json, rb.json]))
})

/* ---------------- limites do plano ---------------- */

test('plano grátis: 1 pessoa, sem convites; plano completo libera até 10', async () => {
  const adm = await conta()
  let r = await req('POST', '/convites', { papel: 'cabo' }, adm.token)
  assert.equal(r.status, 403)
  assert.equal(r.json.codigo, 'plano')
  await mudarPlano(adm.comiteId, 'completo')
  r = await req('POST', '/convites', { papel: 'cabo', maxUsos: 50 }, adm.token)
  assert.equal(r.status, 201)
  assert.equal(r.json.maxUsos, 9) // 10 pessoas − o admin
  r = await req('GET', '/plano', undefined, adm.token)
  assert.equal(r.json.id, 'completo')
  assert.equal(r.json.limites.pessoas, 10)
  assert.equal(r.json.uso.pessoas, 1)
})

test('plano vencido vira grátis; dentro da carência ainda vale', async () => {
  const adm = await conta()
  await mudarPlano(adm.comiteId, 'premium', new Date(Date.now() - 10 * 86_400_000))
  let r = await req('GET', '/me', undefined, adm.token)
  assert.equal(r.json.plano.id, 'gratis')
  assert.equal(r.json.plano.vencido, true)
  await mudarPlano(adm.comiteId, 'premium', new Date(Date.now() - 1 * 86_400_000))
  r = await req('GET', '/me', undefined, adm.token)
  assert.equal(r.json.plano.id, 'premium')
})

test('notas só em plano que inclui; área Análises entrega a chave só com plano', async () => {
  const adm = await conta()
  let r = await req('POST', '/notas', { texto: 'Reunião no Campeche' }, adm.token)
  assert.equal(r.status, 403)
  assert.equal(r.json.codigo, 'plano')
  r = await req('GET', '/pro/chave', undefined, adm.token)
  assert.equal(r.status, 403)
  await mudarPlano(adm.comiteId, 'completo')
  r = await req('POST', '/notas', { texto: 'Reunião no Campeche', lugar: 'Campeche' }, adm.token)
  assert.equal(r.status, 201)
  r = await req('GET', '/pro/chave', undefined, adm.token)
  assert.equal(r.status, 200)
  assert.equal(r.json.chave, process.env.PRO_CHAVE)
})

test('município: plano municipal cobre 1 município; estadual cobre todos', async () => {
  const adm = await conta()
  await mudarPlano(adm.comiteId, 'essencial')
  let r = await req('PUT', '/territorio', { nome: 'T', itens: { '81051|12-1015': [] } }, adm.token)
  assert.equal(r.status, 200)
  r = await req('PUT', '/territorio', { nome: 'T', itens: { '81051|12-1015': [], '81795|19-1001': [] } }, adm.token)
  assert.equal(r.status, 403)
  assert.equal(r.json.codigo, 'plano')
  await mudarPlano(adm.comiteId, 'estadual')
  r = await req('PUT', '/territorio', { nome: 'T', itens: { '81051|12-1015': [], '81795|19-1001': [] } }, adm.token)
  assert.equal(r.status, 200)
})

test('IA: sem plano 403; com plano conta as consultas do comitê e para no limite', async () => {
  const adm = await conta()
  let r = await req('POST', '/ia/chat', { mensagens: [{ role: 'user', content: 'oi' }] }, adm.token)
  assert.equal(r.status, 403)
  assert.equal(r.json.codigo, 'plano')
  await mudarPlano(adm.comiteId, 'premium') // 30 por dia
  definirClienteIA({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: 'Olá!' }], stop_reason: 'end_turn', model: 'fake', usage: { input_tokens: 1, output_tokens: 1 } }) } } } as any)
  r = await req('GET', '/ia/estado', undefined, adm.token)
  assert.equal(r.json.limiteDia, 30)
  assert.equal(r.json.usadosHoje, 0)
  for (let i = 1; i <= 19; i++) {
    r = await req('POST', '/ia/chat', { mensagens: [{ role: 'user', content: `pergunta ${i}` }] }, adm.token)
    assert.equal(r.status, 200, JSON.stringify(r.json))
  }
  // 20ª no mesmo minuto bate o limite por minuto (20/min): zera a janela para testar o limite do dia
  await db().delete(schema.limites)
  for (let i = 20; i <= 30; i++) {
    r = await req('POST', '/ia/chat', { mensagens: [{ role: 'user', content: `pergunta ${i}` }] }, adm.token)
    assert.equal(r.status, 200)
    if (i % 15 === 0) await db().delete(schema.limites)
  }
  await db().delete(schema.limites)
  r = await req('POST', '/ia/chat', { mensagens: [{ role: 'user', content: 'pergunta 31' }] }, adm.token)
  assert.equal(r.status, 429)
  assert.equal(r.json.codigo, 'plano')
  r = await req('GET', '/ia/estado', undefined, adm.token)
  assert.equal(r.json.usadosHoje, 31)
})

/* ---------------- recuperação de senha ---------------- */

test('recuperar senha: e-mail com link, redefinição entra e invalida o token', async () => {
  const c = await conta()
  emails.length = 0
  let r = await req('POST', '/auth/recuperar', { email: 'ninguem@t.com' })
  assert.equal(r.status, 200)
  assert.equal(emails.length, 0)
  r = await req('POST', '/auth/recuperar', { email: `${c.usuario}@teste.com` })
  assert.equal(r.status, 200)
  assert.equal(emails.length, 1)
  const token = /redefinir=([\w-]+)/.exec(emails[0].texto)?.[1]
  assert.ok(token)
  r = await req('POST', '/auth/redefinir', { token, senha: 'novasenha9' })
  assert.equal(r.status, 200)
  assert.ok(r.json.token)
  r = await req('POST', '/auth/entrar', { usuario: c.usuario, senha: 'novasenha9' })
  assert.equal(r.status, 200)
  r = await req('GET', '/me', undefined, c.token) // sessão antiga caiu
  assert.equal(r.status, 401)
  r = await req('POST', '/auth/redefinir', { token, senha: 'outra12345' })
  assert.equal(r.status, 400)
})

/* ---------------- Google ---------------- */

function googleFalso(perfil: Record<string, unknown>) {
  definirFetchGoogle((async (url: any) => {
    const u = String(url)
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    if (u.includes('userinfo')) return new Response(JSON.stringify(perfil), { status: 200 })
    return new Response('', { status: 404 })
  }) as typeof fetch)
}

async function loginGoogle(perfil: Record<string, unknown>, q = 'aceite=1') {
  googleFalso(perfil)
  const r1 = await app.request(`http://localhost/api/auth/google/iniciar?${q}`, { redirect: 'manual' })
  assert.equal(r1.status, 302)
  const state = new URL(r1.headers.get('location')!).searchParams.get('state')!
  const r2 = await app.request(`http://localhost/api/auth/google/retorno?code=abc&state=${state}`, { redirect: 'manual' })
  assert.equal(r2.status, 302)
  return paramsDaVolta(r2.headers.get('location')!)
}
// "#campanha?codigo=…" → URLSearchParams
const paramsDaVolta = (loc: string) => ({ searchParams: new URLSearchParams(new URL(loc).hash.split('?')[1] || ''), toString: () => loc })

test('Google: cria conta, entra com código de uso único, vincula conta existente pelo e-mail', async () => {
  const sub = `g${Date.now()}`
  let volta = await loginGoogle({ sub, email: `${sub}@gmail.com`, email_verified: true, name: 'Pessoa Google' })
  const codigo = volta.searchParams.get('codigo')
  assert.ok(codigo, volta.toString())
  let r = await req('POST', '/auth/google/trocar', { codigo })
  assert.equal(r.status, 200)
  assert.equal(r.json.usuario.google, true)
  assert.equal(r.json.usuario.temSenha, false)
  assert.equal(r.json.usuario.papel, 'admin')
  r = await req('POST', '/auth/google/trocar', { codigo })
  assert.equal(r.status, 400) // uso único
  r = await req('POST', '/auth/entrar', { usuario: `${sub}@gmail.com`, senha: 'qualquer' })
  assert.equal(r.status, 401)
  assert.match(r.json.erro, /Google/)
  // sem aceite e sem conta: volta pedindo o aceite
  volta = await loginGoogle({ sub: `${sub}b`, email: `${sub}b@gmail.com`, email_verified: true }, 'aceite=0')
  assert.equal(volta.searchParams.get('erro'), 'aceite')
  // conta local existente com o mesmo e-mail: liga ao Google
  const c = await conta()
  volta = await loginGoogle({ sub: `${sub}c`, email: `${c.usuario}@teste.com`, email_verified: true })
  r = await req('POST', '/auth/google/trocar', { codigo: volta.searchParams.get('codigo') })
  assert.equal(r.status, 200)
  assert.equal(r.json.usuario.id, c.id)
  // state não pode ser reaproveitado
  const r3 = await app.request(`http://localhost/api/auth/google/retorno?code=abc&state=inexistente`, { redirect: 'manual' })
  assert.equal(paramsDaVolta(r3.headers.get('location')!).searchParams.get('motivo'), 'estado')
})

/* ---------------- Mercado Pago ---------------- */

test('assinatura do webhook: manifesto id;request-id;ts com HMAC-SHA256', () => {
  const ts = '1704908010'
  const v1 = createHmac('sha256', 'seg').update(`id:abc123;request-id:req-1;ts:${ts};`).digest('hex')
  assert.equal(assinaturaValida(`ts=${ts},v1=${v1}`, 'req-1', 'ABC123', 'seg'), true)
  assert.equal(assinaturaValida(`ts=${ts},v1=${v1}`, 'req-1', 'ABC123', 'outro'), false)
  assert.equal(assinaturaValida(undefined, 'req-1', 'abc', 'seg'), false)
})

function mpFalso(respostas: Record<string, unknown>) {
  definirFetchMP((async (url: any, init?: any) => {
    const u = String(url).replace('https://api.mercadopago.com', '')
    const chave = `${init?.method || 'GET'} ${u.split('?')[0]}`
    const r = respostas[chave]
    if (r === undefined) return new Response(JSON.stringify({ message: `sem resposta falsa para ${chave}` }), { status: 404 })
    return new Response(JSON.stringify(r), { status: 200 })
  }) as typeof fetch)
}

async function webhook(tipo: string, id: string, assinar = true) {
  const ts = String(Math.floor(Date.now() / 1000))
  const v1 = createHmac('sha256', process.env.MP_WEBHOOK_SECRET!).update(`id:${id};request-id:req-x;ts:${ts};`).digest('hex')
  return req('POST', `/cobranca/webhook?type=${tipo}&data.id=${id}`, { type: tipo, action: `${tipo}.updated`, data: { id } }, undefined, assinar ? { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-x' } : { 'x-signature': `ts=${ts},v1=errada`, 'x-request-id': 'req-x' })
}

test('checkout anual cria preferência; webhook de pagamento aprovado ativa o plano por 1 ano (idempotente)', async () => {
  const adm = await conta()
  const ref = `comite:${adm.comiteId}|plano:essencial|periodo:anual`
  mpFalso({
    'POST /checkout/preferences': { id: 'pref-1', init_point: 'https://mp.test/pagar' },
    'GET /v1/payments/111': { id: 111, status: 'approved', external_reference: ref, transaction_amount: 1404, date_approved: new Date().toISOString() },
  })
  let r = await req('POST', '/plano/checkout', { plano: 'essencial', periodo: 'anual' }, adm.token)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.url, 'https://mp.test/pagar')
  r = await webhook('payment', '111', false)
  assert.equal(r.status, 401)
  r = await webhook('payment', '111')
  assert.equal(r.status, 200)
  r = await req('GET', '/plano', undefined, adm.token)
  assert.equal(r.json.id, 'essencial')
  const ate = new Date(r.json.planoAte).getTime()
  assert.ok(ate > Date.now() + 360 * 86_400_000 && ate < Date.now() + 370 * 86_400_000)
  r = await webhook('payment', '111') // de novo: não soma outro ano
  assert.equal(new Date((await req('GET', '/plano', undefined, adm.token)).json.planoAte).getTime(), ate)
  assert.ok(r.json.ok)
  const pags = (await req('GET', '/plano', undefined, adm.token)).json.pagamentos
  assert.ok(pags.some((p: any) => p.mpId === 'pag:111' && p.status === 'aprovado'))
})

test('assinatura mensal: preapproval autorizada ativa; cancelar mantém o acesso até o fim', async () => {
  const adm = await conta()
  const ref = `comite:${adm.comiteId}|plano:premium|periodo:mensal`
  const prox = new Date(Date.now() + 30 * 86_400_000).toISOString()
  mpFalso({
    'POST /preapproval': { id: 'pre-1', init_point: 'https://mp.test/assinar', status: 'pending' },
    'GET /preapproval/pre-1': { id: 'pre-1', status: 'authorized', external_reference: ref, next_payment_date: prox, auto_recurring: { transaction_amount: 25 } },
    'PUT /preapproval/pre-1': { id: 'pre-1', status: 'cancelled' },
  })
  let r = await req('POST', '/plano/checkout', { plano: 'premium', periodo: 'mensal' }, adm.token)
  assert.equal(r.status, 200)
  r = await webhook('subscription_preapproval', 'pre-1')
  assert.equal(r.status, 200)
  r = await req('GET', '/plano', undefined, adm.token)
  assert.equal(r.json.id, 'premium')
  assert.equal(r.json.periodo, 'mensal')
  assert.ok(r.json.assinatura)
  r = await req('POST', '/plano/cancelar', undefined, adm.token)
  assert.equal(r.status, 200)
  r = await req('GET', '/plano', undefined, adm.token)
  assert.equal(r.json.id, 'premium') // até plano_ate
  assert.equal(r.json.assinatura, null)
})

/* ---------------- rate limit ---------------- */

test('muitas tentativas de login do mesmo IP → 429 com Retry-After', async () => {
  const ip = { 'x-forwarded-for': '203.0.113.9' }
  let ultimo = 0
  for (let i = 0; i < 21; i++) {
    const r = await req('POST', '/auth/entrar', { usuario: `fulano${i}`, senha: 'x' }, undefined, ip)
    ultimo = r.status
    if (r.status === 429) {
      assert.ok(r.headers.get('retry-after'))
      assert.equal(r.json.codigo, 'limite')
      break
    }
  }
  assert.equal(ultimo, 429)
})
