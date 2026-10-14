// Senhas, tokens e códigos. Usa Web Crypto (existe no Node, no Cloudflare Workers e no Vercel):
// PBKDF2-SHA256 para as senhas novas; hashes antigos em scrypt ("scrypt$…") ainda conferem onde o
// node:crypto existe e são trocados pelo formato novo na próxima entrada (ver /auth/entrar).
import { createHash, timingSafeEqual } from 'node:crypto'

const ITER = 310_000
const TAM = 32
const sub = globalThis.crypto.subtle

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const deHex = (h: string) => Uint8Array.from(h.match(/.{2}/g) || [], (x) => parseInt(x, 16))
const aleatorio = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))

async function pbkdf2(senha: string, sal: Uint8Array, iter: number) {
  const chave = await sub.importKey('raw', new TextEncoder().encode(senha.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await sub.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iter }, chave, TAM * 8))
}

export async function gerarHash(senha: string) {
  const sal = aleatorio(16)
  const h = await pbkdf2(senha, sal, ITER)
  return `pbkdf2$${ITER}$${hex(sal)}$${hex(h)}`
}

// hash antigo (scrypt do Node): confere só onde o node:crypto o implementa
async function conferirScrypt(senha: string, saltHex: string, hashHex: string) {
  try {
    const { scrypt } = await import('node:crypto')
    const esperado = Buffer.from(hashHex, 'hex')
    const h = await new Promise<Buffer>((ok, erro) => scrypt(senha.normalize('NFKC'), Buffer.from(saltHex, 'hex'), esperado.length, { N: 16384 }, (e, k) => (e ? erro(e) : ok(k))))
    return h.length === esperado.length && timingSafeEqual(h, esperado)
  } catch {
    return false
  }
}

// guardado pode ser null (conta que só entra com o Google): nunca confere
export async function conferirSenha(senha: string, guardado: string | null | undefined) {
  if (!guardado) return false
  const p = guardado.split('$')
  if (p[0] === 'pbkdf2' && p.length === 4) {
    const h = await pbkdf2(senha, deHex(p[2]), Number(p[1]) || ITER)
    const esperado = deHex(p[3])
    return h.length === esperado.length && timingSafeEqual(h, esperado)
  }
  if (p[0] === 'scrypt' && p.length === 3) return conferirScrypt(senha, p[1], p[2])
  return false
}

// hash em formato antigo: regravar com o novo depois de conferir
export const precisaRehash = (guardado: string | null | undefined) => !!guardado && !guardado.startsWith('pbkdf2$')

// token aleatório para o navegador; no banco fica só o sha-256 dele
export const novoToken = () => Buffer.from(aleatorio(32)).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// código de convite curto e legível (sem 0/O, 1/I)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function novoCodigo(n = 8) {
  const b = aleatorio(n)
  let s = ''
  for (let i = 0; i < n; i++) s += ALFABETO[b[i] % ALFABETO.length]
  return s
}

export const DIAS_SESSAO = 60
export const DIAS_CONVITE = 30
export const daquiA = (dias: number) => new Date(Date.now() + dias * 86_400_000)
export const daquiAMin = (minutos: number) => new Date(Date.now() + minutos * 60_000)
