// Tipos e utilitários compartilhados pelas rotas da API.
import type { Context } from 'hono'
import { z } from 'zod'
import type { Usuario } from './db/schema.ts'

export type Vars = { usuario: Usuario }
export type Ctx = Context<{ Variables: Vars }>

export class Invalido extends Error {}
export class Proibido extends Error {}

// lê e valida o JSON do corpo; erro de validação vira 400 com a primeira mensagem do zod
export async function corpo<T extends z.ZodTypeAny>(c: Context, esquema: T): Promise<z.infer<T>> {
  const j = await c.req.json().catch(() => null)
  const r = esquema.safeParse(j)
  if (!r.success) throw new Invalido(r.error.issues[0]?.message || 'Dados inválidos')
  return r.data
}

export const hojeISO = () => new Date().toISOString().slice(0, 10)
