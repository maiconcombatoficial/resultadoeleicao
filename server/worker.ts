// Entrada da API no Cloudflare Workers. O site estático (dist/) é servido pelos assets do Worker; só o
// que começa com /api chega aqui (run_worker_first em wrangler.toml). As variáveis e os segredos do
// Worker viram process.env (nodejs_compat); o banco vem do binding HYPERDRIVE ou de DATABASE_URL.
import { app } from './app.ts'
import { definirUrlBanco } from './db/index.ts'

type Env = Record<string, string | undefined> & { HYPERDRIVE?: { connectionString: string }; ASSETS?: { fetch: (r: Request) => Promise<Response> } }
type ExecutionContext = { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; props: Record<string, unknown> }

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // variáveis do Worker → process.env (quando o runtime não as copiou sozinho)
    for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v
    definirUrlBanco(env.HYPERDRIVE?.connectionString || env.DATABASE_URL || process.env.DATABASE_URL)
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 })
    return app.fetch(req, env, ctx)
  },
}
