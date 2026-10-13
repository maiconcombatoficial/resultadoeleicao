// API da campanha (Hono). Roda no Vercel (api/index.ts) e no desenvolvimento local (server/dev.ts).
//
// Papéis: admin (o comitê), coordenador (responde ao comitê, tem cabos) e cabo (cabo eleitoral).
// Autenticação: "Authorization: Bearer <token>" (token de sessão criado em /api/auth/entrar ou /cadastrar).
// Respostas de erro: { erro: "mensagem em português" }.
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema, temBanco } from './db/index.ts'
import { DIAS_CONVITE, DIAS_SESSAO, conferirSenha, daquiA, gerarHash, hashToken, novoCodigo, novoToken } from './auth.ts'
import type { Candidato, Itens, Papel, Usuario } from './db/schema.ts'
import { Invalido, Proibido, corpo, type Vars } from './comum.ts'
import { ia, temIA } from './ia.ts'

const { comites, convites, notas, relatorios, sessoes, territorios, usuarios } = schema

export const app = new Hono<{ Variables: Vars }>().basePath('/api')

app.use('*', cors({ origin: (o) => o, credentials: false, allowHeaders: ['Authorization', 'Content-Type'] }))
app.notFound((c) => c.json({ erro: 'Rota não encontrada' }, 404))

app.get('/saude', (c) => c.json({ ok: true, banco: temBanco(), ia: temIA(), agora: new Date().toISOString() }))

// sem banco configurado, tudo (menos /saude) responde 503: o app mostra "indisponível" e segue funcionando
app.use('*', async (c, next) => {
  if (c.req.path === '/api/saude' || temBanco()) return next()
  return c.json({ erro: 'Banco de dados não configurado neste servidor.' }, 503)
})

/* ---------------- validação ---------------- */

const zNome = z.string().trim().min(2, 'Nome muito curto').max(80)
const zUsuario = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Usuário: 3 a 40 letras minúsculas, números, ponto, traço ou _')
const zSenha = z.string().min(6, 'Senha com pelo menos 6 caracteres').max(200)
const zPapel = z.enum(schema.PAPEIS)
const zItens = z.record(z.string().regex(/^\d+\|\d+-\d+$/), z.array(z.string().regex(/^\d+-\d+$/)).max(2000)).refine((o) => Object.keys(o).length <= 3000, 'Território grande demais')
const zCandidato = z.object({ sq: z.string().max(20), aba: z.string().max(20), cargo: z.number().int(), numero: z.string().max(6), nome: z.string().max(80), partido: z.string().max(30) })

app.onError((e, c) => {
  if (e instanceof Invalido) return c.json({ erro: e.message }, 400)
  if (e instanceof Proibido) return c.json({ erro: e.message || 'Sem permissão' }, 403)
  console.error(e)
  return c.json({ erro: 'Erro no servidor. Tente de novo em instantes.' }, 500)
})

/* ---------------- sessão ---------------- */

async function usuarioDoToken(token: string | undefined) {
  if (!token) return null
  const [r] = await db()
    .select({ u: usuarios })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashToken(token)), gt(sessoes.expiraEm, new Date())))
    .limit(1)
  return r?.u && r.u.ativo ? r.u : null
}

async function criarSessao(usuarioId: number) {
  const token = novoToken()
  await db().insert(sessoes).values({ tokenHash: hashToken(token), usuarioId, expiraEm: daquiA(DIAS_SESSAO) })
  return token
}

const tokenDe = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '')

// rotas que exigem login (tudo, menos /auth/* e /saude)
app.use('*', async (c, next) => {
  const p = c.req.path
  if (p.startsWith('/api/auth/') || p === '/api/saude') return next()
  const u = await usuarioDoToken(tokenDe(c))
  if (!u) return c.json({ erro: 'Entre para continuar.' }, 401)
  c.set('usuario', u)
  return next()
})

const publico = (u: Usuario) => ({ id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel as Papel, coordenadorId: u.coordenadorId, telefone: u.telefone, ativo: u.ativo, criadoEm: u.criadoEm })

async function sessaoCompleta(u: Usuario) {
  const [com] = await db().select().from(comites).where(eq(comites.id, u.comiteId))
  const [t] = await db().select().from(territorios).where(eq(territorios.usuarioId, u.id))
  return { usuario: publico(u), comite: com ? { id: com.id, nome: com.nome, candidato: com.candidato } : null, territorio: t ?? null }
}

/* ---------------- auth ---------------- */

