// Banco de dados da campanha (Postgres), com Drizzle ORM.
//
// - Produção (Cloudflare Workers + Supabase): o driver postgres.js liga na pool do Supabase (porta 6543,
//   modo transação) ou, melhor, no Hyperdrive da Cloudflare (binding HYPERDRIVE), que mantém a pool perto
//   do Worker. A string vem de DATABASE_URL ou do binding.
// - Neon (ex.: deploy alternativo no Vercel): se a URL for do Neon, usa o driver HTTP dele.
// - Desenvolvimento sem DATABASE_URL: Postgres embutido (PGlite) em .dados-local/, com as migrações de
//   drizzle/ aplicadas sozinhas (BANCO_LOCAL=0 desliga). Nunca nos Workers nem em produção.
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema.ts'

export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>

let _db: Banco | null = null
let _pronto: Promise<Banco | null> | null = null
let _urlExterna: string | null = null

const PASTA_LOCAL = process.env.BANCO_LOCAL_PASTA || '.dados-local'
export const ehWorkers = () => typeof navigator !== 'undefined' && /Cloudflare-Workers/i.test(navigator.userAgent || '')
export const bancoLocalPermitido = () => !urlBanco() && process.env.BANCO_LOCAL !== '0' && !process.env.VERCEL && process.env.NODE_ENV !== 'production' && !ehWorkers()

// o Worker injeta a string do Hyperdrive (ou DATABASE_URL do env) antes de atender
export function definirUrlBanco(url: string | undefined | null) {
  if (url && url !== _urlExterna) {
    _urlExterna = url
    _db = null
    _pronto = null
  }
}
const urlBanco = () => _urlExterna || process.env.DATABASE_URL || ''

// prepara o banco (uma vez por instância)
export function prontoBanco() {
  if (_pronto) return _pronto
  _pronto = (async () => {
    const url = urlBanco()
    if (url) {
      if (/neon\.tech/.test(url)) {
        const [{ neon }, { drizzle }] = await Promise.all([import('@neondatabase/serverless'), import('drizzle-orm/neon-http')])
        _db = drizzle(neon(url), { schema }) as unknown as Banco
      } else {
        const [{ default: postgres }, { drizzle }] = await Promise.all([import('postgres'), import('drizzle-orm/postgres-js')])
        // pool do Supabase (Supavisor) em modo transação: sem prepared statements; poucas conexões por instância
        const cliente = postgres(url, { prepare: false, max: ehWorkers() ? 5 : 10, idle_timeout: 20, connect_timeout: 10, fetch_types: false })
        _db = drizzle(cliente, { schema }) as unknown as Banco
      }
      return _db
    }
    if (!bancoLocalPermitido()) return null
    // import com nome em variável: o empacotador do Worker não tenta incluir o PGlite
    const pglite = '@electric-sql/pglite', pgliteDrizzle = 'drizzle-orm/pglite', pgliteMigrator = 'drizzle-orm/pglite/migrator'
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([import(/* @vite-ignore */ pglite), import(/* @vite-ignore */ pgliteDrizzle), import(/* @vite-ignore */ pgliteMigrator)])
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

export const temBanco = () => !!urlBanco() || (bancoLocalPermitido() && !!_db)
export const bancoLocal = () => !urlBanco() && !!_db
export { schema }
