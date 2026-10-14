// Esquema do banco (Postgres no Neon), com Drizzle ORM.
//
// O banco guarda só o que é da campanha: comitês, pessoas (coordenadores e cabos eleitorais), convites,
// sessões e o território de cada um (escolas e seções onde trabalhou) com a meta de votos.
// Os votos continuam vindo dos arquivos estáticos do TSE (public/dados<ano>/), somados no navegador.
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { PERIODOS, PLANO_IDS } from '../planos.ts'

export const PAPEIS = ['admin', 'coordenador', 'cabo'] as const
export type Papel = (typeof PAPEIS)[number]

// candidato do comitê, como o app o identifica (sq do TSE, aba do cargo, número, nome, partido)
export type Candidato = { sq: string; aba: string; cargo: number; numero: string; nome: string; partido: string }

// território: { "cd|z-loc": [] (local inteiro) ou ["z-s", …] (só essas seções) } — mesmo formato do app
export type Itens = Record<string, string[]>

export const comites = pgTable('comites', {
  id: serial('id').primaryKey(),
  nome: text('nome').notNull(),
  candidato: jsonb('candidato').$type<Candidato | null>(),
  // plano contratado (server/planos.ts) e até quando vale; mp_* = ids no Mercado Pago
  plano: text('plano', { enum: PLANO_IDS }).notNull().default('gratis'),
  periodo: text('periodo', { enum: PERIODOS }),
  planoAte: timestamp('plano_ate', { withTimezone: true }),
  mpPreapprovalId: text('mp_preapproval_id'),
  mpUltimoPagamentoId: text('mp_ultimo_pagamento_id'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
})

export const usuarios = pgTable(
  'usuarios',
  {
    id: serial('id').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    usuario: text('usuario').notNull(), // login (minúsculas, sem espaços)
    senhaHash: text('senha_hash'), // scrypt: "scrypt$<salt hex>$<hash hex>"; null = conta que só entra com o Google
    email: text('email'), // minúsculas; recuperação de senha, vínculo com o Google e cobrança
    googleId: text('google_id'), // "sub" da conta Google
    aceiteTermosEm: timestamp('aceite_termos_em', { withTimezone: true }),
    papel: text('papel', { enum: PAPEIS }).notNull().default('cabo'),
    coordenadorId: integer('coordenador_id'), // a quem o cabo eleitoral responde (usuário do mesmo comitê)
    telefone: text('telefone'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('usuarios_usuario_idx').on(t.usuario),
    index('usuarios_comite_idx').on(t.comiteId),
    uniqueIndex('usuarios_email_idx').on(t.email).where(sql`${t.email} is not null`),
    uniqueIndex('usuarios_google_idx').on(t.googleId).where(sql`${t.googleId} is not null`),
  ],
)

export const sessoes = pgTable(
  'sessoes',
  {
    tokenHash: text('token_hash').primaryKey(), // sha-256 do token entregue ao navegador
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    criadaEm: timestamp('criada_em', { withTimezone: true }).defaultNow().notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessoes_usuario_idx').on(t.usuarioId)],
)

export const convites = pgTable(
  'convites',
  {
    codigo: text('codigo').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    papel: text('papel', { enum: PAPEIS }).notNull().default('cabo'),
    coordenadorId: integer('coordenador_id'), // cabo convidado já entra respondendo a este coordenador
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    usos: integer('usos').notNull().default(0),
    maxUsos: integer('max_usos').notNull().default(1),
    criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  },
  (t) => [index('convites_comite_idx').on(t.comiteId)],
)

export const territorios = pgTable('territorios', {
  usuarioId: integer('usuario_id')
    .primaryKey()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull().default('Meu território'),
  itens: jsonb('itens').$type<Itens>().notNull().default({}),
  meta: integer('meta').notNull().default(0), // meta de votos da liderança (0 = sem meta)
  ref: jsonb('ref').$type<Record<string, unknown> | null>(), // candidatura municipal de comparação (opcional)
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull(),
})

export type Usuario = typeof usuarios.$inferSelect
export type Comite = typeof comites.$inferSelect
export type Territorio = typeof territorios.$inferSelect

/* ---------------- campanha: notas, relatórios e conversas com a IA ---------------- */

// tipo tsvector do Postgres (busca textual em português nas notas)
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

// notas de campanha: o que a equipe sabe e os dados do TSE não mostram (reuniões, lideranças, demandas de um bairro)
export const notas = pgTable(
  'notas',
  {
    id: serial('id').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    usuarioId: integer('usuario_id').references(() => usuarios.id, { onDelete: 'set null' }),
    texto: text('texto').notNull(),
    lugar: text('lugar'), // município, bairro ou escola a que a nota se refere (texto livre)
    criadaEm: timestamp('criada_em', { withTimezone: true }).defaultNow().notNull(),
    busca: tsvector('busca').generatedAlwaysAs(sql`to_tsvector('portuguese', coalesce(lugar, '') || ' ' || texto)`),
  },
  (t) => [index('notas_comite_idx').on(t.comiteId), index('notas_busca_idx').using('gin', t.busca)],
)

// relatórios gerados com a IA (ou escritos à mão) e guardados para o comitê
export const relatorios = pgTable(
  'relatorios',
  {
    id: serial('id').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    usuarioId: integer('usuario_id').references(() => usuarios.id, { onDelete: 'set null' }),
    titulo: text('titulo').notNull(),
    conteudo: text('conteudo').notNull(), // Markdown
    criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('relatorios_comite_idx').on(t.comiteId)],
)

// conversas com a IA (mensagens no formato da API do Claude, inclusive chamadas de ferramentas)
export const conversas = pgTable(
  'conversas',
  {
    id: serial('id').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    titulo: text('titulo').notNull().default('Conversa'),
    mensagens: jsonb('mensagens').$type<unknown[]>().notNull().default([]),
    atualizadaEm: timestamp('atualizada_em', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('conversas_usuario_idx').on(t.usuarioId)],
)

// uso diário da IA por pessoa (limite simples contra abuso)
export const iaUsos = pgTable('ia_usos', {
  usuarioId: integer('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  dia: text('dia').notNull(), // AAAA-MM-DD
  n: integer('n').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.usuarioId, t.dia] })])

/* ---------------- cobrança, login com Google, recuperação de senha e limites ---------------- */

// pagamentos e assinaturas no Mercado Pago (um registro por id do MP; o webhook atualiza o status)
export const pagamentos = pgTable(
  'pagamentos',
  {
    id: serial('id').primaryKey(),
    comiteId: integer('comite_id')
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    plano: text('plano', { enum: PLANO_IDS }).notNull(),
    periodo: text('periodo', { enum: PERIODOS }).notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    tipo: text('tipo', { enum: ['pagamento', 'assinatura', 'cobranca'] }).notNull(), // pagamento avulso · assinatura (preapproval) · cobrança mensal da assinatura
    mpId: text('mp_id').notNull(), // id do pagamento/preapproval no MP (ou da preferência enquanto pendente)
    status: text('status').notNull().default('pendente'), // pendente · aprovado · recusado · cancelado · estornado · autorizado · pausado
    raw: jsonb('raw').$type<unknown>(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('pagamentos_mp_idx').on(t.mpId), index('pagamentos_comite_idx').on(t.comiteId)],
)

// estado do login com o Google (CSRF): criado em /auth/google/iniciar, consumido no retorno
export const oauthEstados = pgTable('oauth_estados', {
  estado: text('estado').primaryKey(),
  convite: text('convite'),
  vis: text('vis'),
  aceite: boolean('aceite').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
})

// código de uso único que o retorno do Google põe no link; o app troca por um token de sessão
export const codigosLogin = pgTable('codigos_login', {
  codigoHash: text('codigo_hash').primaryKey(),
  usuarioId: integer('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  usadoEm: timestamp('usado_em', { withTimezone: true }),
})

// recuperação de senha por e-mail
export const recuperacoes = pgTable('recuperacoes', {
  tokenHash: text('token_hash').primaryKey(),
  usuarioId: integer('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  usadaEm: timestamp('usada_em', { withTimezone: true }),
})

// limite de tentativas por chave (ip, usuário, e-mail), janela fixa
export const limites = pgTable('limites', {
  chave: text('chave').primaryKey(),
  n: integer('n').notNull().default(0),
  janelaAte: timestamp('janela_ate', { withTimezone: true }).notNull(),
})

// uso diário da IA somado no comitê (o limite do plano é do comitê)
export const iaUsosComite = pgTable('ia_usos_comite', {
  comiteId: integer('comite_id')
    .notNull()
    .references(() => comites.id, { onDelete: 'cascade' }),
  dia: text('dia').notNull(),
  n: integer('n').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.comiteId, t.dia] })])