// cria conta: com convite entra no comitê do convite; sem convite, cria um comitê novo e vira admin dele
app.post('/auth/cadastrar', async (c) => {
  const d = await corpo(c, z.object({ nome: zNome, usuario: zUsuario, senha: zSenha, telefone: z.string().trim().max(30).optional(), convite: z.string().trim().toUpperCase().optional(), comite: z.string().trim().min(2).max(80).optional() }))
  const D = db()
  const [existe] = await D.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.usuario, d.usuario))
  if (existe) throw new Invalido('Esse usuário já existe. Escolha outro ou entre com a sua senha.')
  let comiteId: number, papel: Papel = 'admin', coordenadorId: number | null = null
  if (d.convite) {
    const [cv] = await D.select().from(convites).where(and(eq(convites.codigo, d.convite), gt(convites.expiraEm, new Date())))
    if (!cv || cv.usos >= cv.maxUsos) throw new Invalido('Convite inválido, vencido ou já usado. Peça outro ao coordenador.')
    comiteId = cv.comiteId
    papel = cv.papel as Papel
    coordenadorId = cv.coordenadorId
    await D.update(convites).set({ usos: sql`${convites.usos} + 1` }).where(eq(convites.codigo, cv.codigo))
  } else {
    if (!d.comite) throw new Invalido('Informe o nome do comitê (ou um código de convite).')
    const [com] = await D.insert(comites).values({ nome: d.comite }).returning()
    comiteId = com.id
  }
  const [u] = await D.insert(usuarios).values({ comiteId, nome: d.nome, usuario: d.usuario, senhaHash: await gerarHash(d.senha), papel, coordenadorId, telefone: d.telefone ?? null }).returning()
  await D.insert(territorios).values({ usuarioId: u.id })
  return c.json({ token: await criarSessao(u.id), ...(await sessaoCompleta(u)) }, 201)
})

app.post('/auth/entrar', async (c) => {
  const d = await corpo(c, z.object({ usuario: zUsuario, senha: z.string().min(1).max(200) }))
  const [u] = await db().select().from(usuarios).where(eq(usuarios.usuario, d.usuario))
  if (!u || !(await conferirSenha(d.senha, u.senhaHash))) return c.json({ erro: 'Usuário ou senha incorretos.' }, 401)
  if (!u.ativo) return c.json({ erro: 'Esta conta foi desativada pelo comitê.' }, 403)
  return c.json({ token: await criarSessao(u.id), ...(await sessaoCompleta(u)) })
})

app.post('/auth/sair', async (c) => {
  const t = tokenDe(c)
  if (t) await db().delete(sessoes).where(eq(sessoes.tokenHash, hashToken(t)))
  return c.json({ ok: true })
})

/* ---------------- eu e o comitê ---------------- */

app.get('/me', async (c) => c.json(await sessaoCompleta(c.get('usuario'))))

app.patch('/me', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ nome: zNome.optional(), telefone: z.string().trim().max(30).nullable().optional(), senha: z.object({ atual: z.string(), nova: zSenha }).optional() }))
  const set: Partial<typeof usuarios.$inferInsert> = {}
  if (d.nome) set.nome = d.nome
  if (d.telefone !== undefined) set.telefone = d.telefone
  if (d.senha) {
    if (!(await conferirSenha(d.senha.atual, u.senhaHash))) throw new Invalido('A senha atual não confere.')
    set.senhaHash = await gerarHash(d.senha.nova)
  }
  if (Object.keys(set).length) await db().update(usuarios).set(set).where(eq(usuarios.id, u.id))
  const [u2] = await db().select().from(usuarios).where(eq(usuarios.id, u.id))
  return c.json(await sessaoCompleta(u2))
})

app.patch('/comite', async (c) => {
  const u = c.get('usuario')
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) altera o comitê.')
  const d = await corpo(c, z.object({ nome: z.string().trim().min(2).max(80).optional(), candidato: zCandidato.nullable().optional() }))
  const set: Partial<typeof comites.$inferInsert> = {}
  if (d.nome) set.nome = d.nome
  if (d.candidato !== undefined) set.candidato = d.candidato as Candidato | null
  if (Object.keys(set).length) await db().update(comites).set(set).where(eq(comites.id, u.comiteId))
  return c.json(await sessaoCompleta(u))
})

/* ---------------- convites ---------------- */

