// npm run test:api — testa senhas, tokens e convites (sem banco).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conferirSenha, gerarHash, hashToken, novoCodigo, novoToken } from './auth.ts'

test('senha: hash confere e rejeita a errada', async () => {
  const h = await gerarHash('segredo-123')
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
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
