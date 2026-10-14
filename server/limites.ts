// Limite de tentativas (rate limit) guardado no banco: funciona em função serverless, onde a memória não
// sobrevive entre chamadas. Janela fixa por chave ("entrar:ip:1.2.3.4"): conta até max em `segundos`.
import { sql } from 'drizzle-orm'
import { db, schema } from './db/index.ts'
import { LimiteExcedido } from './comum.ts'

const { limites } = schema
let chamadas = 0

export async function limitar(chave: string, max: number, segundos: number, mensagem?: string) {
  const [r] = await db()
    .insert(limites)
    .values({ chave, n: 1, janelaAte: new Date(Date.now() + segundos * 1000) })
    .onConflictDoUpdate({
      target: limites.chave,
      set: {
        n: sql`case when ${limites.janelaAte} < now() then 1 else ${limites.n} + 1 end`,
        janelaAte: sql`case when ${limites.janelaAte} < now() then now() + make_interval(secs => ${segundos}) else ${limites.janelaAte} end`,
      },
    })
    .returning({ n: limites.n, janelaAte: limites.janelaAte })
  // de vez em quando, apaga janelas velhas
  if (++chamadas % 50 === 0) db().delete(limites).where(sql`${limites.janelaAte} < now() - interval '1 day'`).catch(() => {})
  if (r.n > max) {
    const retry = Math.max(1, Math.ceil((new Date(r.janelaAte).getTime() - Date.now()) / 1000))
    throw new LimiteExcedido(mensagem, retry)
  }
  return r.n
}
