// Drizzle Kit: gera as migrações SQL em drizzle/ a partir de server/db/schema.ts e as aplica no Neon.
//   npm run db:generate   → cria a migração (não precisa de banco)
//   npm run db:migrate    → aplica no banco de DATABASE_URL (.env ou variável de ambiente)
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgresql://localhost/apuracao' },
  verbose: true,
  strict: true,
})
