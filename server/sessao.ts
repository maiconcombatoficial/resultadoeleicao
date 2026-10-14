// Sessões, contas, convites e limites do plano: usado por app.ts, google.ts, cobranca.ts e ia.ts
// (fica à parte para esses módulos não importarem o app inteiro).
import type { Context } from 'hono'
import { and, count, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { db, schema } from './db/index.ts'
import { DIAS_SESSAO, daquiA, daquiAMin, hashToken, novoToken } from './auth.ts'
import { Invalido, Proibido } from './comum.ts'
import { PLANOS, limitesDe, planoEfetivo, type PlanoId } from './planos.ts'
import type { Comite, Papel, Usuario } from './db/schema.ts'

const { codigosLogin, comites, convites, sessoes, territorios, usuarios } = schema

/* ---------------- sessão ---------------- */

export async function usuarioDoToken(token: string | undefined) {
  if (!token) return null
  const [r] = await db()
    .select({ u: usuarios })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashToken(token)), gt(sessoes.expiraEm, new Date())))
    .limit(1)
  return r?.u && r.u.ativo ? r.u : null
}

export async function criarSessao(usuarioId: number) {
  const token = novoToken()
  await db().insert(sessoes).values({ tokenHash: hashToken(token), usuarioId, expiraEm: daquiA(DIAS_SESSAO) })
  return token
}

export const tokenDe = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '')

export const publico = (u: Usuario) => ({ id: u.id, nome: u.nome, usuario: u.usuario, email: u.email, papel: u.papel as Papel, coordenadorId: u.coordenadorId, telefone: u.telefone, ativo: u.ativo, google: !!u.googleId, temSenha: !!u.senhaHash, criadoEm: u.criadoEm })

export async function comiteDe(comiteId: number) {
  const [com] = await db().select().from(comites).where(eq(comites.id, comiteId))
  return com ?? null
}

// o plano que vale agora e os limites dele (o front mostra; o servidor aplica)
export function resumoPlano(com: Comite | null) {
  const id: PlanoId = com ? planoEfetivo(com) : 'gratis'
  const contratado = (com?.plano || 'gratis') as PlanoId
  return { id, nome: PLANOS[id].nome, contratado, periodo: com?.periodo ?? null, planoAte: com?.planoAte ?? null, vencido: contratado !== 'gratis' && id === 'gratis', limites: limitesDe(id) }
}

export async function sessaoCompleta(u: Usuario) {
  const com = await comiteDe(u.comiteId)
  const [t] = await db().select().from(territorios).where(eq(territorios.usuarioId, u.id))
  return { usuario: publico(u), comite: com ? { id: com.id, nome: com.nome, candidato: com.candidato } : null, territorio: t ?? null, plano: resumoPlano(com) }
}

/* ---------------- plano: limites aplicados no servidor ---------------- */

export async function planoDoComite(comiteId: number) {
  return resumoPlano(await comiteDe(comiteId))
}

export async function contarPessoas(comiteId: number) {
  const [r] = await db().select({ n: count() }).from(usuarios).where(and(eq(usuarios.comiteId, comiteId), eq(usuarios.ativo, true)))
  return Number(r?.n || 0)
}

// quantas vagas sobram no plano (null = ilimitado)
export async function vagasDoComite(comiteId: number) {
  const P = await planoDoComite(comiteId)
  if (P.limites.pessoas == null) return null
  return Math.max(0, P.limites.pessoas - (await contarPessoas(comiteId)))
}

export async function exigirVagas(comiteId: number, quantas = 1) {
  const vagas = await vagasDoComite(comiteId)
  if (vagas != null && vagas < quantas) {
    const P = await planoDoComite(comiteId)
    throw new Proibido(`O plano ${P.nome} permite ${P.limites.pessoas} ${P.limites.pessoas === 1 ? 'pessoa' : 'pessoas'} no comitê. Para convidar mais gente, faça upgrade em 💳 Plano.`, 'plano')
  }
}

export async function exigirRecurso(comiteId: number, recurso: 'notas' | 'analises' | 'relatorioEquipe') {
  const P = await planoDoComite(comiteId)
  if (!P.limites[recurso]) {
    const nomes = { notas: 'as notas de campanha', analises: 'a área Análises', relatorioEquipe: 'o relatório por liderança' }
    throw new Proibido(`O plano ${P.nome} não inclui ${nomes[recurso]}. Veja os planos em 💳 Plano.`, 'plano')
  }
  return P
}

