// Esquema do banco (Postgres no Neon), com Drizzle ORM.
//
// O banco guarda só o que é da campanha: comitês, pessoas (coordenadores e cabos eleitorais), convites,
// sessões e o território de cada um (escolas e seções onde trabalhou) com a meta de votos.
// Os votos continuam vindo dos arquivos estáticos do TSE (public/dados<ano>/), somados no navegador.
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

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
    senhaHash: text('senha_hash').notNull(), // scrypt: "scrypt$<salt hex>$<hash hex>"
    papel: text('papel', { enum: PAPEIS }).notNull().default('cabo'),
    coordenadorId: integer('coordenador_id'), // a quem o cabo eleitoral responde (usuário do mesmo comitê)
    telefone: text('telefone'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('usuarios_usuario_idx').on(t.usuario), index('usuarios_comite_idx').on(t.comiteId)],
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
