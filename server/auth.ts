// Senhas e sessões, só com o módulo crypto do Node (nada nativo, roda em qualquer função serverless).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

const scrypt = (senha: string, salt: Buffer, tam: number) => new Promise<Buffer>((ok, erro) => scryptCb(senha, salt, tam, { N }, (e, k) => (e ? erro(e) : ok(k))))
const N = 16384, TAM = 64

export async function gerarHash(senha: string) {
  const salt = randomBytes(16)
  const h = await scrypt(senha.normalize('NFKC'), salt, TAM)
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`
}

// guardado pode ser null (conta que só entra com o Google): nunca confere
export async function conferirSenha(senha: string, guardado: string | null | undefined) {
  if (!guardado) return false
  const [alg, saltHex, hashHex] = guardado.split('$')
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false
  const h = await scrypt(senha.normalize('NFKC'), Buffer.from(saltHex, 'hex'), TAM)
  const esperado = Buffer.from(hashHex, 'hex')
  return h.length === esperado.length && timingSafeEqual(h, esperado)
}

// token aleatório para o navegador; no banco fica só o sha-256 dele
export const novoToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// código de convite curto e legível (sem 0/O, 1/I)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function novoCodigo(n = 8) {
  const b = randomBytes(n)
  let s = ''
  for (let i = 0; i < n; i++) s += ALFABETO[b[i] % ALFABETO.length]
  return s
}

export const DIAS_SESSAO = 60
export const DIAS_CONVITE = 30
export const daquiA = (dias: number) => new Date(Date.now() + dias * 86_400_000)
export const daquiAMin = (minutos: number) => new Date(Date.now() + minutos * 60_000)