app.post('/convites', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ papel: zPapel.exclude(['admin']).default('cabo'), coordenadorId: z.number().int().nullable().optional(), maxUsos: z.number().int().min(1).max(500).default(1) }))
  let coordenadorId = d.coordenadorId ?? null
  if (u.papel === 'coordenador') {
    if (d.papel !== 'cabo') throw new Proibido('Coordenador só convida cabos eleitorais.')
    coordenadorId = u.id
  } else if (u.papel !== 'admin') throw new Proibido('Cabo eleitoral não cria convites.')
  if (coordenadorId) {
    const [co] = await db().select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, coordenadorId), eq(usuarios.comiteId, u.comiteId)))
    if (!co) throw new Invalido('Coordenador não encontrado neste comitê.')
  }
  const [cv] = await db().insert(convites).values({ codigo: novoCodigo(), comiteId: u.comiteId, papel: d.papel, coordenadorId, criadoPor: u.id, maxUsos: d.maxUsos, expiraEm: daquiA(DIAS_CONVITE) }).returning()
  return c.json(cv, 201)
})

app.get('/convites', async (c) => {
  const u = c.get('usuario')
  if (u.papel === 'cabo') return c.json([])
  const cond = u.papel === 'admin' ? eq(convites.comiteId, u.comiteId) : and(eq(convites.comiteId, u.comiteId), eq(convites.criadoPor, u.id))
  return c.json(await db().select().from(convites).where(and(cond, gt(convites.expiraEm, new Date()))))
})

app.delete('/convites/:codigo', async (c) => {
  const u = c.get('usuario')
  const cond = u.papel === 'admin' ? eq(convites.comiteId, u.comiteId) : eq(convites.criadoPor, u.id)
  await db().delete(convites).where(and(eq(convites.codigo, c.req.param('codigo').toUpperCase()), cond))
  return c.json({ ok: true })
})

/* ---------------- território ---------------- */

const zTerritorio = z.object({ nome: z.string().trim().min(1).max(40).default('Meu território'), itens: zItens, meta: z.number().int().min(0).max(10_000_000).default(0), ref: z.record(z.unknown()).nullable().optional() })

async function gravarTerritorio(usuarioId: number, d: z.infer<typeof zTerritorio>) {
  const [t] = await db()
    .insert(territorios)
    .values({ usuarioId, nome: d.nome, itens: d.itens as Itens, meta: d.meta, ref: d.ref ?? null, atualizadoEm: new Date() })
    .onConflictDoUpdate({ target: territorios.usuarioId, set: { nome: d.nome, itens: d.itens as Itens, meta: d.meta, ref: d.ref ?? null, atualizadoEm: new Date() } })
    .returning()
  return t
}

app.get('/territorio', async (c) => {
  const [t] = await db().select().from(territorios).where(eq(territorios.usuarioId, c.get('usuario').id))
  return c.json(t ?? null)
})

app.put('/territorio', async (c) => c.json(await gravarTerritorio(c.get('usuario').id, await corpo(c, zTerritorio))))

/* ---------------- equipe ---------------- */

// quem o usuário enxerga: admin vê o comitê inteiro; coordenador, ele e os cabos dele; cabo, só ele
async function membrosVisiveis(u: Usuario) {
  const D = db()
  const cond = u.papel === 'admin' ? eq(usuarios.comiteId, u.comiteId) : u.papel === 'coordenador' ? and(eq(usuarios.comiteId, u.comiteId), sql`(${usuarios.id} = ${u.id} or ${usuarios.coordenadorId} = ${u.id})`) : eq(usuarios.id, u.id)
  const ms = await D.select().from(usuarios).where(cond).orderBy(usuarios.nome)
  const ts = ms.length ? await D.select().from(territorios).where(inArray(territorios.usuarioId, ms.map((m) => m.id))) : []
  const tDe = new Map(ts.map((t) => [t.usuarioId, t]))
  return ms.map((m) => ({ ...publico(m), territorio: tDe.get(m.id) ?? null }))
}

app.get('/equipe', async (c) => {
  const u = c.get('usuario')
  const [com] = await db().select().from(comites).where(eq(comites.id, u.comiteId))
  return c.json({ comite: com ? { id: com.id, nome: com.nome, candidato: com.candidato } : null, membros: await membrosVisiveis(u) })
})

async function membroDoComite(c: Context<{ Variables: Vars }>) {
  const u = c.get('usuario')
  const id = Number(c.req.param('id'))
  const [m] = await db().select().from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.comiteId, u.comiteId)))
  if (!m) throw new Invalido('Pessoa não encontrada neste comitê.')
  return { u, m }
}