// municípios cobertos pelos territórios do comitê (chaves "cd|z-loc"), com os itens novos de uma pessoa no lugar dos antigos dela
export async function exigirMunicipios(comiteId: number, usuarioId: number, itensNovos: Record<string, unknown>) {
  const P = await planoDoComite(comiteId)
  if (P.limites.municipios == null) return
  const ids = (await db().select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.comiteId, comiteId))).map((x) => x.id)
  const ts = ids.length ? await db().select({ usuarioId: territorios.usuarioId, itens: territorios.itens }).from(territorios).where(and(inArray(territorios.usuarioId, ids), ne(territorios.usuarioId, usuarioId))) : []
  const cds = new Set<string>()
  for (const t of ts) for (const k of Object.keys(t.itens || {})) cds.add(k.split('|')[0])
  for (const k of Object.keys(itensNovos || {})) cds.add(k.split('|')[0])
  if (cds.size > P.limites.municipios) throw new Proibido(`O plano ${P.nome} cobre ${P.limites.municipios} município. Para marcar territórios em outros municípios, faça upgrade para o plano Estadual em 💳 Plano.`, 'plano')
}

/* ---------------- contas e convites ---------------- */

// consome uma vaga do convite de forma atômica (duas pessoas não usam a última vaga ao mesmo tempo)
export async function usarConvite(codigo: string) {
  const [cv] = await db()
    .update(convites)
    .set({ usos: sql`${convites.usos} + 1` })
    .where(and(eq(convites.codigo, codigo.toUpperCase()), sql`${convites.usos} < ${convites.maxUsos}`, gt(convites.expiraEm, new Date())))
    .returning()
  if (!cv) throw new Invalido('Convite inválido, vencido ou já usado. Peça outro ao coordenador.')
  return cv
}

// nome de usuário livre a partir de um e-mail ou nome (ex.: "maria.silva", "maria.silva2")
export async function usuarioLivre(base: string) {
  let raiz = base
    .toLowerCase()
    .split('@')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32)
  if (raiz.length < 3) raiz = `pessoa${raiz}`
  const existentes = new Set((await db().select({ u: usuarios.usuario }).from(usuarios).where(sql`${usuarios.usuario} like ${raiz + '%'}`)).map((x) => x.u))
  if (!existentes.has(raiz)) return raiz
  for (let i = 2; i < 1000; i++) if (!existentes.has(`${raiz}${i}`)) return `${raiz}${i}`
  return `${raiz}${Date.now()}`
}

export type NovaConta = {
  nome: string
  usuario: string
  email: string | null
  senhaHash: string | null
  telefone?: string | null
  googleId?: string | null
  aceite: boolean
  // ou entra num comitê pelo convite…
  convite?: string | null
  // …ou cria um comitê novo (vira admin)
  nomeComite?: string | null
}

// cria a conta (e o comitê, quando não há convite); confere as vagas do plano do comitê do convite
export async function criarConta(d: NovaConta) {
  const D = db()
  let comiteId: number, papel: Papel = 'admin', coordenadorId: number | null = null
  if (d.convite) {
    const [cv0] = await D.select().from(convites).where(eq(convites.codigo, d.convite.toUpperCase()))
    if (!cv0) throw new Invalido('Convite inválido, vencido ou já usado. Peça outro ao coordenador.')
    await exigirVagas(cv0.comiteId)
    const cv = await usarConvite(d.convite)
    comiteId = cv.comiteId
    papel = cv.papel as Papel
    coordenadorId = cv.coordenadorId
  } else {
    const nome = (d.nomeComite || '').trim() || `Comitê de ${d.nome}`
    const [com] = await D.insert(comites).values({ nome }).returning()
    comiteId = com.id
  }
  const [u] = await D.insert(usuarios)
    .values({ comiteId, nome: d.nome, usuario: d.usuario, email: d.email, senhaHash: d.senhaHash, papel, coordenadorId, telefone: d.telefone ?? null, googleId: d.googleId ?? null, aceiteTermosEm: d.aceite ? new Date() : null })
    .returning()
  await D.insert(territorios).values({ usuarioId: u.id })
  return u
}

/* ---------------- código de login de uso único (retorno do Google) ---------------- */

export async function novoCodigoLogin(usuarioId: number) {
  const codigo = novoToken()
  await db().insert(codigosLogin).values({ codigoHash: hashToken(codigo), usuarioId, expiraEm: daquiAMin(2) })
  return codigo
}

export async function trocarCodigoLogin(codigo: string) {
  const [r] = await db()
    .update(codigosLogin)
    .set({ usadoEm: new Date() })
    .where(and(eq(codigosLogin.codigoHash, hashToken(codigo)), sql`${codigosLogin.usadoEm} is null`, gt(codigosLogin.expiraEm, new Date())))
    .returning({ usuarioId: codigosLogin.usuarioId })
  if (!r) return null
  const [u] = await db().select().from(usuarios).where(eq(usuarios.id, r.usuarioId))
  return u && u.ativo ? u : null
}
