// Login com o Google (OAuth 2.0, fluxo de código no servidor, sem bibliotecas).
//
// 1. GET /api/auth/google/iniciar?convite=&v=&aceite=1 → guarda um "state" no banco e manda para o Google.
// 2. O Google volta em GET /api/auth/google/retorno?code&state → troca o código pelo perfil (e-mail
//    verificado), acha ou cria a conta e manda o navegador para #campanha?codigo=<uso único>.
// 3. O app troca o código por um token de sessão em POST /api/auth/google/trocar.
import { Hono } from 'hono'
import { and, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from './db/index.ts'
import { daquiAMin, novoToken } from './auth.ts'
import { appUrl, corpo, ipDe, type Vars } from './comum.ts'
import { limitar } from './limites.ts'
import { criarConta, criarSessao, exigirVagas, novoCodigoLogin, sessaoCompleta, trocarCodigoLogin, usuarioLivre } from './sessao.ts'

const { oauthEstados, usuarios } = schema

export const temGoogle = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
const redirectUri = () => `${appUrl()}/api/auth/google/retorno`

// fetch injetável (os testes simulam o Google)
let fetchGoogle: typeof fetch = (...a) => fetch(...a)
export const definirFetchGoogle = (fn: typeof fetch) => (fetchGoogle = fn)

type Perfil = { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string }

async function perfilDoCodigo(code: string): Promise<Perfil> {
  const r = await fetchGoogle('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  })
  if (!r.ok) throw new Error(`token ${r.status}`)
  const t = (await r.json()) as { access_token?: string }
  if (!t.access_token) throw new Error('sem access_token')
  const p = await fetchGoogle('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })
  if (!p.ok) throw new Error(`userinfo ${p.status}`)
  return (await p.json()) as Perfil
}

export const google = new Hono<{ Variables: Vars }>()

const volta = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString()
  return `${appUrl()}/#campanha${q ? `?${q}` : ''}`
}

google.get('/iniciar', async (c) => {
  if (!temGoogle()) return c.json({ erro: 'Login com Google não configurado neste servidor.' }, 503)
  await limitar(`google:${ipDe(c)}`, 60, 600)
  const estado = novoToken()
  const convite = (c.req.query('convite') || '').trim().toUpperCase().slice(0, 12) || null
  const vis = (c.req.query('v') || '').slice(0, 20) || null
  await db().insert(oauthEstados).values({ estado, convite, vis, aceite: c.req.query('aceite') === '1', expiraEm: daquiAMin(10) })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state: estado, prompt: 'select_account' }).toString()
  return c.redirect(url.toString(), 302)
})

google.get('/retorno', async (c) => {
  const code = c.req.query('code'), estado = c.req.query('state')
  if (!temGoogle() || !code || !estado) return c.redirect(volta({ erro: 'google', motivo: 'parametros' }), 302)
  // state: existe, não venceu, uso único
  const [st] = await db().delete(oauthEstados).where(and(eq(oauthEstados.estado, estado), gt(oauthEstados.expiraEm, new Date()))).returning()
  if (!st) return c.redirect(volta({ erro: 'google', motivo: 'estado' }), 302)
  let perfil: Perfil
  try {
    perfil = await perfilDoCodigo(code)
  } catch (e) {
    console.error('google', e)
    return c.redirect(volta({ erro: 'google', motivo: 'google' }), 302)
  }
  if (!perfil.sub || !perfil.email || perfil.email_verified === false) return c.redirect(volta({ erro: 'google', motivo: 'email' }), 302)
  const email = perfil.email.toLowerCase()
  const D = db()
  let [u] = await D.select().from(usuarios).where(eq(usuarios.googleId, perfil.sub))
  if (!u) {
    // conta já existente com esse e-mail: liga ao Google
    const [porEmail] = await D.select().from(usuarios).where(eq(usuarios.email, email))
    if (porEmail) {
      ;[u] = await D.update(usuarios).set({ googleId: perfil.sub }).where(eq(usuarios.id, porEmail.id)).returning()
    } else {
      if (!st.aceite) return c.redirect(volta({ erro: 'aceite', convite: st.convite || undefined }), 302)
      try {
        if (st.convite) {
          const [cv] = await D.select().from(schema.convites).where(eq(schema.convites.codigo, st.convite))
          if (cv) await exigirVagas(cv.comiteId)
        }
        u = await criarConta({ nome: (perfil.name || email.split('@')[0]).slice(0, 80), usuario: await usuarioLivre(email), email, senhaHash: null, googleId: perfil.sub, aceite: true, convite: st.convite })
      } catch (e) {
        console.error('google: criar conta', e)
        const codigo = (e as { codigo?: string }).codigo
        return c.redirect(volta({ erro: 'google', motivo: codigo === 'plano' ? 'plano' : 'convite', convite: st.convite || undefined }), 302)
      }
    }
  }
  if (!u.ativo) return c.redirect(volta({ erro: 'google', motivo: 'inativo' }), 302)
  if (!u.email) await D.update(usuarios).set({ email }).where(and(eq(usuarios.id, u.id), sql`${usuarios.email} is null`))
  const codigo = await novoCodigoLogin(u.id)
  return c.redirect(volta({ codigo, v: st.vis || undefined }), 302)
})

google.post('/trocar', async (c) => {
  await limitar(`trocar:${ipDe(c)}`, 30, 600)
  const d = await corpo(c, z.object({ codigo: z.string().min(10).max(200) }))
  const u = await trocarCodigoLogin(d.codigo)
  if (!u) return c.json({ erro: 'Código de login inválido ou vencido. Entre de novo.' }, 400)
  return c.json({ token: await criarSessao(u.id), ...(await sessaoCompleta(u)) })
})