app.patch('/equipe/:id', async (c) => {
  const { u, m } = await membroDoComite(c)
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) altera papéis.')
  const d = await corpo(c, z.object({ nome: zNome.optional(), papel: zPapel.optional(), coordenadorId: z.number().int().nullable().optional(), ativo: z.boolean().optional(), telefone: z.string().trim().max(30).nullable().optional() }))
  if (m.id === u.id && (d.papel && d.papel !== 'admin' || d.ativo === false)) throw new Invalido('Você não pode rebaixar nem desativar a própria conta.')
  if (d.coordenadorId) {
    const [co] = await db().select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, d.coordenadorId), eq(usuarios.comiteId, u.comiteId)))
    if (!co || d.coordenadorId === m.id) throw new Invalido('Coordenador inválido.')
  }
  await db().update(usuarios).set(d).where(eq(usuarios.id, m.id))
  return c.json({ ok: true })
})

app.delete('/equipe/:id', async (c) => {
  const { u, m } = await membroDoComite(c)
  if (u.papel !== 'admin') throw new Proibido('Só o comitê (admin) remove pessoas.')
  if (m.id === u.id) throw new Invalido('Você não pode remover a própria conta.')
  await db().delete(usuarios).where(eq(usuarios.id, m.id))
  return c.json({ ok: true })
})

// o comitê (ou o coordenador do cabo) pode marcar o território de alguém que não usa o app
app.put('/equipe/:id/territorio', async (c) => {
  const { u, m } = await membroDoComite(c)
  const pode = u.papel === 'admin' || m.id === u.id || (u.papel === 'coordenador' && m.coordenadorId === u.id)
  if (!pode) throw new Proibido('Você só edita o seu território e o dos seus cabos.')
  return c.json(await gravarTerritorio(m.id, await corpo(c, zTerritorio)))
})

/* ---------------- notas de campanha e relatórios ---------------- */

app.get('/notas', async (c) => {
  const u = c.get('usuario')
  const ls = await db()
    .select({ id: notas.id, texto: notas.texto, lugar: notas.lugar, criadaEm: notas.criadaEm, usuarioId: notas.usuarioId, autor: usuarios.nome })
    .from(notas)
    .leftJoin(usuarios, eq(usuarios.id, notas.usuarioId))
    .where(eq(notas.comiteId, u.comiteId))
    .orderBy(desc(notas.criadaEm))
    .limit(300)
  return c.json(ls)
})
app.post('/notas', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ texto: z.string().trim().min(3).max(4000), lugar: z.string().trim().max(120).nullable().optional() }))
  const [n] = await db().insert(notas).values({ comiteId: u.comiteId, usuarioId: u.id, texto: d.texto, lugar: d.lugar || null }).returning()
  return c.json(n, 201)
})
app.delete('/notas/:id', async (c) => {
  const u = c.get('usuario')
  const id = Number(c.req.param('id'))
  const cond = u.papel === 'admin' ? eq(notas.comiteId, u.comiteId) : and(eq(notas.comiteId, u.comiteId), eq(notas.usuarioId, u.id))
  await db().delete(notas).where(and(eq(notas.id, id), cond))
  return c.json({ ok: true })
})

app.get('/relatorios', async (c) => {
  const u = c.get('usuario')
  const ls = await db()
    .select({ id: relatorios.id, titulo: relatorios.titulo, criadoEm: relatorios.criadoEm, autor: usuarios.nome })
    .from(relatorios)
    .leftJoin(usuarios, eq(usuarios.id, relatorios.usuarioId))
    .where(eq(relatorios.comiteId, u.comiteId))
    .orderBy(desc(relatorios.criadoEm))
    .limit(100)
  return c.json(ls)
})
app.get('/relatorios/:id', async (c) => {
  const u = c.get('usuario')
  const [r] = await db().select().from(relatorios).where(and(eq(relatorios.id, Number(c.req.param('id'))), eq(relatorios.comiteId, u.comiteId)))
  if (!r) throw new Invalido('Relatório não encontrado.')
  return c.json(r)
})
app.post('/relatorios', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ titulo: z.string().trim().min(2).max(120), conteudo: z.string().trim().min(1).max(60_000) }))
  const [r] = await db().insert(relatorios).values({ comiteId: u.comiteId, usuarioId: u.id, titulo: d.titulo, conteudo: d.conteudo }).returning()
  return c.json(r, 201)
})
app.delete('/relatorios/:id', async (c) => {
  const u = c.get('usuario')
  const cond = u.papel === 'admin' ? eq(relatorios.comiteId, u.comiteId) : and(eq(relatorios.comiteId, u.comiteId), eq(relatorios.usuarioId, u.id))
  await db().delete(relatorios).where(and(eq(relatorios.id, Number(c.req.param('id'))), cond))
  return c.json({ ok: true })
})

// 🧠 IA (server/ia.ts): /api/ia/chat, /api/ia/conversas
app.route('/ia', ia)

export type App = typeof app
