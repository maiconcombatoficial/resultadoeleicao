// npm run test:api — testa senhas, tokens e convites (sem banco).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conferirSenha, gerarHash, hashToken, novoCodigo, novoToken, precisaRehash } from './auth.ts'

test('senha: hash confere e rejeita a errada', async () => {
  const h = await gerarHash('segredo-123')
  assert.match(h, /^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  assert.equal(await conferirSenha('segredo-123', h), true)
  assert.equal(await conferirSenha('segredo-124', h), false)
  assert.equal(await conferirSenha('x', 'lixo'), false)
})

test('senha: dois hashes da mesma senha são diferentes (salt)', async () => {
  assert.notEqual(await gerarHash('abc'), await gerarHash('abc'))
})

test('token de sessão: aleatório e com hash estável', () => {
  const t = novoToken()
  assert.ok(t.length >= 40)
  assert.notEqual(t, novoToken())
  assert.equal(hashToken(t), hashToken(t))
  assert.equal(hashToken(t).length, 64)
})

test('código de convite: 8 caracteres legíveis', () => {
  for (let i = 0; i < 50; i++) assert.match(novoCodigo(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
})

test('senha: hash antigo em scrypt ainda confere e pede regravação', async () => {
  const { scryptSync } = await import('node:crypto')
  const sal = Buffer.alloc(16, 7)
  const antigo = `scrypt$${sal.toString('hex')}$${scryptSync('velha-senha', sal, 64, { N: 16384 }).toString('hex')}`
  assert.equal(await conferirSenha('velha-senha', antigo), true)
  assert.equal(await conferirSenha('outra', antigo), false)
  assert.equal(precisaRehash(antigo), true)
  assert.equal(precisaRehash(await gerarHash('x1x2x3')), false)
})
