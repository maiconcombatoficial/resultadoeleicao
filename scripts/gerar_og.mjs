// Gera img/og.jpg (prévia de link) e os favicons a partir de scripts/og.html e do ícone do app.
// Uso: node scripts/gerar_og.mjs   (precisa do pacote playwright e de um Chromium)
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const pg = await b.newPage({ viewport: { width: 1200, height: 630 } })
await pg.goto('file://' + path.join(raiz, 'scripts/og.html'))
await pg.evaluate(() => document.fonts.ready)
await pg.waitForTimeout(300)
await pg.screenshot({ path: path.join(raiz, 'img/og.jpg'), type: 'jpeg', quality: 86 })
// favicon 32×32 e 48×48 a partir do ícone de 192 px
for (const n of [32, 48]) {
  const p = await b.newPage({ viewport: { width: n, height: n } })
  await p.setContent(`<body style="margin:0"><img src="file://${path.join(raiz, 'img/icones/icone-192.png')}" style="width:${n}px;height:${n}px;display:block"></body>`)
  await p.waitForTimeout(100)
  await p.screenshot({ path: path.join(raiz, `img/icones/favicon-${n}.png`), omitBackground: true })
}
await b.close()
