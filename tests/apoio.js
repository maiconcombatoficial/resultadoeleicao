// Apoio dos testes: serve as respostas do TSE gravadas em tests/fixtures/tse e junta os erros da página.
import { test as base, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'

const DIR = path.resolve('tests/fixtures/tse')
const GRAVAR = !!process.env.GRAVAR_TSE
const arquivo = (url) => path.join(DIR, url.split('?')[0].replace(/^https:\/\/resultados\.tse\.jus\.br\//, '').replace(/[^a-z0-9.-]/gi, '_') + '.gz')

export const test = base.extend({
  page: async ({ page }, use) => {
    const erros = []
    page.on('pageerror', (e) => erros.push(e.message))
    await page.route('https://resultados.tse.jus.br/**', async (rota) => {
      const url = rota.request().url()
      const f = arquivo(url)
      const tipo = /\.jpe?g/i.test(url) ? 'image/jpeg' : 'application/json'
      if (fs.existsSync(f)) return rota.fulfill({ status: 200, body: zlib.gunzipSync(fs.readFileSync(f)), headers: { 'content-type': tipo, 'access-control-allow-origin': '*' } })
      if (GRAVAR && !/\.jpe?g/i.test(url)) {
        let corpo = null
        try {
          corpo = execFileSync('curl', ['-sS', '-f', '-m', '30', url.split('?')[0]], { maxBuffer: 64 << 20 })
        } catch {}
        if (corpo) {
          fs.mkdirSync(DIR, { recursive: true })
          fs.writeFileSync(f, zlib.gzipSync(corpo, { level: 9 }))
          return rota.fulfill({ status: 200, body: corpo, headers: { 'content-type': tipo, 'access-control-allow-origin': '*' } })
        }
      }
      // fotos e o que não foi gravado: como se o TSE não tivesse o arquivo
      return rota.fulfill({ status: 404, body: '' })
    })
    // mapas da área protegida não entram nos testes
    await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (r) => r.fulfill({ status: 404, body: '' }))
    await use(page)
    expect(erros, 'erros de JavaScript na página').toEqual([])
  },
})
export { expect }

// baixa o arquivo gerado por um clique (imagem, PDF, CSV) e devolve nome e tamanho
export async function baixar(page, locator) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), locator.click()])
  const p = await d.path()
  return { nome: d.suggestedFilename(), bytes: fs.statSync(p).size }
}
