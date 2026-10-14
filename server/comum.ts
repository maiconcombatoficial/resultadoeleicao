// Tipos e utilitários compartilhados pelas rotas da API.
import type { Context } from 'hono'
import { z } from 'zod'
import type { Usuario } from './db/schema.ts'

export type Vars = { usuario: Usuario }
export type Ctx = Context<{ Variables: Vars }>

// 400: dados inválidos · 403: sem permissão (codigo 'plano' quando é limite do plano) · 429: muitas tentativas
export class Invalido extends Error {}
export class Proibido extends Error {
  codigo?: string
  constructor(msg?: string, codigo?: string) {
    super(msg)
    this.codigo = codigo
  }
}
export class LimiteExcedido extends Error {
  codigo = 'limite'
  retryEm: number // segundos
  constructor(msg = 'Muitas tentativas. Aguarde um pouco e tente de novo.', retryEm = 60) {
    super(msg)
    this.retryEm = retryEm
  }
}

// lê e valida o JSON do corpo; erro de validação vira 400 com a primeira mensagem do zod
export async function corpo<T extends z.ZodTypeAny>(c: Context, esquema: T): Promise<z.infer<T>> {
  const j = await c.req.json().catch(() => null)
  const r = esquema.safeParse(j)
  if (!r.success) throw new Invalido(r.error.issues[0]?.message || 'Dados inválidos')
  return r.data
}

// dia de hoje no horário de Brasília (AAAA-MM-DD): os limites diários viram à meia-noite local
export const hojeISO = (agora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)

// IP de quem chama (Vercel põe o real em x-forwarded-for)
export const ipDe = (c: Context) => (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'local'

// origem do site (para links de e-mail, redirecionamentos do Google e retorno do pagamento)
export const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
