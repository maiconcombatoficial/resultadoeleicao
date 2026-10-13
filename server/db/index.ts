// Conexão com o Postgres do Neon pelo driver HTTP (@neondatabase/serverless): cada consulta é uma
// requisição HTTPS, o que funciona bem em funções serverless (Vercel) sem pool de conexões.
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.ts'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function db() {
  if (_db) return _db
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example)')
  _db = drizzle(neon(url), { schema })
  return _db
}

export const temBanco = () => !!process.env.DATABASE_URL
export { schema }
