// API no desenvolvimento local: `npm run dev:api` (ou `npm run dev`, junto com o Vite).
// Lê DATABASE_URL de .env; o Vite encaminha /api para cá.
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.ts'

const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, () => {
  console.log(`API em http://localhost:${port}/api/saude ${process.env.DATABASE_URL ? '(banco: Neon)' : '(sem DATABASE_URL: banco local PGlite em .dados-local/)'}`)
})
