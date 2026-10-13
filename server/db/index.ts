// Banco de dados da campanha.
//
// - Produção (Vercel): Postgres no Neon pelo driver HTTP (@neondatabase/serverless): cada consulta é uma
//   requisição HTTPS, o que funciona bem em funções serverless sem pool de conexões. Exige DATABASE_URL.
// - Desenvolvimento sem DATABASE_URL: um Postgres embutido (PGlite) gravado em .dados-local/, com as
//   migrações de drizzle/ aplicadas sozinhas. Serve para testar a Campanha no PC sem criar nada no Neon.
//   (Desligue com BANCO_LOCAL=0. Nunca é usado no Vercel.)
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema.ts'

export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>

let _db: Banco | null = null
let _pronto: Promise<Banco | null> | null = null

const PASTA_LOCAL = process.env.BANCO_LOCAL_PASTA || '.dados-local'
export const bancoLocalPermitido = () => !process.env.DATABASE_URL && process.env.BANCO_LOCAL !== '0' && !process.env.VERCEL && process.env.NODE_ENV !== 'production'

// prepara o banco (uma vez): Neon é imediato; o PGlite abre a pasta e aplica as migrações
export function prontoBanco() {
  if (_pronto) return _pronto
  _pronto = (async () => {
    const url = process.env.DATABASE_URL
    if (url) {
      _db = drizzleNeon(neon(url), { schema }) as unknown as Banco
      return _db
    }
    if (!bancoLocalPermitido()) return null
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([import('@electric-sql/pglite'), import('drizzle-orm/pglite'), import('drizzle-orm/pglite/migrator')])
    const cliente = new PGlite(PASTA_LOCAL)
    const local = drizzle(cliente, { schema })
    await migrate(local, { migrationsFolder: 'drizzle' })
    _db = local as unknown as Banco
    console.log(`Banco local (PGlite) em ${PASTA_LOCAL}`)
    return _db
  })()
  _pronto.catch((e) => {
    console.error('Banco indisponível:', e)
    _pronto = null
  })
  return _pronto
}

export function db(): Banco {
  if (!_db) throw new Error('Banco não preparado (chame prontoBanco())')
  return _db
}

export const temBanco = () => !!process.env.DATABASE_URL || (bancoLocalPermitido() && !!_db)
export const bancoLocal = () => !process.env.DATABASE_URL && !!_db
export { schema }
