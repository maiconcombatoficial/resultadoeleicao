// Função serverless do Vercel: todas as rotas /api/* caem aqui (rewrite em vercel.json) e vão para o Hono.
import { handle } from '@hono/vercel'
import { app } from '../server/app.ts'

export default handle(app)
